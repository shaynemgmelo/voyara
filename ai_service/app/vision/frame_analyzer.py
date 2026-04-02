"""
Video frame extraction + Claude Vision analysis.

Extracts keyframes from videos and sends them to Claude Vision
to identify landmarks, signs, restaurant names, and location clues.
"""

from __future__ import annotations

import asyncio
import base64
import logging
import tempfile
from pathlib import Path

import anthropic

from app.config import settings

logger = logging.getLogger(__name__)


async def analyze_frames(url: str, num_frames: int = 5) -> dict:
    """
    Download video, extract frames, and analyze them with Claude Vision.

    Returns:
        {
            "descriptions": ["Frame 1: Shows a large red gate...", ...],
            "locations_found": ["Senso-ji Temple", "Nakamise Shopping Street"],
            "success": True
        }
    """
    # Step 1: Download video
    video_path = await asyncio.to_thread(_download_video, url)
    if not video_path:
        return {
            "descriptions": [],
            "locations_found": [],
            "success": False,
            "error": "Failed to download video",
        }

    try:
        # Step 2: Extract frames
        frames = await asyncio.to_thread(_extract_frames, video_path, num_frames)
        if not frames:
            return {
                "descriptions": [],
                "locations_found": [],
                "success": False,
                "error": "Failed to extract frames",
            }

        # Step 3: Analyze with Claude Vision
        result = await _analyze_with_vision(frames)
        return result

    finally:
        # Cleanup
        try:
            import shutil

            p = Path(video_path)
            p.unlink(missing_ok=True)
            if p.parent.name.startswith("tmp"):
                shutil.rmtree(p.parent, ignore_errors=True)
        except Exception:
            pass


def _download_video(url: str) -> str | None:
    """Download video to a temp file using yt-dlp."""
    import yt_dlp

    tmp_dir = tempfile.mkdtemp()
    output_path = str(Path(tmp_dir) / "video.%(ext)s")

    ydl_opts = {
        "quiet": True,
        "no_warnings": True,
        "format": "worst[ext=mp4]/worst",  # smallest video for frame extraction
        "outtmpl": output_path,
        "max_filesize": 100_000_000,  # 100MB max
    }

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            ydl.download([url])

        for f in Path(tmp_dir).iterdir():
            if f.suffix in (".mp4", ".webm", ".mkv"):
                return str(f)
    except Exception as e:
        logger.warning("Video download failed for %s: %s", url, e)

    return None


def _extract_frames(video_path: str, num_frames: int) -> list[bytes]:
    """Extract evenly-spaced frames from a video using ffmpeg via Pillow/subprocess."""
    import subprocess
    import json as json_mod

    frames = []

    try:
        # Get video duration using ffprobe
        probe = subprocess.run(
            [
                "ffprobe",
                "-v", "quiet",
                "-print_format", "json",
                "-show_format",
                video_path,
            ],
            capture_output=True,
            text=True,
            timeout=10,
        )
        duration = float(
            json_mod.loads(probe.stdout).get("format", {}).get("duration", 30)
        )

        # Calculate timestamps for evenly-spaced frames
        interval = duration / (num_frames + 1)
        timestamps = [interval * (i + 1) for i in range(num_frames)]

        for ts in timestamps:
            # Extract frame at timestamp
            result = subprocess.run(
                [
                    "ffmpeg",
                    "-ss", str(ts),
                    "-i", video_path,
                    "-vframes", "1",
                    "-f", "image2pipe",
                    "-vcodec", "mjpeg",
                    "-q:v", "5",
                    "-",
                ],
                capture_output=True,
                timeout=10,
            )
            if result.returncode == 0 and result.stdout:
                frames.append(result.stdout)

    except Exception as e:
        logger.warning("Frame extraction failed: %s", e)

    return frames


async def _analyze_with_vision(frames: list[bytes]) -> dict:
    """Send frames to Claude Vision for analysis."""
    client = anthropic.Anthropic(api_key=settings.anthropic_api_key)

    # Build content blocks with images
    content = [
        {
            "type": "text",
            "text": (
                "These are frames extracted from a travel video. "
                "For each frame, identify any visible location clues:\n"
                "- Storefront signs, restaurant names, business names\n"
                "- Famous landmarks or recognizable buildings\n"
                "- Street signs, neighborhood names\n"
                "- Menu boards, price tags (to identify specific restaurants)\n"
                "- Any text visible in the image\n\n"
                "List every specific, identifiable place name you can find. "
                "Be specific — give the actual name if visible."
            ),
        }
    ]

    for i, frame_data in enumerate(frames):
        b64 = base64.b64encode(frame_data).decode("utf-8")
        content.append(
            {
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": "image/jpeg",
                    "data": b64,
                },
            }
        )
        content.append({"type": "text", "text": f"Frame {i + 1}:"})

    try:
        response = await asyncio.to_thread(
            lambda: client.messages.create(
                model="claude-sonnet-4-20250514",
                max_tokens=800,
                messages=[{"role": "user", "content": content}],
            )
        )

        text = response.content[0].text if response.content else ""

        # Parse locations from the response
        locations = _parse_locations(text)

        return {
            "descriptions": [text],
            "locations_found": locations,
            "success": True,
            "frames_analyzed": len(frames),
        }

    except Exception as e:
        logger.error("Vision analysis failed: %s", e)
        return {
            "descriptions": [],
            "locations_found": [],
            "success": False,
            "error": str(e),
        }


def _parse_locations(text: str) -> list[str]:
    """Extract place names from Claude Vision response text."""
    import re

    locations = []

    # Look for lines that seem to name places (after bullets, dashes, numbers)
    for line in text.split("\n"):
        line = line.strip()
        # Match bullet points or numbered items that look like place names
        match = re.match(r'^[\-\*\d\.]+\s*(.+)', line)
        if match:
            name = match.group(1).strip()
            # Filter out generic descriptions
            if (
                len(name) > 3
                and not name.lower().startswith(("the frame", "this frame", "i can see", "visible"))
            ):
                locations.append(name)

    return locations[:20]  # Cap at 20
