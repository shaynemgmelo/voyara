from __future__ import annotations

import asyncio
import logging
import subprocess
import tempfile
from pathlib import Path

from app.extractors.audio_download import transcribe_video_url
from app.extractors.base import BaseExtractor, ExtractedContent

logger = logging.getLogger(__name__)


class YouTubeExtractor(BaseExtractor):
    """Extract content from YouTube videos and Shorts.

    Prefers platform subtitles (free, fast, accurate) and falls back to
    Whisper transcription when no subtitles are available (e.g. Shorts
    without auto-captions).
    """

    def can_handle(self, url: str) -> bool:
        return any(
            domain in url.lower()
            for domain in ["youtube.com", "youtu.be", "youtube.com/shorts"]
        )

    async def extract(self, url: str) -> ExtractedContent:
        """Extract metadata, description, captions, and comments from YouTube."""
        info = await asyncio.to_thread(self._extract_info, url)

        captions = self._get_captions(info)

        # If we got no captions, fall back to Vision OCR on frames.
        # Local Whisper was removed — too heavy for Render free tier.
        if not captions:
            from app.services.orchestrator import is_shallow_extraction
            if not is_shallow_extraction():
                try:
                    from app.vision.video_text_reader import read_video_text
                    on_screen = await read_video_text(url, timeout=60.0)
                    if on_screen:
                        captions = [f"[ON-SCREEN TEXT] {on_screen}"]
                except asyncio.TimeoutError:
                    logger.info("[youtube] Vision OCR budget exceeded for %s", url)
                except Exception as e:
                    logger.warning("[youtube] Vision OCR error for %s: %s", url, e)

        content = ExtractedContent(
            platform="youtube",
            url=url,
            title=info.get("title"),
            description=info.get("description", ""),
            captions=captions,
            comments=self._get_comments(info),
            has_video=True,
            metadata={
                "channel": info.get("channel"),
                "duration": info.get("duration"),
                "view_count": info.get("view_count"),
                "tags": info.get("tags", []),
                "used_transcription": not info.get("subtitles")
                and not info.get("automatic_captions"),
            },
        )

        return content

    async def download_audio(self, url: str) -> str | None:
        """Download audio to a temp file for transcription. Returns file path."""
        return await asyncio.to_thread(self._download_audio, url)

    def _extract_info(self, url: str) -> dict:
        import yt_dlp

        ydl_opts = {
            "quiet": True,
            "no_warnings": True,
            "extract_flat": False,
            "writesubtitles": True,
            "writeautomaticsub": True,
            "subtitleslangs": ["en", "pt"],
            "getcomments": True,
            "skip_download": True,
        }

        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                return ydl.extract_info(url, download=False) or {}
        except Exception as e:
            logger.warning("yt-dlp extraction failed for %s: %s", url, e)
            return {}

    def _download_audio(self, url: str) -> str | None:
        """
        Download video and extract audio using ffmpeg directly.
        This approach works better than yt-dlp's postprocessor for TikTok
        and other platforms where codec detection fails.
        """
        import yt_dlp

        tmp_dir = tempfile.mkdtemp()
        video_path = str(Path(tmp_dir) / "video.%(ext)s")
        audio_output = str(Path(tmp_dir) / "audio.mp3")

        # Step 1: Download the video file (smallest available)
        ydl_opts = {
            "quiet": True,
            "no_warnings": True,
            "format": "worstaudio/worst",
            "outtmpl": video_path,
            "max_filesize": 100_000_000,  # 100MB
        }

        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                ydl.download([url])

            # Find the downloaded video file
            downloaded = None
            for f in Path(tmp_dir).iterdir():
                if f.name.startswith("video") and f.suffix != ".mp3":
                    downloaded = str(f)
                    break

            if not downloaded:
                logger.warning("No video file downloaded for %s", url)
                return None

            # Step 2: Extract audio with ffmpeg directly
            result = subprocess.run(
                [
                    "ffmpeg",
                    "-i", downloaded,
                    "-vn",
                    "-acodec", "libmp3lame",
                    "-q:a", "4",
                    "-y",
                    audio_output,
                ],
                capture_output=True,
                timeout=60,
            )

            # Clean up video file
            try:
                Path(downloaded).unlink(missing_ok=True)
            except Exception:
                pass

            if result.returncode == 0 and Path(audio_output).exists():
                return audio_output
            else:
                logger.warning(
                    "ffmpeg audio extraction failed: %s",
                    result.stderr.decode()[-200:] if result.stderr else "unknown",
                )
                return None

        except Exception as e:
            logger.warning("Audio download failed for %s: %s", url, e)
            return None

    def _get_captions(self, info: dict) -> list[str]:
        """Extract subtitles/captions from video info."""
        captions = []

        # Check for manual subtitles first, then auto-generated
        for sub_key in ["subtitles", "automatic_captions"]:
            subs = info.get(sub_key, {})
            for lang in ["en", "pt", "es"]:
                if lang in subs:
                    for sub in subs[lang]:
                        if sub.get("ext") == "json3" and "data" in sub:
                            for event in sub["data"].get("events", []):
                                text = "".join(
                                    seg.get("utf8", "")
                                    for seg in event.get("segs", [])
                                )
                                if text.strip():
                                    captions.append(text.strip())
                    break
        return captions

    def _get_comments(self, info: dict) -> list[str]:
        """Extract top comments."""
        comments_data = info.get("comments", [])
        return [
            c.get("text", "")
            for c in comments_data[:30]
            if c.get("text")
        ]
