"""Tests for `_backfill_place_extras` + `reenrich_trip_places` —
the path that backfills editorial_summary + top_reviews + opening
hours on trips whose places were enriched BEFORE those fields were
added to the schema.

Why this exists: trip 43 (and any trip created before this commit)
has places with google_place_id + lat/lng but no editorial_summary,
so the modal looked bare. The backfill turns "Address + Phone" cards
into the rich detail cards we now expect.

Contract:
  1. Skips places that already have at least one of the new fields.
  2. Skips places without google_place_id (no way to look them up).
  3. Only the new fields are merged in — lat/lng/rating from the
     original enrichment are NEVER overwritten.
  4. Auto-trigger short-circuits when no place needs backfill (cheap).
  5. Persists once with the merged list (one Rails PATCH, not N).
"""
from __future__ import annotations

import copy
from unittest.mock import AsyncMock, patch

import pytest


class FakeRails:
    def __init__(self, trip):
        self._trip = trip
        self.updates: list[dict] = []

    async def get_trip(self, trip_id):  # noqa: ARG002
        return copy.deepcopy(self._trip)

    async def update_trip(self, trip_id, payload):
        self.updates.append({"trip_id": trip_id, "payload": payload})
        if "traveler_profile" in payload:
            self._trip["traveler_profile"] = payload["traveler_profile"]
        return {"id": trip_id}


class FakePlacesClient:
    """Returns a canned details payload for any place_id. Test sets up
    the mapping per-test."""
    def __init__(self, by_place_id):
        self._by_id = by_place_id
        self.calls: list[str] = []

    async def get_details(self, place_id):
        self.calls.append(place_id)
        return self._by_id.get(place_id)

    async def close(self):
        pass


# ---------------------------------------------------------------------------
# _backfill_place_extras
# ---------------------------------------------------------------------------

class TestBackfillPlaceExtras:
    @pytest.mark.asyncio
    async def test_backfills_editorial_summary_and_reviews(self):
        from app.services.orchestrator import _backfill_place_extras

        old_places = [
            {
                "name": "Caminito",
                "google_place_id": "gp-caminito",
                "latitude": -34.6383,
                "longitude": -58.3631,
                "rating": 4.5,
                # editorial_summary + top_reviews missing — old schema
            }
        ]
        client = FakePlacesClient({
            "gp-caminito": {
                "editorial_summary": "Iconic colorful pedestrian street in La Boca.",
                "top_reviews": [
                    {"author": "Maria", "rating": 5, "relative_time": "a month ago", "text": "Stunning colors!"},
                ],
                "operating_hours": {"Monday": "9 AM – 6 PM"},
                "phone": "+54 11 1234-5678",
                "website": "https://caminito.example",
                "photos": ["https://photo/1.jpg"],
            }
        })
        updated, count = await _backfill_place_extras(old_places, client)
        assert count == 1
        p = updated[0]
        assert p["editorial_summary"] == "Iconic colorful pedestrian street in La Boca."
        assert p["top_reviews"][0]["author"] == "Maria"
        assert p["operating_hours"] == {"Monday": "9 AM – 6 PM"}
        assert p["phone"] == "+54 11 1234-5678"
        # Critical race-preservation: original fields unchanged.
        assert p["latitude"] == -34.6383
        assert p["longitude"] == -58.3631
        assert p["rating"] == 4.5

    @pytest.mark.asyncio
    async def test_skips_places_already_backfilled(self):
        from app.services.orchestrator import _backfill_place_extras

        already_done = [
            {
                "name": "Caminito",
                "google_place_id": "gp-caminito",
                "editorial_summary": "Already here.",
            }
        ]
        client = FakePlacesClient({"gp-caminito": {"editorial_summary": "would overwrite"}})
        updated, count = await _backfill_place_extras(already_done, client)
        assert count == 0
        # No client call (skipped before details lookup)
        assert client.calls == []
        assert updated[0]["editorial_summary"] == "Already here."

    @pytest.mark.asyncio
    async def test_skips_when_no_google_place_id(self):
        from app.services.orchestrator import _backfill_place_extras

        unenriched = [{"name": "Mystery Place"}]
        client = FakePlacesClient({})
        updated, count = await _backfill_place_extras(unenriched, client)
        assert count == 0
        assert client.calls == []
        assert updated == unenriched

    @pytest.mark.asyncio
    async def test_handles_details_returning_none(self):
        from app.services.orchestrator import _backfill_place_extras

        places = [{"name": "Caminito", "google_place_id": "gp-x"}]
        client = FakePlacesClient({})  # returns None for any id
        updated, count = await _backfill_place_extras(places, client)
        assert count == 0
        # Place untouched.
        assert updated[0] == places[0]

    @pytest.mark.asyncio
    async def test_does_not_overwrite_existing_phone_when_details_lacks_one(self):
        from app.services.orchestrator import _backfill_place_extras

        places = [{
            "name": "X",
            "google_place_id": "gp-x",
            "phone": "+1 555-0000",
        }]
        client = FakePlacesClient({
            "gp-x": {"editorial_summary": "blurb"}  # no phone in details
        })
        updated, count = await _backfill_place_extras(places, client)
        assert updated[0]["phone"] == "+1 555-0000"
        assert updated[0]["editorial_summary"] == "blurb"
        assert count == 1


