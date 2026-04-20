"""Download audio from a video URL (TikTok, Instagram, YouTube) and transcribe it.

We cache transcriptions in a simple in-memory dict keyed by URL so that
repeated calls with the same link don't re-download / re-transcribe.

Audio is downloaded to /tmp as a compressed m4a/mp3, transcribed with
faster-whisper, then the file is deleted.
"""

from __future__ import annotations

import asyncio
import logging
import os
import tempfile
import time
from typing import Optional

from app.transcription.whisper_service import transcribe_audio

logger = logging.getLogger(__name__)

# In-memory cache: {url: (timestamp, transcript)}
# Lives for the life of the worker process. Good enough for repeat-analyzes.
_CACHE: dict[str, tuple[float, str]] = {}
_CACHE_TTL_SECONDS = 60 * 60 * 6  # 6 hours

# Max duration we'll transcribe. Longer videos get truncated.
MAX_DURATION_SECONDS = 600  # 10 min hard cap


def _cache_get(url: str) -> Optional[str]:
    entry = _CACHE.get(url)
    if not entry:
        return None
    ts, transcript = entry
    if time.time() - ts > _CACHE_TTL_SECONDS:
        del _CACHE[url]
        return None
    return transcript


def _cache_set(url: str, transcript: str) -> None:
    _CACHE[url] = (time.time(), transcript)


async def transcribe_video_url(url: str, timeout: float = 120.0) -> str:
    """Download audio from a video URL and transcribe it.

    Returns the transcript (may be empty if download/transcription fails).
    Never raises — failures are logged and an empty string is returned so
    the caller can fall back to oEmbed / caption data gracefully.
    """
    cached = _cache_get(url)
    if cached is not None:
        logger.info("[transcribe] Cache hit for %s (%d chars)", url, len(cached))
        return cached

    try:
        transcript = await asyncio.wait_for(
            asyncio.to_thread(_sync_download_and_transcribe, url),
            timeout=timeout,
        )
    except asyncio.TimeoutError:
        logger.warning("[transcribe] Timed out for %s", url)
        transcript = ""
    except Exception as e:
        logger.warning("[transcribe] Failed for %s: %s", url, e)
        transcript = ""

    _cache_set(url, transcript)
    return transcript


def _get_ffmpeg_path() -> Optional[str]:
    """Return path to ffmpeg — prefers system binary, falls back to bundled
    imageio-ffmpeg binary so we don't require ffmpeg to be installed on the
    host (critical for Render-style PaaS without apt access)."""
    try:
        import imageio_ffmpeg

        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return None


def _sync_download_and_transcribe(url: str) -> str:
    """Download audio and transcribe. Runs in a worker thread."""
    import yt_dlp

    with tempfile.TemporaryDirectory(prefix="mapass-audio-") as tmpdir:
        output_template = os.path.join(tmpdir, "audio.%(ext)s")

        ydl_opts = {
            "quiet": True,
            "no_warnings": True,
            "format": "bestaudio/best",
            "outtmpl": output_template,
            "postprocessors": [
                {
                    "key": "FFmpegExtractAudio",
                    "preferredcodec": "mp3",
                    "preferredquality": "96",
                }
            ],
            "socket_timeout": 30,
            "retries": 2,
            # Hard cap: prefer not to waste CPU on super-long videos
            "match_filter": _duration_filter,
        }

        ffmpeg = _get_ffmpeg_path()
        if ffmpeg:
            ydl_opts["ffmpeg_location"] = ffmpeg

        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(url, download=True)
                if info is None:
                    return ""
        except yt_dlp.utils.DownloadError as e:
            logger.warning("[transcribe] yt-dlp download error for %s: %s", url, e)
            return ""
        except Exception as e:
            logger.warning("[transcribe] Unexpected download error for %s: %s", url, e)
            return ""

        # Find the produced audio file
        audio_path = None
        for f in os.listdir(tmpdir):
            if f.endswith((".mp3", ".m4a", ".opus", ".webm", ".wav")):
                audio_path = os.path.join(tmpdir, f)
                break

        if not audio_path or not os.path.exists(audio_path):
            logger.warning("[transcribe] No audio file produced for %s", url)
            return ""

        size_mb = os.path.getsize(audio_path) / (1024 * 1024)
        logger.info(
            "[transcribe] Downloaded %.2fMB audio from %s, transcribing...",
            size_mb,
            url,
        )

        # Transcribe synchronously (we're already in a thread)
        from app.transcription.whisper_service import _transcribe_sync

        transcript = _transcribe_sync(audio_path)
        logger.info(
            "[transcribe] Produced %d chars transcript from %s",
            len(transcript),
            url,
        )
        return transcript


def _duration_filter(info_dict: dict, *_args, **_kwargs):
    """yt-dlp match_filter: skip videos longer than MAX_DURATION_SECONDS."""
    duration = info_dict.get("duration")
    if duration and duration > MAX_DURATION_SECONDS:
        return f"Video too long ({duration}s > {MAX_DURATION_SECONDS}s)"
    return None
