"""Tests for _assert_pipeline_invariants — the production-side audit
that runs at the end of every build, BEFORE items are persisted.

Mirrors the per-helper unit tests in test_post_processing.py: that file
guarantees individual transformations are correct in isolation; this
file guarantees the COMBINED final state passes the cross-cutting
rules (video items intact, no two day-trips on the same day in
different cities, no empty days, no duplicates).
"""
from __future__ import annotations

import pytest

from app.services.orchestrator import (
    PipelineInvariantViolation,
    _assert_pipeline_invariants,
)


def _item(name, day, **kw):
    out = {"name": name, "day": day, "duration_minutes": kw.pop("duration_minutes", 90)}
    out.update(kw)
    return out


# ---------------------------------------------------------------------------
# Critical: video / link items must be present
# ---------------------------------------------------------------------------

class TestVideoItemPreservation:
    def test_clean_pass_when_all_link_mentions_present(self):
        place_list = [
            _item("Casa Rosada", 1, source="link", address="Buenos Aires, Argentina"),
            _item("Eiffel Tower", 1, source="link", address="Paris, France"),
        ]
        mentioned = [
            {"name": "Casa Rosada"},
            {"name": "Eiffel Tower"},
        ]
        result = _assert_pipeline_invariants(
            place_list, places_mentioned=mentioned, num_days=1,
        )
        assert result["violations"] == []

    def test_violation_when_link_mention_dropped(self):
        # Casa Rosada was mentioned but is NOT in place_list.
        place_list = [
            _item("Eiffel Tower", 1, source="link"),
        ]
        mentioned = [
            {"name": "Casa Rosada"},
            {"name": "Eiffel Tower"},
        ]
        result = _assert_pipeline_invariants(
            place_list, places_mentioned=mentioned, num_days=1,
        )
        assert len(result["violations"]) >= 1
        assert "casa rosada" in result["violations"][0].lower()

    def test_strict_raises_on_dropped_video_item(self):
        place_list = [_item("Eiffel Tower", 1, source="link")]
        mentioned = [{"name": "Casa Rosada"}, {"name": "Eiffel Tower"}]
        with pytest.raises(PipelineInvariantViolation):
            _assert_pipeline_invariants(
                place_list,
                places_mentioned=mentioned,
                num_days=1,
                strict=True,
            )

    def test_fuzzy_match_accepts_substring_variants(self):
        """Mention 'Centro Cultural Kirchner' should be considered covered
        by an item named 'CCK - Centro Cultural Kirchner' (substring)."""
        place_list = [
            _item("CCK - Centro Cultural Kirchner", 1, source="link"),
        ]
        mentioned = [{"name": "Centro Cultural Kirchner"}]
        result = _assert_pipeline_invariants(
            place_list, places_mentioned=mentioned, num_days=1,
        )
        assert result["violations"] == []

    def test_alias_dropped_downgrades_to_warning(self):
        """When two mentions share a source_url and only one resolves to
        an item, the unmatched one is treated as an ALIAS — the video's
        content DID reach the itinerary, the extractor just emitted two
        names for the same physical place ('Palácio Errázuriz' is the
        building that houses 'Museu de Arte Decorativa')."""
        place_list = [
            _item("Museu de Arte Decorativa", 1, source="link",
                  address="Av. del Libertador 1902, Buenos Aires, Argentina"),
        ]
        mentioned = [
            {"name": "Palácio Errázuriz", "source_url": "https://vt.tiktok.com/abc"},
            {"name": "Museu de Arte Decorativa", "source_url": "https://vt.tiktok.com/abc"},
        ]
        result = _assert_pipeline_invariants(
            place_list, places_mentioned=mentioned, num_days=1,
        )
        assert result["violations"] == []
        assert any("alias" in w for w in result["warnings"])

    def test_truly_dropped_when_no_sibling_covered(self):
        """If a video's mentions are ALL dropped (no sibling covered), it's
        a real drop — entire video content was lost, NOT an alias case."""
        place_list = [
            _item("Eiffel Tower", 1, source="link"),
        ]
        mentioned = [
            {"name": "Casa Rosada", "source_url": "https://vt.tiktok.com/lost"},
            {"name": "Plaza de Mayo", "source_url": "https://vt.tiktok.com/lost"},
            {"name": "Eiffel Tower", "source_url": "https://vt.tiktok.com/other"},
        ]
        result = _assert_pipeline_invariants(
            place_list, places_mentioned=mentioned, num_days=1,
        )
        # Casa Rosada + Plaza de Mayo BOTH dropped from the same source —
        # no sibling covered → CRITICAL. Plaza de Mayo normalizes to "mayo"
        # (the helper strips generic prefixes), so we assert the count and
        # one canonical name.
        assert len(result["violations"]) == 1
        assert "2 link-mentioned" in result["violations"][0]
        assert "casa rosada" in result["violations"][0].lower()


