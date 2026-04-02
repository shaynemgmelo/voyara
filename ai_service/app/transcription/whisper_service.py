import asyncio
import logging

from app.config import settings

logger = logging.getLogger(__name__)

# Lazy-loaded model
_model = None


def _get_model():
    global _model
    if _model is None:
        from faster_whisper import WhisperModel

        logger.info("Loading Whisper model: %s", settings.whisper_model_size)
        _model = WhisperModel(
            settings.whisper_model_size,
            device="cpu",
            compute_type="int8",
        )
        logger.info("Whisper model loaded")
    return _model


async def transcribe_audio(file_path: str) -> str:
    """Transcribe audio file to text. Returns the full transcript."""
    return await asyncio.to_thread(_transcribe_sync, file_path)


def _transcribe_sync(file_path: str) -> str:
    model = _get_model()

    try:
        segments, info = model.transcribe(
            file_path,
            beam_size=5,
            language=None,  # Auto-detect language
            vad_filter=True,  # Filter out silence
        )

        logger.info(
            "Transcribing: detected language=%s probability=%.2f",
            info.language,
            info.language_probability,
        )

        transcript_parts = []
        for segment in segments:
            transcript_parts.append(segment.text.strip())

        return " ".join(transcript_parts)

    except Exception as e:
        logger.error("Transcription failed for %s: %s", file_path, e)
        return ""
