"""Tests for `merge_link_into_existing_trip` — the function that
runs when the user adds a NEW link to a trip whose itinerary is
already built. It must:

  1. Skip entirely when the trip isn't yet in profile_status="confirmed"
     (the regular extract_profile_and_build pipeline owns that state).
  2. Extract the link's content, pass it to Haiku, and append the new
     places to the existing traveler_profile.places_mentioned.
  3. Dedupe with AGGREGATION: a place that ALREADY exists in the trip's
     profile gets its new creator_note grafted onto its community_notes
     list (so the modal can show "Notes from the Community" with bullets
     from EVERY video that mentioned this place). Same-text notes are
     deduped so re-running on the same link is a no-op.
  4. Force the new entries' source_url to the URL we just processed,
     so the panel groups them under the right "from this video" header.
  5. In manual mode, geocode the brand-new places (Google Places) so
     the cards have photo/rating + map pin immediately.
  6. NEVER touch existing places_mentioned fields other than
     community_notes — race-preservation for lat/lng/photo/rating.

All Anthropic, Rails, Google Places calls are mocked. Network is
already blocked by conftest.py's autouse fixture.
"""
from __future__ import annotations

import copy
from unittest.mock import AsyncMock, patch

import pytest


# ---------------------------------------------------------------------------
# Stubs
# ---------------------------------------------------------------------------

class FakeRails:
    def __init__(self, trip):
        self._trip = trip
        self.updates: list[dict] = []  # [{trip_id, payload}]
        self.link_updates: list[dict] = []

    async def get_trip(self, trip_id):  # noqa: ARG002
        return copy.deepcopy(self._trip)

    async def update_trip(self, trip_id, payload):
        self.updates.append({"trip_id": trip_id, "payload": payload})
        # Mirror persistence so a second call to get_trip sees the change.
        if "traveler_profile" in payload:
            self._trip["traveler_profile"] = payload["traveler_profile"]
        return {"id": trip_id}

    async def update_link(self, trip_id, link_id, **kwargs):  # noqa: ARG002
        self.link_updates.append({"link_id": link_id, **kwargs})
        return {"id": link_id}


def _trip_built(places_mentioned=None, ai_mode="manual"):
    """A trip that's already past the build phase (profile confirmed)."""
    return {
        "id": 7,
        "destination": "Buenos Aires",
        "ai_mode": ai_mode,
        "profile_status": "confirmed",
        "traveler_profile": {
            "places_mentioned": list(places_mentioned or []),
        },
    }


# ---------------------------------------------------------------------------
# Behavior — skip paths
# ---------------------------------------------------------------------------

class TestMergeSkipsWhenNotReady:
    @pytest.mark.asyncio
    async def test_skips_when_trip_profile_not_confirmed(self):
        """If the trip is still mid-build, the regular pipeline owns it.
        merge_link should return early without doing any work — no
        extraction, no Haiku, no Rails writes."""
        from app.services.orchestrator import merge_link_into_existing_trip

        unbuilt = {"id": 7, "profile_status": "suggested",
                   "traveler_profile": {"places_mentioned": []}}
        rails = FakeRails(unbuilt)
        with patch("app.services.orchestrator.RailsClient", return_value=rails), \
             patch("app.services.orchestrator._extract_content") as ext:
            result = await merge_link_into_existing_trip(
                link_id=1, trip_id=7, url="https://x/y", platform="tiktok",
            )
        assert result["places_added"] == 0
        assert result["skipped"] == "trip_not_confirmed"
        ext.assert_not_called()
        assert rails.updates == []  # no profile mutation

    @pytest.mark.asyncio
    async def test_skips_when_trip_not_found(self):
        from app.services.orchestrator import merge_link_into_existing_trip

        class MissingRails:
            updates: list = []
            link_updates: list = []
            async def get_trip(self, trip_id):  # noqa: ARG002
                return None

        with patch("app.services.orchestrator.RailsClient", return_value=MissingRails()):
            result = await merge_link_into_existing_trip(
                link_id=1, trip_id=999, url="https://x/y", platform="tiktok",
            )
        assert result["skipped"] == "trip_not_found"

    @pytest.mark.asyncio
    async def test_skips_when_extraction_returns_empty(self):
        from app.services.orchestrator import merge_link_into_existing_trip

        rails = FakeRails(_trip_built())
        with patch("app.services.orchestrator.RailsClient", return_value=rails), \
             patch("app.services.orchestrator._extract_content",
                   new=AsyncMock(return_value="   ")):
            result = await merge_link_into_existing_trip(
                link_id=1, trip_id=7, url="https://x/y", platform="tiktok",
            )
        assert result["places_added"] == 0
        assert result["skipped"] == "no_content"

    @pytest.mark.asyncio
    async def test_skips_when_haiku_returns_no_places(self):
        from app.services.orchestrator import merge_link_into_existing_trip

        rails = FakeRails(_trip_built())
        with patch("app.services.orchestrator.RailsClient", return_value=rails), \
             patch("app.services.orchestrator._extract_content",
                   new=AsyncMock(return_value="some content")), \
             patch("app.services.orchestrator._analyze_profile",
                   new=AsyncMock(return_value={"places_mentioned": []})):
            result = await merge_link_into_existing_trip(
                link_id=1, trip_id=7, url="https://x/y", platform="tiktok",
            )
        assert result["places_added"] == 0
        assert result["skipped"] == "no_places"


