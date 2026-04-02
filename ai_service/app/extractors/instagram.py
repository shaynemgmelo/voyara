from __future__ import annotations

import asyncio
import logging

from app.extractors.base import BaseExtractor, ExtractedContent

logger = logging.getLogger(__name__)


class InstagramExtractor(BaseExtractor):
    """Extract content from Instagram posts and Reels."""

    def can_handle(self, url: str) -> bool:
        return "instagram.com" in url.lower()

    async def extract(self, url: str) -> ExtractedContent:
        """Extract post data from Instagram."""
        info = await asyncio.to_thread(self._extract_info, url)

        has_video = info.get("is_video", False) or "/reel/" in url

        return ExtractedContent(
            platform="instagram",
            url=url,
            title=info.get("title"),
            description=info.get("caption", ""),
            captions=[info["caption"]] if info.get("caption") else [],
            comments=info.get("comments", []),
            has_video=has_video,
            metadata={
                "owner": info.get("owner"),
                "likes": info.get("likes"),
                "location": info.get("location"),
                "hashtags": info.get("hashtags", []),
            },
        )

    def _extract_info(self, url: str) -> dict:
        try:
            import instaloader

            loader = instaloader.Instaloader(
                download_comments=True,
                download_video_thumbnails=False,
                save_metadata=False,
                quiet=True,
            )

            # Extract shortcode from URL
            shortcode = self._extract_shortcode(url)
            if not shortcode:
                return self._fallback_extract(url)

            post = instaloader.Post.from_shortcode(loader.context, shortcode)

            comments = []
            try:
                for comment in post.get_comments():
                    comments.append(comment.text)
                    if len(comments) >= 30:
                        break
            except Exception:
                pass

            return {
                "caption": post.caption or "",
                "owner": post.owner_username,
                "likes": post.likes,
                "is_video": post.is_video,
                "location": (
                    post.location.name if post.location else None
                ),
                "hashtags": list(post.caption_hashtags) if post.caption else [],
                "comments": comments,
            }
        except Exception as e:
            logger.warning("Instagram extraction failed for %s: %s", url, e)
            return self._fallback_extract(url)

    def _extract_shortcode(self, url: str) -> str | None:
        """Extract the shortcode from an Instagram URL."""
        import re

        patterns = [
            r"instagram\.com/p/([A-Za-z0-9_-]+)",
            r"instagram\.com/reel/([A-Za-z0-9_-]+)",
            r"instagram\.com/tv/([A-Za-z0-9_-]+)",
        ]
        for pattern in patterns:
            match = re.search(pattern, url)
            if match:
                return match.group(1)
        return None

    def _fallback_extract(self, url: str) -> dict:
        """Fallback using yt-dlp for Instagram content."""
        try:
            import yt_dlp

            ydl_opts = {
                "quiet": True,
                "no_warnings": True,
                "skip_download": True,
            }
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(url, download=False) or {}
                return {
                    "caption": info.get("description", ""),
                    "title": info.get("title"),
                    "is_video": info.get("ext") in ("mp4", "webm"),
                    "owner": info.get("uploader"),
                }
        except Exception:
            return {}
