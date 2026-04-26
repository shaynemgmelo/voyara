"""Tests for the extract-side helpers that turn an extractor's raw
content into the structured 3-section content_text the Haiku profile
analyzer reads.

The trip 41 review surfaced two real bugs these helpers protect against:

  1. Extractors stuff the same caption into title + description +
     captions[0]. The old _extract_content joined all three, so the
     caption appeared 3 times — wasting tokens and biasing Haiku away
     from transcript and on-screen text. _build_structured_content now
     deduplicates so the [CAPTION] section appears at most once with
     the unique text.

  2. Sources occasionally come back empty (Whisper down, Vision OCR
     unauthorized, oEmbed blocked) and downstream silently degrades.
     _audit_extracted_sources logs ERROR when 2+ sources are missing
     and WARN for one missing — neither slipped through the old code.
"""
from __future__ import annotations

from types import SimpleNamespace


# ---------------------------------------------------------------------------
# _build_structured_content
# ---------------------------------------------------------------------------

class TestBuildStructuredContent:
    def test_caption_appears_only_once_when_title_eq_description_eq_captions0(self):
        """The trip 41 bug. TikTok extractor sets title = description =
        captions[0] = same string. The output must contain the caption
        text only once, not three times."""
        from app.services.orchestrator import _build_structured_content
        caption = "6 PASSEIOS EM BUENOS AIRES 1️⃣ Campanópolis"
        out = _build_structured_content(SimpleNamespace(
            title=caption,
            description=caption,
            captions=[caption],
            comments=[],
        ))
        assert out.count("Campanópolis") == 1
        assert out.startswith("[CAPTION]")

    def test_three_sections_when_all_present(self):
        from app.services.orchestrator import _build_structured_content
        out = _build_structured_content(SimpleNamespace(
            title="Caption text",
            description="Caption text",
            captions=[
                "Caption text",
                "[TRANSCRIPT] said hello",
                "[ON-SCREEN TEXT] sticker says X",
            ],
            comments=[],
        ))
        assert "[CAPTION]\nCaption text" in out
        assert "[TRANSCRIPT]\nsaid hello" in out
        assert "[ON-SCREEN TEXT]\nsticker says X" in out

    def test_skips_empty_sections(self):
        from app.services.orchestrator import _build_structured_content
        # Only transcript present.
        out = _build_structured_content(SimpleNamespace(
            title=None,
            description=None,
            captions=["[TRANSCRIPT] only audio"],
            comments=[],
        ))
        assert "[CAPTION]" not in out
        assert "[ON-SCREEN TEXT]" not in out
        assert "[TRANSCRIPT]\nonly audio" in out

    def test_falls_back_to_title_when_description_empty(self):
        from app.services.orchestrator import _build_structured_content
        out = _build_structured_content(SimpleNamespace(
            title="Trip Title",
            description=None,
            captions=[],
            comments=[],
        ))
        assert "[CAPTION]\nTrip Title" in out

    def test_extra_unique_caption_entries_get_appended(self):
        """If captions list has untagged entries beyond what's already
        in description (e.g. a separate hashtag block), they get added
        to the caption section — but only if NEW."""
        from app.services.orchestrator import _build_structured_content
        out = _build_structured_content(SimpleNamespace(
            title="Main caption",
            description="Main caption",
            captions=["Main caption", "Extra hashtag block #x #y"],
            comments=[],
        ))
        assert out.count("Main caption") == 1
        assert "Extra hashtag block" in out

    def test_substring_capture_skips_redundant_entry(self):
        """An untagged caption entry that's a substring of the existing
        caption shouldn't be appended a second time."""
        from app.services.orchestrator import _build_structured_content
        out = _build_structured_content(SimpleNamespace(
            title="Long caption with all the details and more text",
            description="Long caption with all the details and more text",
            captions=[
                "Long caption with all the details and more text",
                "with all the details",  # subset of caption
            ],
            comments=[],
        ))
        assert out.count("with all the details") == 1

    def test_comments_section_when_present(self):
        from app.services.orchestrator import _build_structured_content
        out = _build_structured_content(SimpleNamespace(
            title="Cap",
            description="Cap",
            captions=["[TRANSCRIPT] said X"],
            comments=["nice video!", "love it", ""],
        ))
        assert "[COMMENTS]" in out
        assert "nice video!" in out
        assert "love it" in out

    def test_returns_empty_when_extractor_produced_nothing(self):
        from app.services.orchestrator import _build_structured_content
        out = _build_structured_content(SimpleNamespace(
            title=None,
            description=None,
            captions=[],
            comments=[],
        ))
        assert out == ""


