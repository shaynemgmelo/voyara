import asyncio
import logging
import re

import httpx

from app.extractors.audio_download import transcribe_video_url
from app.extractors.base import BaseExtractor, ExtractedContent
from app.vision.video_text_reader import read_video_text

logger = logging.getLogger(__name__)

OEMBED_URL = "https://www.tiktok.com/oembed"


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
        # Always fetch oEmbed FIRST (fast, ~1s, never blocked by transcription).
        # Transcription is best-effort with a short deadline so it never
        # costs us the oEmbed result.
        oembed = await self._oembed_extract(url)

        # Deep mode runs transcription (faster-whisper 'tiny' — 75MB, fits
        # Render free tier) AND Vision OCR, in parallel. Both best-effort.
        from app.services.orchestrator import is_shallow_extraction

        transcript = ""
        on_screen_text = ""
        if not is_shallow_extraction():
            transcript, on_screen_text = await asyncio.gather(
                _safe_call(
                    transcribe_video_url(url, timeout=90.0), "transcript", url
                ),
                _safe_call(
                    read_video_text(url, timeout=75.0), "vision-ocr", url
                ),
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

    async def _oembed_extract(self, url: str) -> dict:
        """Use TikTok's public oEmbed API to get video metadata."""
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                resp = await client.get(OEMBED_URL, params={"url": url})
                resp.raise_for_status()
                return resp.json()
        except Exception as e:
            logger.warning("TikTok oEmbed failed for %s: %s", url, e)
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