# ---------------------------------------------------------------------------
# Warning: multi-city day-trip on same day
# ---------------------------------------------------------------------------

class TestMultiCityDayTrip:
    def test_warns_on_two_day_trips_in_different_cities(self):
        place_list = [
            _item(
                "Campanópolis", 4,
                activity_model="day_trip",
                duration_minutes=300,
                address="Bariloche 7300, González Catán, Argentina",
            ),
            _item(
                "Parque de la Costa", 4,
                activity_model="day_trip",
                duration_minutes=300,
                address="Vivanco 1509, Tigre, Argentina",
            ),
        ]
        result = _assert_pipeline_invariants(place_list, num_days=5)
        assert any("day 4" in w and "day-trips" in w for w in result["warnings"])

    def test_no_warn_when_same_destination(self):
        place_list = [
            _item(
                "Palace of Versailles", 4,
                activity_model="day_trip",
                duration_minutes=480,
                address="Place d'Armes, 78000 Versailles, France",
            ),
            _item(
                "Hall of Mirrors", 4,
                activity_model="day_trip",
                duration_minutes=300,
                address="78000 Versailles, France",
            ),
        ]
        result = _assert_pipeline_invariants(place_list, num_days=5)
        assert not any("day-trips" in w for w in result["warnings"])


# ---------------------------------------------------------------------------
# Warning: empty days
# ---------------------------------------------------------------------------

class TestEmptyDays:
    def test_warns_on_non_locked_empty_day(self):
        place_list = [_item("A", 1), _item("B", 1)]
        # 5 days total, only day 1 has items
        result = _assert_pipeline_invariants(place_list, num_days=5)
        # Days 2, 3, 4, 5 are empty and should warn.
        empty_warnings = [w for w in result["warnings"] if "empty" in w]
        assert len(empty_warnings) == 4

    def test_skips_locked_empty_days(self):
        """A locked day with no items is the user's choice — don't warn."""
        place_list = [_item("A", 1)]
        result = _assert_pipeline_invariants(
            place_list, num_days=2, day_rigidity={2: "locked"},
        )
        assert not any("day 2" in w and "empty" in w for w in result["warnings"])


# ---------------------------------------------------------------------------
# Warning: duplicate google_place_ids
# ---------------------------------------------------------------------------

class TestDuplicates:
    def test_warns_on_same_place_id_twice(self):
        place_list = [
            _item("Casa Rosada (Day 1)", 1, google_place_id="ChIJabc123"),
            _item("Casa Rosada (Day 4)", 4, google_place_id="ChIJabc123"),
        ]
        result = _assert_pipeline_invariants(place_list, num_days=5)
        assert any("duplicate" in w for w in result["warnings"])

    def test_no_warn_when_all_unique(self):
        place_list = [
            _item("Casa Rosada", 1, google_place_id="ChIJabc123"),
            _item("Eiffel", 2, google_place_id="ChIJxyz999"),
        ]
        result = _assert_pipeline_invariants(place_list, num_days=2)
        assert not any("duplicate" in w for w in result["warnings"])


# ---------------------------------------------------------------------------
# Info / housekeeping
# ---------------------------------------------------------------------------

class TestReportShape:
    def test_returns_info_with_counts(self):
        place_list = [_item("A", 1), _item("B", 1), _item("C", 2)]
        result = _assert_pipeline_invariants(place_list, num_days=2)
        assert result["info"]["total_items"] == 3
        assert result["info"]["days_used"] == 2
        assert result["info"]["num_days"] == 2

    def test_strict_does_not_raise_on_warnings_only(self):
        """strict=True only raises on CRITICAL violations, not warnings."""
        place_list = [_item("A", 1)]  # day 2 will be empty (warning only)
        # Should NOT raise — empty day is a warning, not a violation.
        _assert_pipeline_invariants(place_list, num_days=2, strict=True)
