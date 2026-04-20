import asyncio
import logging
import re

import httpx

from app.extractors.audio_download import transcribe_video_url
from app.extractors.base import BaseExtractor, ExtractedContent
from app.vision.video_text_reader import read_video_text

logger = logging.getLogger(__name__)

OEMBED_URL = "https://www.tiktok.com/oembed"

# Rotating pool of browser UAs. TikTok appears to rate-limit per (IP, UA)
# tuple — cycling UAs recovers access even when our Render egress IP is
# flagged for one specific UA.
_BROWSER_UAS = [
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 "
    "(KHTML, like Gecko) Version/17.6 Safari/605.1.15",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) "
    "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1",
    "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
    "Twitterbot/1.0",
]


async def _safe_call(coro, label: str, url: str) -> str:
    """Await a coroutine that may fail; return empty string on error.
    Used to run transcription + OCR in parallel without letting either
    failure poison the other."""
    try:
        return await coro or ""
    except asyncio.TimeoutError:
        logger.info("[%s] Budget exceeded for %s", label, url)
    except Exception as e:
        logger.warning("[%s] Error for %s: %s", label, url, e)
    return ""


class TikTokExtractor(BaseExtractor):
    """Extract TikTok video content — oEmbed metadata + audio transcription.

    We run oEmbed and transcription IN PARALLEL, then combine both signals:
    the title/description from oEmbed and the full audio transcript via
    Whisper. This surfaces places the creator MENTIONS but did not write
    in the caption.
    """

    def can_handle(self, url: str) -> bool:
        return "tiktok.com" in url.lower()

    async def extract(self, url: str) -> ExtractedContent:
        # oEmbed first (fast, ~1s). HTML scrape as fallback when TikTok
        # blocks our egress IP (common on Render workers).
        oembed = await self._oembed_extract(url)
        if not oembed.get("title"):
            logger.info("[tiktok] oEmbed empty, trying HTML scrape for %s", url)
            oembed = await self._html_scrape_fallback(url)

        # Deep mode: transcript first, then vision. Sequential (NOT parallel)
        # to halve peak memory — Render free tier workers are 512MB and
        # running both concurrently was triggering OOM restarts.
        from app.services.orchestrator import is_shallow_extraction

        transcript = ""
        on_screen_text = ""
        if not is_shallow_extraction():
            transcript = await _safe_call(
                transcribe_video_url(url, timeout=90.0), "transcript", url
            )
            on_screen_text = await _safe_call(
                read_video_text(url, timeout=90.0), "vision-ocr", url
            )

        title = oembed.get("title") if oembed else ""
        description = title or ""
        hashtags = re.findall(r"#(\w+)", description)
        creator = oembed.get("author_name") if oembed else None

        # Captions list: caption + transcript + on-screen text.
        # Each marked so the Haiku prompt knows the origin.
        captions: list[str] = []
        if description:
            captions.append(description)
        if transcript:
            captions.append(f"[TRANSCRIPT] {transcript}")
        if on_screen_text:
            captions.append(f"[ON-SCREEN TEXT] {on_screen_text}")

        # If oEmbed failed AND both enrichments empty, fall back to yt-dlp
        if not title and not transcript and not on_screen_text:
            info = await asyncio.to_thread(self._extract_info, url)
            return ExtractedContent(
                platform="tiktok",
                url=url,
                title=info.get("title"),
                description=info.get("description", ""),
                captions=[info["description"]] if info.get("description") else [],
                comments=self._get_comments(info),
                has_video=True,
                metadata={
                    "creator": info.get("creator") or info.get("uploader"),
                    "like_count": info.get("like_count"),
                    "view_count": info.get("view_count"),
                    "tags": info.get("tags", []),
                },
            )

        return ExtractedContent(
            platform="tiktok",
            url=url,
            title=title,
            description=description,
            captions=captions,
            comments=[],
            has_video=True,
            metadata={
                "creator": creator,
                "tags": hashtags,
                "has_transcript": bool(transcript),
                "transcript_chars": len(transcript) if transcript else 0,
                "has_on_screen_text": bool(on_screen_text),
                "on_screen_chars": len(on_screen_text) if on_screen_text else 0,
            },
        )

    async def _resolve_short_url(self, url: str) -> str:
        """Short 'vt.tiktok.com/XXX' links 301-redirect to full URLs.
        Resolving them first gives better oEmbed hit-rate on some egress IPs."""
        if "vt.tiktok.com" not in url and "vm.tiktok.com" not in url:
            return url
        try:
            async with httpx.AsyncClient(
                timeout=10.0,
                follow_redirects=False,
                headers={
                    "User-Agent": _BROWSER_UAS[0],
                    "Accept": "*/*",
                },
            ) as client:
                resp = await client.get(url)
                loc = resp.headers.get("location")
                if loc and "tiktok.com" in loc:
                    # Strip query params
                    if "?" in loc:
                        loc = loc.split("?")[0]
                    return loc
        except Exception:
            pass
        return url

    async def _oembed_extract(self, url: str) -> dict:
        """Use TikTok's public oEmbed API to get video metadata.
        Retries across several browser UAs because Render egress IPs get
        quota-throttled by TikTok."""
        resolved = await self._resolve_short_url(url)
        for ua in _BROWSER_UAS:
            headers = {
                "User-Agent": ua,
                "Accept": "application/json, text/plain, */*",
                "Accept-Language": "en-US,en;q=0.9,pt-BR;q=0.8",
                "Referer": "https://www.tiktok.com/",
            }
            try:
                async with httpx.AsyncClient(
                    timeout=12.0, follow_redirects=True, headers=headers
                ) as client:
                    resp = await client.get(
                        OEMBED_URL, params={"url": resolved}
                    )
                    if resp.status_code == 200:
                        data = resp.json()
                        if data.get("title"):
                            return data
            except Exception as e:
                logger.debug("TikTok oEmbed UA retry failed: %s", e)
                continue
        logger.warning("TikTok oEmbed exhausted all UAs for %s", url)
        return {}

    async def _html_scrape_fallback(self, url: str) -> dict:
        """Fetch the TikTok page HTML and pull caption from og: meta tags.
        Rotates UAs because TikTok varies responses per UA."""
        import html as _html
        import re as _re

        resolved = await self._resolve_short_url(url)
        for ua in _BROWSER_UAS:
            headers = {
                "User-Agent": ua,
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9",
                "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
            }
            try:
                async with httpx.AsyncClient(
                    timeout=15.0, follow_redirects=True, headers=headers
                ) as client:
                    resp = await client.get(resolved)
                    if resp.status_code != 200:
                        continue
                    html = resp.text
                m = _re.search(
                    r'<meta\s+property="og:description"\s+content="([^"]+)"', html
                )
                desc = _html.unescape(m.group(1)) if m else ""
                t = _re.search(
                    r'<meta\s+property="og:title"\s+content="([^"]+)"', html
                )
                title = _html.unescape(t.group(1)) if t else ""
                if title or desc:
                    return {"title": title or desc, "author_name": None}
            except Exception:
                continue
        logger.warning("TikTok HTML scrape failed across all UAs for %s", url)
        return {}

    def _extract_info(self, url: str) -> dict:
        import yt_dlp

        ydl_opts = {
            "quiet": True,
            "no_warnings": True,
            "skip_download": True,
            "socket_timeout": 15,
        }

        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                return ydl.extract_info(url, download=False) or {}
        except Exception as e:
            logger.warning("TikTok yt-dlp failed for %s: %s", url, e)
            return {}

    def _get_comments(self, info: dict) -> list[str]:
        return [
            c.get("text", "")
            for c in info.get("comments", [])[:30]
            if c.get("text")
        ]