# ---------------------------------------------------------------------------
# Behavior — happy paths
# ---------------------------------------------------------------------------

class TestMergeAppendsAndDedupes:
    @pytest.mark.asyncio
    async def test_new_places_appended_to_existing_list(self):
        """The trip already has 2 places. New link contributes 3 brand-new
        ones. Final list = 5 entries, original 2 untouched, new 3 tagged
        with the new URL."""
        from app.services.orchestrator import merge_link_into_existing_trip

        existing = [
            {"name": "Caminito",   "source_url": "https://old/1", "latitude": -34.6, "longitude": -58.4},
            {"name": "San Telmo",  "source_url": "https://old/1", "latitude": -34.6, "longitude": -58.3},
        ]
        rails = FakeRails(_trip_built(existing, ai_mode="eco"))
        haiku = AsyncMock(return_value={
            "places_mentioned": [
                {"name": "Plaza de Mayo", "kind": "place"},
                {"name": "Palermo Soho", "kind": "place"},
                {"name": "Casa Rosada", "kind": "place"},
            ]
        })
        with patch("app.services.orchestrator.RailsClient", return_value=rails), \
             patch("app.services.orchestrator._extract_content",
                   new=AsyncMock(return_value="content with places")), \
             patch("app.services.orchestrator._analyze_profile", new=haiku):
            result = await merge_link_into_existing_trip(
                link_id=42, trip_id=7, url="https://new/2", platform="instagram",
            )

        assert result["places_added"] == 3
        assert result["total_places"] == 5

        # The single PATCH to the trip should contain the merged list.
        assert len(rails.updates) == 1
        merged = rails.updates[0]["payload"]["traveler_profile"]["places_mentioned"]
        assert len(merged) == 5
        # Existing first, new appended (not prepended) so card numbering
        # stays stable for the user.
        assert merged[0]["name"] == "Caminito"
        assert merged[1]["name"] == "San Telmo"
        assert {p["name"] for p in merged[2:]} == {"Plaza de Mayo", "Palermo Soho", "Casa Rosada"}

        # All NEW entries get the new URL forced — even if Haiku didn't
        # echo it back. The panel groups by source_url so this is critical.
        for p in merged[2:]:
            assert p["source_url"] == "https://new/2"

    @pytest.mark.asyncio
    async def test_dedupes_against_existing_by_name_lowercase(self):
        """Haiku may re-find a place that was already extracted from a
        prior video. We dedupe by lowercased name (so 'Caminito' from one
        video and 'caminito' from another don't double-card)."""
        from app.services.orchestrator import merge_link_into_existing_trip

        existing = [
            {"name": "Caminito", "source_url": "https://old/1"},
        ]
        rails = FakeRails(_trip_built(existing, ai_mode="eco"))
        haiku = AsyncMock(return_value={
            "places_mentioned": [
                {"name": "caminito"},                    # dup — different case
                {"name": " Caminito  "},                 # dup — whitespace
                {"name": "Plaza de Mayo"},               # NEW
            ]
        })
        with patch("app.services.orchestrator.RailsClient", return_value=rails), \
             patch("app.services.orchestrator._extract_content",
                   new=AsyncMock(return_value="x")), \
             patch("app.services.orchestrator._analyze_profile", new=haiku):
            result = await merge_link_into_existing_trip(
                link_id=42, trip_id=7, url="https://new/2", platform="tiktok",
            )

        assert result["places_added"] == 1
        merged = rails.updates[0]["payload"]["traveler_profile"]["places_mentioned"]
        names = [p["name"] for p in merged]
        # No duplicate Caminito.
        assert sum(1 for n in names if n.lower().strip() == "caminito") == 1

    @pytest.mark.asyncio
    async def test_all_duplicates_with_no_notes_is_noop(self):
        """When every place from the new link is a duplicate AND none
        of them carry a new creator_note, merge_link should return
        all_duplicates without writing to Rails — there's no value to
        add (nothing to graft onto community_notes either)."""
        from app.services.orchestrator import merge_link_into_existing_trip

        existing = [{"name": "Obelisco"}]
        rails = FakeRails(_trip_built(existing, ai_mode="eco"))
        with patch("app.services.orchestrator.RailsClient", return_value=rails), \
             patch("app.services.orchestrator._extract_content",
                   new=AsyncMock(return_value="x")), \
             patch("app.services.orchestrator._analyze_profile",
                   new=AsyncMock(return_value={"places_mentioned": [{"name": "Obelisco"}]})):
            result = await merge_link_into_existing_trip(
                link_id=42, trip_id=7, url="https://new/2", platform="tiktok",
            )
        assert result["skipped"] == "all_duplicates"
        # No write to Rails when nothing changed.
        assert rails.updates == []

    @pytest.mark.asyncio
    async def test_existing_places_never_overwritten(self):
        """Race-preservation: if the existing entries have enriched data
        (lat/lng/photo from a prior geocode), we must not lose any of it.
        The new places are appended; the originals come through unchanged."""
        from app.services.orchestrator import merge_link_into_existing_trip

        existing = [
            {
                "name": "Caminito",
                "source_url": "https://old/1",
                "latitude": -34.6383,
                "longitude": -58.3631,
                "photo_url": "https://photo/caminito.jpg",
                "rating": 4.5,
                "google_place_id": "gp-caminito",
            }
        ]
        rails = FakeRails(_trip_built(existing, ai_mode="eco"))
        with patch("app.services.orchestrator.RailsClient", return_value=rails), \
             patch("app.services.orchestrator._extract_content",
                   new=AsyncMock(return_value="x")), \
             patch("app.services.orchestrator._analyze_profile",
                   new=AsyncMock(return_value={"places_mentioned": [{"name": "New Place"}]})):
            await merge_link_into_existing_trip(
                link_id=42, trip_id=7, url="https://new/2", platform="tiktok",
            )

        merged = rails.updates[0]["payload"]["traveler_profile"]["places_mentioned"]
        original = next(p for p in merged if p["name"] == "Caminito")
        # Every enriched field must survive the merge.
        assert original["latitude"] == -34.6383
        assert original["longitude"] == -58.3631
        assert original["photo_url"] == "https://photo/caminito.jpg"
        assert original["rating"] == 4.5
        assert original["google_place_id"] == "gp-caminito"


