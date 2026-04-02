from __future__ import annotations

from abc import ABC, abstractmethod

from pydantic import BaseModel


class ExtractedContent(BaseModel):
    """Structured content extracted from a URL."""

    platform: str
    url: str
    title: str | None = None
    description: str | None = None
    captions: list[str] = []
    comments: list[str] = []
    audio_transcript: str | None = None
    frame_descriptions: list[str] = []
    raw_text: str | None = None
    metadata: dict = {}
    has_video: bool = False
    video_path: str | None = None  # temp file path if downloaded

    def summary_text(self) -> str:
        """Combine all text into a single string for Claude analysis."""
        parts = []
        if self.title:
            parts.append(f"Title: {self.title}")
        if self.description:
            parts.append(f"Description: {self.description}")
        if self.captions:
            parts.append(f"Captions: {' | '.join(self.captions)}")
        if self.comments:
            parts.append(f"Comments ({len(self.comments)}):")
            for c in self.comments[:20]:  # Limit to 20 comments
                parts.append(f"  - {c}")
        if self.audio_transcript:
            parts.append(f"Audio Transcript: {self.audio_transcript}")
        if self.frame_descriptions:
            parts.append(f"Frame Analysis: {' | '.join(self.frame_descriptions)}")
        if self.raw_text:
            parts.append(f"Page Text: {self.raw_text[:3000]}")
        return "\n".join(parts)


class BaseExtractor(ABC):
    """Base class for platform-specific content extractors."""

    @abstractmethod
    async def extract(self, url: str) -> ExtractedContent:
        """Extract content from a URL."""
        ...

    @abstractmethod
    def can_handle(self, url: str) -> bool:
        """Check if this extractor can handle the given URL."""
        ...
