"""Transcrever uma gravação de áudio via Groq Whisper (large-v3-turbo).

Usa a mesma API que o pipeline já usa pra extrair áudio dos vídeos do
TikTok/Instagram — então não precisa de novas chaves nem dependências
extras (groq_api_key já está no .env).

Limites Groq (free tier):
  - 25 MB por request (~30 min de áudio comprimido)
  - Acima disso, o script auto-divide com ffmpeg em pedaços de 20 min
    (precisa do ffmpeg instalado: `brew install ffmpeg`).

Suporta formatos: m4a, mp3, mp4, mpeg, mpga, wav, webm.

Uso (de ai_service/):
  python -m scripts.transcribe ~/Documents/recording.m4a
  python -m scripts.transcribe ~/recording.m4a --out transcript.txt
  python -m scripts.transcribe ~/recording.m4a --lang pt
  python -m scripts.transcribe ~/recording.m4a --copy   # copia pra clipboard

Sai pelo stdout (default) ou arquivo (--out). Auto-detecta idioma
(pt-BR/en/es) por default — passe --lang se quiser forçar.
"""
from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import requests

from app.config import settings

GROQ_URL = "https://api.groq.com/openai/v1/audio/transcriptions"
MAX_BYTES = 24 * 1024 * 1024  # 24 MB to leave headroom under Groq's 25 MB cap
CHUNK_SECONDS = 20 * 60  # 20-min chunks when splitting


def _groq_transcribe(audio_path: Path, language: str | None = None) -> str:
    api_key = settings.groq_api_key or os.environ.get("GROQ_API_KEY", "")
    if not api_key:
        sys.exit("ERRO: GROQ_API_KEY não está no ai_service/.env")

    with audio_path.open("rb") as f:
        files = {"file": (audio_path.name, f, "audio/mpeg")}
        data: dict[str, str] = {
            "model": "whisper-large-v3-turbo",
            "response_format": "text",
        }
        if language:
            data["language"] = language
        resp = requests.post(
            GROQ_URL,
            headers={"Authorization": f"Bearer {api_key}"},
            files=files,
            data=data,
            timeout=180,
        )
    if resp.status_code != 200:
        sys.exit(
            f"ERRO Groq {resp.status_code}: {resp.text[:300]}"
        )
    return resp.text.strip()


def _split_with_ffmpeg(src: Path, out_dir: Path) -> list[Path]:
    """Split src into ~20-min chunks using ffmpeg's segment muxer."""
    if not shutil.which("ffmpeg"):
        sys.exit(
            "ERRO: arquivo > 24MB e ffmpeg não está instalado. "
            "Roda `brew install ffmpeg` ou comprima o áudio antes."
        )
    pattern = str(out_dir / "chunk_%03d.m4a")
    subprocess.run(
        [
            "ffmpeg", "-loglevel", "error", "-y", "-i", str(src),
            "-f", "segment", "-segment_time", str(CHUNK_SECONDS),
            "-c", "copy", "-reset_timestamps", "1", pattern,
        ],
        check=True,
    )
    chunks = sorted(out_dir.glob("chunk_*.m4a"))
    if not chunks:
        sys.exit("ERRO: ffmpeg não produziu chunks — formato incompatível?")
    return chunks


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("audio", help="caminho do arquivo de áudio")
    ap.add_argument(
        "--out", help="escrever a transcrição neste arquivo (default: stdout)",
    )
    ap.add_argument(
        "--lang",
        help="idioma forçado (ISO 639-1: pt, en, es). Default: auto-detect.",
    )
    ap.add_argument(
        "--copy", action="store_true",
        help="copia a transcrição pro clipboard via pbcopy (macOS)",
    )
    args = ap.parse_args()

    src = Path(args.audio).expanduser().resolve()
    if not src.exists():
        sys.exit(f"ERRO: arquivo não encontrado: {src}")

    size = src.stat().st_size
    print(f"→ {src.name} ({size / (1024*1024):.1f} MB)", file=sys.stderr)

    if size <= MAX_BYTES:
        text = _groq_transcribe(src, language=args.lang)
    else:
        print(f"  arquivo > 24 MB — dividindo em chunks de {CHUNK_SECONDS // 60} min", file=sys.stderr)
        with tempfile.TemporaryDirectory() as tmp:
            chunks = _split_with_ffmpeg(src, Path(tmp))
            parts: list[str] = []
            for i, ch in enumerate(chunks, 1):
                print(f"  chunk {i}/{len(chunks)}: transcrevendo…", file=sys.stderr)
                parts.append(_groq_transcribe(ch, language=args.lang))
            text = "\n\n".join(parts)

    if args.out:
        Path(args.out).write_text(text + "\n", encoding="utf-8")
        print(f"✓ transcrição salva em {args.out} ({len(text)} chars)", file=sys.stderr)
    else:
        print(text)

    if args.copy:
        if shutil.which("pbcopy"):
            subprocess.run(["pbcopy"], input=text, text=True, check=True)
            print(f"✓ copiado pro clipboard ({len(text)} chars)", file=sys.stderr)
        else:
            print("⚠ pbcopy não disponível (não é macOS?), pulei --copy", file=sys.stderr)


if __name__ == "__main__":
    main()
