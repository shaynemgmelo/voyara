from __future__ import annotations

import asyncio
import logging

from app.extractors.audio_download import transcribe_video_url
from app.extractors.base import BaseExtractor, ExtractedContent
from app.vision.video_text_reader import read_video_text

logger = logging.getLogger(__name__)


class InstagramExtractor(BaseExtractor):
    """Extract content from Instagram posts and Reels.

    Combines instaloader metadata (caption + comments) with audio transcription
    via Whisper — for Reels, this captures spoken places that are not in the
    caption.
    """

    def can_handle(self, url: str) -> bool:
        return "instagram.com" in url.lower()

    async def extract(self, url: str) -> ExtractedContent:
        """Extract post data from Instagram (caption + comments + audio)."""
        # Caption first — always fast, never blocked by transcription.
        info = await asyncio.to_thread(self._extract_info, url)

        has_video = info.get("is_video", False) or "/reel/" in url or "/tv/" in url
        transcript = ""
        on_screen_text = ""

        # Whisper removed in prod (OOM on free tier). Vision OCR runs alone.
        from app.services.orchestrator import is_shallow_extraction
        if has_video and not is_shallow_extraction():
            try:
                on_screen_text = await read_video_text(url, timeout=60.0) or ""
            except asyncio.TimeoutError:
                logger.info("[ig-vision-ocr] Budget exceeded for %s", url)
            except Exception as e:
                logger.warning("[ig-vision-ocr] Error for %s: %s", url, e)

        captions: list[str] = []
        if info.get("caption"):
            captions.append(info["caption"])
        if transcript:
            captions.append(f"[TRANSCRIPT] {transcript}")
        if on_screen_text:
            captions.append(f"[ON-SCREEN TEXT] {on_screen_text}")

        return ExtractedContent(
            platform="instagram",
            url=url,
            title=info.get("title"),
            description=info.get("caption", ""),
            captions=captions,
            comments=info.get("comments", []),
            has_video=has_video,
            metadata={
                "owner": info.get("owner"),
                "likes": info.get("likes"),
                "location": info.get("location"),
                "hashtags": info.get("hashtags", []),
                "has_transcript": bool(transcript),
                "transcript_chars": len(transcript) if transcript else 0,
                "has_on_screen_text": bool(on_screen_text),
                "on_screen_chars": len(on_screen_text) if on_screen_text else 0,
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
