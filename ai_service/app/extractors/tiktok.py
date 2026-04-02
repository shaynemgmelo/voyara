import asyncio
import logging

from app.extractors.base import BaseExtractor, ExtractedContent

logger = logging.getLogger(__name__)


class TikTokExtractor(BaseExtractor):
    """Extract content from TikTok videos using yt-dlp."""

    def can_handle(self, url: str) -> bool:
        return "tiktok.com" in url.lower()

    async def extract(self, url: str) -> ExtractedContent:
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

    def _extract_info(self, url: str) -> dict:
        import yt_dlp

        ydl_opts = {
            "quiet": True,
            "no_warnings": True,
            "skip_download": True,
            "getcomments": True,
        }

        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                return ydl.extract_info(url, download=False) or {}
        except Exception as e:
            logger.warning("TikTok extraction failed for %s: %s", url, e)
            return {}

    def _get_comments(self, info: dict) -> list[str]:
        return [
            c.get("text", "")
            for c in info.get("comments", [])[:30]
            if c.get("text")
        ]
