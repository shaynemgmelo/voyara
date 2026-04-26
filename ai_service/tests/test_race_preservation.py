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


@pytest.mark.asyncio
async def test_reenrich_does_not_clobber_existing_creator_notes():
    """reenrich_trip_places adds editorial_summary + top_reviews to
    places that lack them. It must NOT remove the creator_note that
    Haiku already attached. Otherwise the modal's "Notes from the
    Community" section silently empties on the next reenrich tick."""
    from app.services.orchestrator import reenrich_trip_places

    enriched = [{
        "name": "Café de Flore",
        "google_place_id": "ChIJ...",
        "latitude": 48.85, "longitude": 2.33,
        "creator_note": "Recomenda sentar na terrasse",
        "community_notes": [{
            "note": "Famoso café histórico",
            "source_url": "https://video1",
            "source_platform": "tiktok",
        }],
    }]
    rails = FakeRails({
        "id": 9, "destination": "Paris", "ai_mode": "manual",
        "profile_status": "confirmed",
        "traveler_profile": {"places_mentioned": enriched},
        "links": [],
    })
    # Stub Google Places to "succeed" but return no editorial_summary
    # — i.e. the reenrich finds nothing new but should preserve everything.
    class StubClient:
        async def get_details(self, _): return {"editorial_summary": ""}
        async def close(self): pass
    with patch("app.services.orchestrator.RailsClient", return_value=rails), \
         patch("app.services.orchestrator.GooglePlacesClient", return_value=StubClient()):
        await reenrich_trip_places(9)

    if rails.updates:
        # If a write happened, it must preserve creator_note + community_notes.
        final = rails.updates[-1]["traveler_profile"]["places_mentioned"]
        assert final[0]["creator_note"] == "Recomenda sentar na terrasse"
        assert final[0]["community_notes"][0]["note"] == "Famoso café histórico"


@pytest.mark.asyncio
async def test_manual_assist_does_not_strip_geo_from_existing_items():
    """manual_assist_organize moves places into days. The lat/lng/photo
    on each place must survive the conversion into itinerary_item
    payloads — otherwise the item lands without coords and the map pin
    silently disappears (trip 44 bug class)."""
    from app.services.orchestrator import _build_assist_item

    place = {
        "name": "Caminito",
        "category": "attraction",
        "source_url": "https://x",
        "latitude": -34.6, "longitude": -58.37,
        "google_place_id": "ChIJ...",
        "rating": 4.5, "reviews_count": 100,
        "address": "Caminito, BA",
    }
    item = _build_assist_item(place)
    assert item["latitude"] == -34.6
    assert item["longitude"] == -58.37
    assert item["google_place_id"] == "ChIJ..."
    assert item["google_rating"] == 4.5
    assert item["google_reviews_count"] == 100
    assert item["address"] == "Caminito, BA"
