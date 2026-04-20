import asyncio
import logging
import re

import httpx

from app.extractors.audio_download import transcribe_video_url
from app.extractors.base import BaseExtractor, ExtractedContent

logger = logging.getLogger(__name__)

OEMBED_URL = "https://www.tiktok.com/oembed"


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

        # Fire transcription with a tight budget — if it doesn't finish
        # in time, we still return rich oEmbed content.
        transcript = ""
        try:
            transcript = await asyncio.wait_for(
                transcribe_video_url(url, timeout=45.0),
                timeout=50.0,
            )
        except asyncio.TimeoutError:
            logger.info(
                "[tiktok] Transcription budget exceeded for %s; using oEmbed only",
                url,
            )
        except Exception as e:
            logger.warning("[tiktok] Transcription error for %s: %s", url, e)

        title = oembed.get("title") if oembed else ""
        description = title or ""
        hashtags = re.findall(r"#(\w+)", description)
        creator = oembed.get("author_name") if oembed else None

        # Captions list: description + transcript (transcript is the gold)
        captions: list[str] = []
        if description:
            captions.append(description)
        if transcript:
            captions.append(f"[TRANSCRIPT] {transcript}")

        # If oEmbed failed AND transcript is empty, fall back to yt-dlp
        if not title and not transcript:
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
