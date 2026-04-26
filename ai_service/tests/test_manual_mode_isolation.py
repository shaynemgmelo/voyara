"""Tests that prove AI-side functions REFUSE to touch a manual-mode trip.

Trip 44 surfaced this as a real bug: the user dragged ONE card to Day 1
in manual mode, and a stale frontend auto-trigger called
/api/enrich-experiences. The function happily ran and silently inserted
4 AI-fabricated activities (Harry Potter Studio Tour in Watford, a
Thames cruise, a food tour, a pub jantar) the user never asked for —
plus reordered the existing item via /api/optimize-trip.

The contract for manual mode is "user owns the itinerary, AI shuts up
unless the user clicks 'Assistência IA' explicitly". These tests pin
that contract at the backend level, so even a stale browser tab or a
third-party caller cannot bypass it.

`manual_assist_organize` is the ONE function that's allowed to touch
a manual trip — it's invoked by the explicit "🪄 Assistência IA"
button — so it has its own behavior tests in test_manual_assist.py.
"""
from __future__ import annotations

from unittest.mock import patch

import pytest


class FakeRails:
    """Minimal RailsClient stub that returns a canned trip + day_plans
    snapshot. Tracks whether ANY mutation method was called so the test
    can assert "the function refused without touching anything"."""

    def __init__(self, trip, day_plans=None):
        self._trip = trip
        self._day_plans = day_plans or []
        self.mutations: list[str] = []

    async def get_trip(self, trip_id):  # noqa: ARG002
        return self._trip

    async def get_day_plans(self, trip_id):  # noqa: ARG002
        return self._day_plans

    async def update_trip(self, *args, **kwargs):  # noqa: ARG002
        self.mutations.append("update_trip")
        return {}

    async def create_itinerary_item(self, *args, **kwargs):  # noqa: ARG002
        self.mutations.append("create_itinerary_item")
        return {"id": 999}

    async def update_itinerary_item(self, *args, **kwargs):  # noqa: ARG002
        self.mutations.append("update_itinerary_item")
        return {}


def _manual_trip(items=None):
    return {
        "id": 44,
        "ai_mode": "manual",
        "destination": "London, UK",
        "profile_status": "confirmed",
        "traveler_profile": {"places_mentioned": []},
        "day_plans": items or [],
    }


def _eco_trip(items=None):
    out = _manual_trip(items=items)
    out["ai_mode"] = "eco"
    return out


# ---------------------------------------------------------------------------
# enrich_trip_with_experiences
# ---------------------------------------------------------------------------

class TestEnrichExperiencesRespectsManualMode:
    @pytest.mark.asyncio
    async def test_refuses_to_run_on_manual_trip(self):
        """The big one: trip 44's bug. The function should bail with
        skipped=manual_mode WITHOUT making any Anthropic call or any
        Rails mutation."""
        from app.services.orchestrator import enrich_trip_with_experiences

        rails = FakeRails(_manual_trip())
        with patch("app.services.orchestrator.RailsClient", return_value=rails), \
             patch("app.services.orchestrator.anthropic.Anthropic") as anth:
            result = await enrich_trip_with_experiences(44)

        assert result["skipped"] == "manual_mode"
        assert result["added"] == 0
        # No AI call.
        anth.assert_not_called()
        # No Rails write.
        assert rails.mutations == []

    @pytest.mark.asyncio
    async def test_runs_on_eco_trip(self):
        """Sanity check — non-manual trips still get the enrichment.
        We don't run the full pipeline here (would call Anthropic),
        just verify the early manual_mode bail does NOT fire."""
        from app.services.orchestrator import enrich_trip_with_experiences

        rails = FakeRails(_eco_trip())
        # Patch get_day_plans to return empty so the function exits
        # naturally without calling Anthropic — we only care that the
        # manual-mode early-return didn't trigger.
        with patch("app.services.orchestrator.RailsClient", return_value=rails):
            result = await enrich_trip_with_experiences(44)

        # NOT skipped due to manual_mode (may be skipped for other reasons
        # like "no day_plans" — that's fine, just not the manual reason).
        assert result.get("skipped") != "manual_mode"


# ---------------------------------------------------------------------------
# optimize_trip_routing
# ---------------------------------------------------------------------------

class TestOptimizeRoutingRespectsManualMode:
    @pytest.mark.asyncio
    async def test_refuses_to_reorder_manual_trip(self):
        """Optimizer rewrites position + day + time_slot — exactly what
        a manual-mode user does NOT want. Must bail before any mutation."""
        from app.services.orchestrator import optimize_trip_routing

        rails = FakeRails(_manual_trip())
        with patch("app.services.orchestrator.RailsClient", return_value=rails):
            result = await optimize_trip_routing(44)

        assert result["skipped"] == "manual_mode"
        assert result["changed"] == 0
        assert rails.mutations == []

    @pytest.mark.asyncio
    async def test_no_skip_on_eco_trip(self):
        from app.services.orchestrator import optimize_trip_routing

        rails = FakeRails(_eco_trip())
        with patch("app.services.orchestrator.RailsClient", return_value=rails):
            result = await optimize_trip_routing(44)

        assert result.get("skipped") != "manual_mode"