# ---------------------------------------------------------------------------
# Behavior — manual mode geocoding
# ---------------------------------------------------------------------------

class TestCommunityNotesAggregation:
    """The Wanderlog-inspired pattern: when video #2 mentions a place
    that was already extracted from video #1, we don't drop the new
    info — we ATTACH the new creator_note to the existing place's
    `community_notes` list, tagged with its source URL. The modal
    then renders "Notes from the Community" with bullets from each."""

    @pytest.mark.asyncio
    async def test_duplicate_with_creator_note_grows_community_notes(self):
        from app.services.orchestrator import merge_link_into_existing_trip

        # Video #1 already extracted "Caminito" with one note.
        existing = [{
            "name": "Caminito",
            "source_url": "https://video1",
            "creator_note": "Best pedestrian street in Buenos Aires.",
            "community_notes": [{
                "note": "Best pedestrian street in Buenos Aires.",
                "source_url": "https://video1",
                "source_platform": "tiktok",
            }],
        }]
        rails = FakeRails(_trip_built(existing, ai_mode="eco"))
        # Video #2 mentions Caminito with a DIFFERENT note.
        haiku = AsyncMock(return_value={
            "places_mentioned": [{
                "name": "Caminito",
                "creator_note": "Go at sunrise to avoid crowds.",
            }],
        })
        with patch("app.services.orchestrator.RailsClient", return_value=rails), \
             patch("app.services.orchestrator._extract_content",
                   new=AsyncMock(return_value="x")), \
             patch("app.services.orchestrator._analyze_profile", new=haiku):
            result = await merge_link_into_existing_trip(
                link_id=42, trip_id=7, url="https://video2", platform="instagram",
            )

        assert result["places_added"] == 0  # no NEW places
        assert result["community_notes_added"] == 1
        assert result["total_places"] == 1

        merged = rails.updates[0]["payload"]["traveler_profile"]["places_mentioned"]
        notes = merged[0]["community_notes"]
        assert len(notes) == 2
        assert notes[0]["note"] == "Best pedestrian street in Buenos Aires."
        assert notes[1]["note"] == "Go at sunrise to avoid crowds."
        assert notes[1]["source_url"] == "https://video2"
        assert notes[1]["source_platform"] == "instagram"

    @pytest.mark.asyncio
    async def test_duplicate_with_same_note_text_does_not_double_add(self):
        """If the same creator note is extracted twice (e.g. two videos
        say the same thing, or the same link is processed twice), we
        dedup by note text — community_notes shouldn't grow on re-run."""
        from app.services.orchestrator import merge_link_into_existing_trip

        existing = [{
            "name": "Caminito",
            "community_notes": [{
                "note": "Best pedestrian street.",
                "source_url": "https://video1",
                "source_platform": "tiktok",
            }],
        }]
        rails = FakeRails(_trip_built(existing, ai_mode="eco"))
        haiku = AsyncMock(return_value={
            "places_mentioned": [{
                "name": "Caminito",
                "creator_note": "best pedestrian street.",  # same text, different case
            }],
        })
        with patch("app.services.orchestrator.RailsClient", return_value=rails), \
             patch("app.services.orchestrator._extract_content",
                   new=AsyncMock(return_value="x")), \
             patch("app.services.orchestrator._analyze_profile", new=haiku):
            result = await merge_link_into_existing_trip(
                link_id=42, trip_id=7, url="https://video2", platform="instagram",
            )

        # When the only "new" note text matches what's already there,
        # we treat it as fully duplicate — no write, no community_notes
        # bump. The test verifies the skipped sentinel + zero rails writes.
        assert result["skipped"] == "all_duplicates"
        assert rails.updates == []

    @pytest.mark.asyncio
    async def test_new_place_seeds_community_notes_with_first_creator_note(self):
        """A brand-new place that has a creator_note should have its
        community_notes seeded with that note (so subsequent merges
        can append more)."""
        from app.services.orchestrator import merge_link_into_existing_trip

        rails = FakeRails(_trip_built([], ai_mode="eco"))
        haiku = AsyncMock(return_value={
            "places_mentioned": [{
                "name": "Casa Rosada",
                "creator_note": "Watch the changing of the guard at noon.",
            }],
        })
        with patch("app.services.orchestrator.RailsClient", return_value=rails), \
             patch("app.services.orchestrator._extract_content",
                   new=AsyncMock(return_value="x")), \
             patch("app.services.orchestrator._analyze_profile", new=haiku):
            await merge_link_into_existing_trip(
                link_id=42, trip_id=7, url="https://video1", platform="youtube",
            )

        merged = rails.updates[0]["payload"]["traveler_profile"]["places_mentioned"]
        new_place = merged[0]
        assert new_place["name"] == "Casa Rosada"
        assert new_place["community_notes"] == [{
            "note": "Watch the changing of the guard at noon.",
            "source_url": "https://video1",
            "source_platform": "youtube",
        }]

    @pytest.mark.asyncio
    async def test_existing_geo_data_preserved_when_only_notes_grow(self):
        """When the only change is a community_notes append, the
        existing place's enriched fields (lat/lng/photo/rating) must
        survive the write-back unchanged."""
        from app.services.orchestrator import merge_link_into_existing_trip

        existing = [{
            "name": "Obelisco",
            "google_place_id": "gp-obe",
            "latitude": -34.6037,
            "longitude": -58.3816,
            "photo_url": "https://photo/obelisco.jpg",
            "rating": 4.6,
            "creator_note": "Iconic at night.",
            "community_notes": [{
                "note": "Iconic at night.",
                "source_url": "https://video1",
                "source_platform": "tiktok",
            }],
        }]
        rails = FakeRails(_trip_built(existing, ai_mode="eco"))
        haiku = AsyncMock(return_value={
            "places_mentioned": [{
                "name": "Obelisco",
                "creator_note": "Catch the sunset from a nearby rooftop.",
            }],
        })
        with patch("app.services.orchestrator.RailsClient", return_value=rails), \
             patch("app.services.orchestrator._extract_content",
                   new=AsyncMock(return_value="x")), \
             patch("app.services.orchestrator._analyze_profile", new=haiku):
            await merge_link_into_existing_trip(
                link_id=42, trip_id=7, url="https://video2", platform="instagram",
            )

        merged = rails.updates[0]["payload"]["traveler_profile"]["places_mentioned"]
        place = merged[0]
        assert place["latitude"] == -34.6037
        assert place["longitude"] == -58.3816
        assert place["photo_url"] == "https://photo/obelisco.jpg"
        assert place["rating"] == 4.6
        assert len(place["community_notes"]) == 2


