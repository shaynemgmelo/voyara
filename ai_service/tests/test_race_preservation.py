"""Trip 43 spent two hours debugging "no data" cards. Cause: analyze_trip
fired AFTER extract_profile_and_build had geocoded the places, then
overwrote the enriched places_mentioned with the bare Haiku output —
losing every lat/lng. The fix is the existing 'preserve when ≥3
enriched + ≥50% with geo' rule. This test pins it."""
from __future__ import annotations
import copy
from unittest.mock import patch, AsyncMock
import pytest

pytestmark = pytest.mark.contracts


class FakeRails:
    def __init__(self, trip):
        self._trip = trip
        self.updates = []

    async def get_trip(self, _):
        return copy.deepcopy(self._trip)

    async def update_trip(self, _, payload):
        self.updates.append(payload)
        if "traveler_profile" in payload:
            self._trip["traveler_profile"] = payload["traveler_profile"]
        return {"id": 1}

    async def update_link(self, trip_id, link_id, **kwargs):  # noqa: ARG002
        return {"id": link_id}

    async def get_links(self, trip_id):  # noqa: ARG002
        return []


@pytest.mark.asyncio
async def test_analyze_trip_preserves_enriched_places_mentioned():
    """If a previous enrichment pass already set lat/lng + photo on
    places_mentioned, analyze_trip must NOT clobber them with the bare
    Haiku output."""
    from app.services.orchestrator import analyze_trip

    enriched = [
        {"name": "Caminito", "latitude": -34.6, "longitude": -58.37,
         "google_place_id": "gp1", "photo_url": "https://x"},
        {"name": "Obelisco", "latitude": -34.6, "longitude": -58.38,
         "google_place_id": "gp2", "photo_url": "https://y"},
        {"name": "Casa Rosada", "latitude": -34.6, "longitude": -58.37,
         "google_place_id": "gp3", "photo_url": "https://z"},
    ]
    rails = FakeRails({
        "id": 1, "destination": "BA", "ai_mode": "manual",
        "profile_status": "confirmed",
        "traveler_profile": {"places_mentioned": enriched},
        "links": [{"id": 1, "extracted_data": {"content_text": "x"}}],
    })

    bare = [{"name": "Caminito"}, {"name": "Obelisco"}, {"name": "Casa Rosada"}]
    with patch("app.services.orchestrator.RailsClient", return_value=rails), \
         patch("app.services.orchestrator._analyze_profile",
               new=AsyncMock(return_value={"places_mentioned": bare,
                                            "country_detected": "Argentina",
                                            "cities_detected": ["BA"]})):
        await analyze_trip(1)

    assert rails.updates, "analyze_trip never wrote anything"
    final_places = rails.updates[-1]["traveler_profile"]["places_mentioned"]
    by_name = {p["name"]: p for p in final_places}
    for name in ("Caminito", "Obelisco", "Casa Rosada"):
        assert by_name[name].get("latitude") is not None, (
            f"{name} lost latitude after analyze_trip race")


@pytest.mark.asyncio
async def test_merge_link_preserves_existing_enriched_places():
    """merge_link must never overwrite an existing place's geo when it
    finds a duplicate name. Trip 41/43 surfaced this earlier."""
    from app.services.orchestrator import merge_link_into_existing_trip

    enriched = [{
        "name": "Caminito", "latitude": -34.6, "longitude": -58.37,
        "photo_url": "https://x", "google_place_id": "gp1",
    }]
    rails = FakeRails({
        "id": 7, "destination": "BA", "ai_mode": "eco",
        "profile_status": "confirmed",
        "traveler_profile": {"places_mentioned": enriched},
    })

    haiku_dup = AsyncMock(return_value={
        "places_mentioned": [{"name": "Caminito", "creator_note": "go at sunrise"}]
    })
    with patch("app.services.orchestrator.RailsClient", return_value=rails), \
         patch("app.services.orchestrator._extract_content",
               new=AsyncMock(return_value="x")), \
         patch("app.services.orchestrator._analyze_profile", new=haiku_dup):
        await merge_link_into_existing_trip(
            link_id=42, trip_id=7, url="https://new", platform="tiktok",
        )

    final = rails.updates[-1]["traveler_profile"]["places_mentioned"]
    assert len(final) == 1
    assert final[0]["latitude"] == -34.6      # preserved
    assert final[0]["photo_url"] == "https://x"  # preserved
    # And the new note grew on community_notes (the dedup-aggregation rule).
    assert any("sunrise" in (n.get("note") or "")
               for n in final[0].get("community_notes", []))
