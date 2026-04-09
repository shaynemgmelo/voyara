import asyncio
import logging
import re

import httpx

from app.extractors.base import BaseExtractor, ExtractedContent

logger = logging.getLogger(__name__)

OEMBED_URL = "https://www.tiktok.com/oembed"


class TikTokExtractor(BaseExtractor):
    """Extract content from TikTok videos using oEmbed API + yt-dlp fallback."""

    def can_handle(self, url: str) -> bool:
        return "tiktok.com" in url.lower()

    async def extract(self, url: str) -> ExtractedContent:
        # Try oEmbed first (fast, reliable, public API)
        oembed = await self._oembed_extract(url)
        if oembed.get("title"):
            hashtags = re.findall(r"#(\w+)", oembed.get("title", ""))
            return ExtractedContent(
                platform="tiktok",
                url=url,
                title=oembed.get("title"),
                description=oembed.get("title", ""),
                captions=[oembed["title"]],
                comments=[],
                has_video=True,
                metadata={
                    "creator": oembed.get("author_name"),
                    "tags": hashtags,
                },
            )

        # Fallback to yt-dlp
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
