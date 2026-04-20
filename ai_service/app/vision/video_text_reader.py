"""Read on-screen text from a video — OCR via Claude Vision.

Many TikToks/Reels show place names as overlay text ("1. Campanópolis",
"2. Barrio Chino", captions on signs, price tags). This module extracts
representative keyframes and asks Claude Vision to transcribe any visible
text, with a focus on place/business names.

Cached per-URL like the audio transcriber so repeat analyses are free.
"""

from __future__ import annotations

import asyncio
import base64
import logging
import os
import subprocess
import tempfile
import time
from pathlib import Path
from typing import Optional

import anthropic

from app.config import settings
from app.extractors.audio_download import _get_ffmpeg_path

logger = logging.getLogger(__name__)

# In-memory cache keyed by URL
_CACHE: dict[str, tuple[float, str]] = {}
_CACHE_TTL_SECONDS = 60 * 60 * 6

# Tuning — balance coverage vs memory. 14 frames at 960px still catches
# Day 1/2/3 reveals, uses ~half the RAM of 20 frames at 1280px.
MAX_FRAMES = 14
FRAME_QUALITY = 4  # ffmpeg -q:v (1=best, 31=worst). 4 = smaller, OCR still fine.
MAX_FRAME_SIDE_PX = 960


def _cache_get(url: str) -> Optional[str]:
    entry = _CACHE.get(url)
    if not entry:
        return None
    ts, text = entry
    if time.time() - ts > _CACHE_TTL_SECONDS:
        del _CACHE[url]
        return None
    return text


def _cache_set(url: str, text: str) -> None:
    _CACHE[url] = (time.time(), text)


async def read_video_text(url: str, timeout: float = 45.0) -> str:
    """Download the video, extract keyframes, run OCR via Claude Vision.

    Returns on-screen text concatenated, ready to be appended to the
    extractor's captions list. Never raises.
    """
    cached = _cache_get(url)
    if cached is not None:
        logger.info("[vision] Cache hit for %s (%d chars)", url, len(cached))
        return cached

    try:
        text = await asyncio.wait_for(
            asyncio.to_thread(_sync_pipeline, url), timeout=timeout
        )
    except asyncio.TimeoutError:
        logger.warning("[vision] Timed out reading frames from %s", url)
        text = ""
    except Exception as e:
        logger.warning("[vision] Failed for %s: %s", url, e)
        text = ""

    _cache_set(url, text)
    return text


def _sync_pipeline(url: str) -> str:
    """Download → extract frames → Vision OCR. Runs in a worker thread."""
    import gc

    with tempfile.TemporaryDirectory(prefix="mapass-frames-") as tmpdir:
        video_path = _download_video(url, tmpdir)
        if not video_path:
            return ""
        # Delete the source video as soon as frames are extracted — we
        # don't need both sitting in memory/disk.
        frames = _extract_frames(video_path, tmpdir, MAX_FRAMES)
        try:
            os.unlink(video_path)
        except OSError:
            pass
        if not frames:
            return ""
        result = _vision_ocr(frames)
        # Free the list of frame bytes before returning
        frames.clear()
        gc.collect()
        return result


def _download_video(url: str, tmpdir: str) -> Optional[str]:
    """Download the lowest-res version to keep bytes/time small."""
    import yt_dlp

    output_template = os.path.join(tmpdir, "video.%(ext)s")
    ydl_opts = {
        "quiet": True,
        "no_warnings": True,
        "format": "worst[height<=480]/worst",
        "outtmpl": output_template,
        "max_filesize": 40_000_000,
        "socket_timeout": 20,
        "retries": 1,
    }
    ffmpeg = _get_ffmpeg_path()
    if ffmpeg:
        ydl_opts["ffmpeg_location"] = ffmpeg

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            ydl.download([url])
    except Exception as e:
        logger.warning("[vision] yt-dlp failed for %s: %s", url, e)
        return None

    for f in os.listdir(tmpdir):
        if f.startswith("video.") and not f.endswith((".mp3", ".part")):
            return os.path.join(tmpdir, f)
    return None