# ---------------------------------------------------------------------------
# _audit_extracted_sources
# ---------------------------------------------------------------------------

class TestAuditExtractedSources:
    def test_clean_pass_when_all_three_present(self, caplog):
        from app.services.orchestrator import _audit_extracted_sources
        text = "[CAPTION]\nx\n\n[TRANSCRIPT]\ny\n\n[ON-SCREEN TEXT]\nz"
        with caplog.at_level("WARNING"):
            result = _audit_extracted_sources(text, "https://example/video")
        assert result["missing"] == []
        # No WARNING or ERROR records.
        assert not [r for r in caplog.records if r.levelname in ("WARNING", "ERROR")]

    def test_warns_when_one_source_missing(self, caplog):
        from app.services.orchestrator import _audit_extracted_sources
        text = "[CAPTION]\nx\n\n[TRANSCRIPT]\ny"  # no ON-SCREEN
        with caplog.at_level("WARNING"):
            result = _audit_extracted_sources(text, "https://example/video")
        assert result["missing"] == ["ON-SCREEN TEXT"]
        warns = [r for r in caplog.records if r.levelname == "WARNING"]
        assert any("ON-SCREEN TEXT" in r.getMessage() for r in warns)

    def test_errors_when_two_sources_missing(self, caplog):
        from app.services.orchestrator import _audit_extracted_sources
        text = "[CAPTION]\nx"  # no TRANSCRIPT, no ON-SCREEN
        with caplog.at_level("ERROR"):
            result = _audit_extracted_sources(text, "https://example/video")
        assert len(result["missing"]) == 2
        errors = [r for r in caplog.records if r.levelname == "ERROR"]
        assert any("2/3 sources missing" in r.getMessage() for r in errors)

    def test_returns_per_source_flags(self):
        from app.services.orchestrator import _audit_extracted_sources
        result = _audit_extracted_sources(
            "[CAPTION]\nx\n\n[ON-SCREEN TEXT]\nz",
            "https://example/video",
        )
        assert result["has_caption"] is True
        assert result["has_transcript"] is False
        assert result["has_on_screen"] is True


# ---------------------------------------------------------------------------
# _split_content_by_source
# ---------------------------------------------------------------------------

class TestSplitContentBySource:
    def test_splits_on_source_marker(self):
        from app.services.orchestrator import _split_content_by_source
        content = (
            "--- Source: https://a ---\n"
            "video A content\n"
            "--- Source: https://b ---\n"
            "video B content"
        )
        out = _split_content_by_source(content)
        assert len(out) == 2
        assert "https://a" in out[0]
        assert "https://b" in out[1]
        assert "video A" in out[0]
        assert "video B" in out[1]

    def test_no_marker_returns_single_chunk(self):
        from app.services.orchestrator import _split_content_by_source
        out = _split_content_by_source("Just plain content with no markers")
        assert len(out) == 1
        assert out[0] == "Just plain content with no markers"

    def test_empty_input_returns_empty_list(self):
        from app.services.orchestrator import _split_content_by_source
        assert _split_content_by_source("") == []

    def test_each_chunk_keeps_source_marker_for_reattachment(self):
        from app.services.orchestrator import _split_content_by_source
        content = "--- Source: https://x ---\ncontent x"
        out = _split_content_by_source(content)
        assert out[0].startswith("--- Source:")