# ---------------------------------------------------------------------------
# reenrich_trip_places
# ---------------------------------------------------------------------------

class TestReenrichTripPlaces:
    def _trip(self, places):
        return {
            "id": 7,
            "destination": "Buenos Aires",
            "traveler_profile": {"places_mentioned": list(places)},
        }

    @pytest.mark.asyncio
    async def test_short_circuits_when_no_place_needs_backfill(self):
        from app.services.orchestrator import reenrich_trip_places

        # All places already have editorial_summary
        full = [{"name": "X", "google_place_id": "gp-x", "editorial_summary": "x"}]
        rails = FakeRails(self._trip(full))
        with patch("app.services.orchestrator.RailsClient", return_value=rails), \
             patch("app.services.orchestrator.GooglePlacesClient") as gp:
            result = await reenrich_trip_places(7)
        assert result["skipped"] == "all_current"
        # No Places client constructed.
        gp.assert_not_called()
        # No Rails write.
        assert rails.updates == []

    @pytest.mark.asyncio
    async def test_short_circuits_when_no_places(self):
        from app.services.orchestrator import reenrich_trip_places

        rails = FakeRails(self._trip([]))
        with patch("app.services.orchestrator.RailsClient", return_value=rails):
            result = await reenrich_trip_places(7)
        assert result["skipped"] == "no_places"

    @pytest.mark.asyncio
    async def test_short_circuits_when_trip_not_found(self):
        from app.services.orchestrator import reenrich_trip_places

        class MissingRails:
            async def get_trip(self, _):
                return None
        with patch("app.services.orchestrator.RailsClient", return_value=MissingRails()):
            result = await reenrich_trip_places(999)
        assert result["skipped"] == "trip_not_found"

    @pytest.mark.asyncio
    async def test_rich_descriptions_skipped_when_no_link_content(self):
        """Without any extracted Link content the rich-description
        backfill can't ground its prompts in the source video — so it
        should bail without calling Haiku at all (no spurious cost)."""
        from app.services.orchestrator import _generate_rich_descriptions_batch
        from app.ai.cost_tracker import CostTracker

        places = [{"name": "Caminito"}]  # no creator_note, no editorial_summary
        cost = CostTracker()
        with patch("app.services.orchestrator.anthropic.Anthropic") as anth:
            updated, count = await _generate_rich_descriptions_batch(
                places, "Buenos Aires", [], cost,
            )
        assert count == 0
        assert updated == places
        anth.assert_not_called()

    @pytest.mark.asyncio
    async def test_rich_descriptions_skip_places_already_filled(self):
        """Places that already have any of the rich fields are skipped."""
        from app.services.orchestrator import _generate_rich_descriptions_batch
        from app.ai.cost_tracker import CostTracker

        places = [
            {"name": "Has Editorial", "editorial_summary": "ok"},
            {"name": "Has Note", "creator_note": "ok"},
            {"name": "Has Rich", "rich_description": "ok"},
        ]
        link_contents = [{"url": "https://x", "content_text": "stuff"}]
        cost = CostTracker()
        with patch("app.services.orchestrator.anthropic.Anthropic") as anth:
            updated, count = await _generate_rich_descriptions_batch(
                places, "Buenos Aires", link_contents, cost,
            )
        # All three skipped → no Haiku call.
        assert count == 0
        anth.assert_not_called()

    @pytest.mark.asyncio
    async def test_persists_merged_profile_when_backfill_happens(self):
        from app.services.orchestrator import reenrich_trip_places

        old = [
            {"name": "Caminito", "google_place_id": "gp-1", "latitude": -34.6, "longitude": -58.4},
            {"name": "San Telmo", "google_place_id": "gp-2", "latitude": -34.6, "longitude": -58.3},
        ]
        rails = FakeRails(self._trip(old))
        fake_client = FakePlacesClient({
            "gp-1": {"editorial_summary": "A street in La Boca.", "top_reviews": []},
            "gp-2": {"editorial_summary": "Historic neighborhood.", "top_reviews": []},
        })
        with patch("app.services.orchestrator.RailsClient", return_value=rails), \
             patch("app.services.orchestrator.GooglePlacesClient", return_value=fake_client):
            result = await reenrich_trip_places(7)

        assert result["backfilled"] == 2
        assert result["total_places"] == 2

        # One single PATCH containing the merged places_mentioned.
        assert len(rails.updates) == 1
        merged = rails.updates[0]["payload"]["traveler_profile"]["places_mentioned"]
        assert merged[0]["editorial_summary"] == "A street in La Boca."
        assert merged[1]["editorial_summary"] == "Historic neighborhood."
        # Original fields preserved.
        assert merged[0]["latitude"] == -34.6
        assert merged[1]["latitude"] == -34.6