def _extract_frames(video_path: str, tmpdir: str, num_frames: int) -> list[bytes]:
    """Extract `num_frames` evenly-spaced frames using ffmpeg."""
    ffmpeg = _get_ffmpeg_path() or "ffmpeg"

    # Probe duration (fall back to 30s if unknown)
    try:
        probe = subprocess.run(
            [
                ffmpeg,
                "-i", video_path,
                "-hide_banner",
                "-f", "null",
                "-",
            ],
            capture_output=True,
            timeout=10,
        )
        stderr = (probe.stderr or b"").decode(errors="ignore")
        duration = _parse_duration(stderr) or 30.0
    except Exception:
        duration = 30.0

    frames: list[bytes] = []
    # Evenly spaced timestamps, skipping the very start/end
    step = duration / (num_frames + 1)
    timestamps = [step * (i + 1) for i in range(num_frames)]

    for t in timestamps:
        out_path = os.path.join(tmpdir, f"f_{int(t * 1000)}.jpg")
        try:
            result = subprocess.run(
                [
                    ffmpeg,
                    "-ss", f"{t:.2f}",
                    "-i", video_path,
                    "-frames:v", "1",
                    "-vf", f"scale='min({MAX_FRAME_SIDE_PX},iw)':-2",
                    "-q:v", str(FRAME_QUALITY),
                    "-y",
                    out_path,
                ],
                capture_output=True,
                timeout=8,
            )
            if result.returncode == 0 and os.path.exists(out_path):
                with open(out_path, "rb") as fh:
                    frames.append(fh.read())
        except Exception as e:
            logger.debug("[vision] Frame at %.2fs failed: %s", t, e)
            continue

    return frames


def _parse_duration(ffmpeg_stderr: str) -> Optional[float]:
    import re

    m = re.search(r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)", ffmpeg_stderr)
    if not m:
        return None
    h, mn, s = int(m.group(1)), int(m.group(2)), float(m.group(3))
    return h * 3600 + mn * 60 + s


def _vision_ocr(frames: list[bytes]) -> str:
    """Send frames to Claude Vision. Return a single concatenated text
    block that our Haiku prompt can scan for place names."""
    client = anthropic.Anthropic(api_key=settings.anthropic_api_key)

    content: list[dict] = [
        {
            "type": "text",
            "text": (
                "Estou enviando {n} frames de um vídeo curto de viagem. "
                "Preciso que você leia cada frame um por um e transcreva "
                "EXAUSTIVAMENTE todo texto visível relacionado a lugares.\n\n"
                "PARA CADA FRAME, liste tudo que for:\n"
                "• Texto sobreposto (legendas, captions, listas numeradas)\n"
                "• Nome de lugar (rua, avenida, bairro, praça, ponte, "
                "museu, teatro, parque, mercado, restaurante, bar, igreja, "
                "catedral, centro cultural, galeria, shopping, mirante)\n"
                "• Placas, fachadas, letreiros\n"
                "• Cabeçalhos estruturais: 'DIA 1', 'DIA 2', 'ROTEIRO 3 DIAS'\n"
                "• Instruções com nomes: 'siga para X', 'vá até Y', 'almoce em Z'\n\n"
                "REGRAS:\n"
                "1. Transcreva LITERAL. Se está escrito 'Casa Rosada', "
                "escreva 'Casa Rosada'. Não resuma, não reescreva.\n"
                "2. Itere TODOS os {n} frames — não pule nenhum.\n"
                "3. Mesmo que o texto seja pequeno ou borrado, tente ler.\n"
                "4. Inclua até nomes genéricos que o criador tenha escrito "
                "(ex: 'Praça Domingo Perón' mesmo soando genérico).\n"
                "5. Um item por linha. Dedupe ao final.\n\n"
                "Formato de saída (apenas texto, sem comentários):\n"
                "1. Campanópolis\n"
                "2. Barrio Chino\n"
                "DIA 1\n"
                "Casa Rosada\n"
                "Avenida 9 de Julho\n"
                "Praça Domingo Perón\n"
                "Catedral Metropolitana\n"
                "Galerías Pacífico\n"
                "...\n\n"
                "Se nenhum frame tiver texto legível: responda 'NENHUM TEXTO'."
            ).format(n=len(frames)),
        }
    ]
    for fb in frames:
        b64 = base64.b64encode(fb).decode("utf-8")
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

    try:
        response = client.messages.create(
            model="claude-haiku-4-5-20251001",  # Haiku with vision — cheaper/faster
            max_tokens=2000,  # room for full numbered lists
            messages=[{"role": "user", "content": content}],
        )
        text = response.content[0].text if response.content else ""
    except Exception as e:
        logger.warning("[vision] Vision call failed: %s", e)
        return ""

    text = text.strip()
    if not text or text.upper().startswith("NENHUM TEXTO"):
        logger.info("[vision] No readable on-screen text in %d frames", len(frames))
        return ""

    logger.info(
        "[vision] Read %d chars of on-screen text from %d frames",
        len(text),
        len(frames),
    )
    return text