class TestMergeManualModeGeocodes:
    @pytest.mark.asyncio
    async def test_manual_mode_geocodes_only_new_places(self):
        """In manual mode, the cards need photo/rating/lat-lng to look
        good immediately. Geocoding should run on the NEW entries only —
        the existing ones were already enriched and shouldn't pay another
        Places API call."""
        from app.services.orchestrator import merge_link_into_existing_trip

        existing = [
            {"name": "Caminito", "google_place_id": "already-enriched", "latitude": -34.6, "longitude": -58.4},
        ]
        rails = FakeRails(_trip_built(existing, ai_mode="manual"))
        new_haiku_places = [{"name": "Casa Rosada"}, {"name": "Plaza de Mayo"}]

        async def fake_geocode(places, destination, places_client):  # noqa: ARG001
            # Tag each place so we can assert it was enriched.
            return [{**p, "latitude": 0, "longitude": 0, "photo_url": "x"} for p in places]

        with patch("app.services.orchestrator.RailsClient", return_value=rails), \
             patch("app.services.orchestrator._extract_content",
                   new=AsyncMock(return_value="x")), \
             patch("app.services.orchestrator._analyze_profile",
                   new=AsyncMock(return_value={"places_mentioned": new_haiku_places})), \
             patch("app.services.orchestrator._geocode_places_for_manual",
                   new=AsyncMock(side_effect=fake_geocode)) as geo_mock, \
             patch("app.services.orchestrator.GooglePlacesClient"):
            await merge_link_into_existing_trip(
                link_id=42, trip_id=7, url="https://new/2", platform="tiktok",
            )

        # Geocode called exactly once, with ONLY the 2 new places.
        geo_mock.assert_called_once()
        call_kwargs = geo_mock.call_args.kwargs
        called_places = call_kwargs["places"]
        assert {p["name"] for p in called_places} == {"Casa Rosada", "Plaza de Mayo"}
        assert call_kwargs["destination"] == "Buenos Aires"

        # Final merged list: 1 existing (untouched) + 2 newly enriched.
        merged = rails.updates[0]["payload"]["traveler_profile"]["places_mentioned"]
        assert len(merged) == 3
        new_entries = [p for p in merged if p["name"] in {"Casa Rosada", "Plaza de Mayo"}]
        assert all(p.get("photo_url") == "x" for p in new_entries)

    @pytest.mark.asyncio
    async def test_eco_mode_skips_geocoding(self):
        """Non-manual modes already enriched everything during the
        original build — no need to geocode the new places again
        (the build pipeline owns that path)."""
        from app.services.orchestrator import merge_link_into_existing_trip

        rails = FakeRails(_trip_built([], ai_mode="eco"))
        with patch("app.services.orchestrator.RailsClient", return_value=rails), \
             patch("app.services.orchestrator._extract_content",
                   new=AsyncMock(return_value="x")), \
             patch("app.services.orchestrator._analyze_profile",
                   new=AsyncMock(return_value={"places_mentioned": [{"name": "Casa Rosada"}]})), \
             patch("app.services.orchestrator._geocode_places_for_manual") as geo_mock:
            await merge_link_into_existing_trip(
                link_id=42, trip_id=7, url="https://new/2", platform="tiktok",
            )
        geo_mock.assert_not_called()


# ---------------------------------------------------------------------------
# Behavior — link state flipped to "extracted"
# ---------------------------------------------------------------------------

class TestMergeUpdatesLinkState:
    @pytest.mark.asyncio
    async def test_link_marked_processing_then_extracted(self):
        """The Link row should transition processing → extracted just
        like the standard pipeline, so the UI's link list reflects the
        same statuses regardless of which path ran."""
        from app.services.orchestrator import merge_link_into_existing_trip

        rails = FakeRails(_trip_built([], ai_mode="eco"))
        with patch("app.services.orchestrator.RailsClient", return_value=rails), \
             patch("app.services.orchestrator._extract_content",
                   new=AsyncMock(return_value="content body")), \
             patch("app.services.orchestrator._analyze_profile",
                   new=AsyncMock(return_value={"places_mentioned": [{"name": "X"}]})):
            await merge_link_into_existing_trip(
                link_id=99, trip_id=7, url="https://new/2", platform="tiktok",
            )

        statuses = [u.get("status") for u in rails.link_updates if u["link_id"] == 99]
        assert "processing" in statuses
        assert "extracted" in statuses
