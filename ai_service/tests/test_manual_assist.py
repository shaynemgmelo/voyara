"""Tests for `manual_assist_organize` — the function backing the
"🪄 Assistência IA" button in manual mode.

Contract (these tests are the executable specification):

  1. Items the user already placed are NEVER moved or deleted.
  2. Days with user items get filled with the rest of the dominant
     source video's places (capped at 7/day total).
  3. Empty days get the leftover pool, split into geographic clusters.
  4. Idempotent — running twice does not duplicate.
  5. Per-day cap (7) prevents one user item from exploding into 25.
  6. Items without lat/lng still land somewhere (round-robin).

Each test mocks RailsClient with a stub that records create/update
calls so we can assert on them. No network, no Anthropic, no Google.
"""
from __future__ import annotations

from unittest.mock import patch

import pytest


# ---------------------------------------------------------------------------
# Test doubles
# ---------------------------------------------------------------------------

class FakeRails:
    """Minimal RailsClient stub. get_trip returns a snapshot you control;
    create_itinerary_item records each call into self.created so the test
    can assert on what was added (and to which day)."""

    def __init__(self, trip):
        self._trip = trip
        self.created: list[dict] = []  # [{day_id, payload}]

    async def get_trip(self, trip_id):  # noqa: ARG002
        # Return a deep-ish copy so the function under test mutating its
        # own dict doesn't leak back into the test fixture.
        import copy
        return copy.deepcopy(self._trip)

    async def create_itinerary_item(self, trip_id, day_plan_id, payload):  # noqa: ARG002
        self.created.append({"day_id": day_plan_id, "payload": payload})
        # Mirror Rails behavior: append to the in-memory trip too so a
        # second call to get_trip sees the new state. This is what makes
        # idempotency testable: pass 1 adds, pass 2 sees them already.
        for dp in self._trip["day_plans"]:
            if dp["id"] == day_plan_id:
                dp.setdefault("itinerary_items", []).append({
                    "id": 9000 + len(self.created),
                    **payload,
                })
                break
        return {"id": 9000 + len(self.created)}


def _trip(num_days, placed=None, pool=None):
    """Build a trip dict shaped like what RailsClient.get_trip returns."""
    placed = placed or {}  # {day_number: [item_dict, ...]}
    day_plans = []
    for n in range(1, num_days + 1):
        day_plans.append({
            "id": 100 + n,
            "day_number": n,
            "itinerary_items": list(placed.get(n, [])),
        })
    return {
        "id": 1,
        "day_plans": day_plans,
        "traveler_profile": {"places_mentioned": pool or []},
    }


def _place(name, source_url=None, lat=None, lng=None, **extra):
    out = {"name": name}
    if source_url:
        out["source_url"] = source_url
    if lat is not None:
        out["latitude"] = lat
    if lng is not None:
        out["longitude"] = lng
    out.update(extra)
    return out


def _placed_item(name, source_url=None):
    return {
        "id": 5000 + abs(hash(name)) % 1000,
        "name": name,
        "source_url": source_url,
    }


@pytest.fixture
def patched_rails():
    """Patch the RailsClient constructor in the orchestrator module so the
    function under test gets our fake. Yields the fake so the test can
    assert on what was created."""
    fake = {"client": None}

    def _maker(client=None):  # noqa: ARG001
        return fake["client"]

    with patch("app.services.orchestrator.RailsClient", side_effect=_maker):
        yield fake


# ---------------------------------------------------------------------------
# Critical: never move or delete user items
# ---------------------------------------------------------------------------

class TestRespectsUserItems:
    @pytest.mark.asyncio
    async def test_no_creates_when_pool_empty(self, patched_rails):
        from app.services import orchestrator as orch
        trip = _trip(3, placed={1: [_placed_item("Casa Rosada", "vidA")]})
        patched_rails["client"] = FakeRails(trip)

        result = await orch.manual_assist_organize(1)
        assert result["added"] == 0
        assert patched_rails["client"].created == []

    @pytest.mark.asyncio
    async def test_user_item_never_in_create_calls(self, patched_rails):
        """If user placed Casa Rosada on Day 2 from vidA, manual_assist
        must NOT re-create Casa Rosada anywhere — even though it appears
        in the pool."""
        from app.services import orchestrator as orch
        pool = [
            _place("Casa Rosada", source_url="vidA", lat=-34.6, lng=-58.4),
            _place("Plaza de Mayo", source_url="vidA", lat=-34.61, lng=-58.37),
        ]
        trip = _trip(
            3,
            placed={2: [_placed_item("Casa Rosada", "vidA")]},
            pool=pool,
        )
        patched_rails["client"] = FakeRails(trip)

        await orch.manual_assist_organize(1)

        created_names = [c["payload"]["name"] for c in patched_rails["client"].created]
        assert "Casa Rosada" not in created_names
        # Plaza de Mayo IS expected to be added (same source).
        assert "Plaza de Mayo" in created_names


# ---------------------------------------------------------------------------
# Pass 1: dominant source fills the day
# ---------------------------------------------------------------------------

class TestDominantSource:
    @pytest.mark.asyncio
    async def test_fills_day_with_same_source_video_items(self, patched_rails):
        from app.services import orchestrator as orch
        pool = [
            _place("Casa Rosada", "vidA", lat=-34.6, lng=-58.37),
            _place("Centro Cultural Kirchner", "vidA", lat=-34.61, lng=-58.37),
            _place("Galeria Pacífico", "vidA", lat=-34.6, lng=-58.37),
            _place("Eiffel Tower", "vidB", lat=48.85, lng=2.29),  # different source
        ]
        trip = _trip(
            3,
            placed={2: [_placed_item("Casa Rosada", "vidA")]},
            pool=pool,
        )
        patched_rails["client"] = FakeRails(trip)

        await orch.manual_assist_organize(1)

        day2_creates = [
            c for c in patched_rails["client"].created if c["day_id"] == 102
        ]
        names = {c["payload"]["name"] for c in day2_creates}
        # Other vidA items should land on Day 2 — same source as user pick.
        assert "Centro Cultural Kirchner" in names
        assert "Galeria Pacífico" in names
        # vidB items should NOT land on Day 2.
        assert "Eiffel Tower" not in names

    @pytest.mark.asyncio
    async def test_caps_per_day_at_target(self, patched_rails):
        """If user placed 1 item and the source video has 20 more, we
        should add at most TARGET_PER_DAY (7) - 1 = 6 more — not pile
        all 20 onto a single day."""
        from app.services import orchestrator as orch
        pool = [_place(f"Place {i}", "vidA", lat=-34.6, lng=-58.4) for i in range(20)]
        trip = _trip(
            3,
            placed={1: [_placed_item("Anchor", "vidA")]},
            pool=[_place("Anchor", "vidA", lat=-34.6, lng=-58.4)] + pool,
        )
        patched_rails["client"] = FakeRails(trip)

        await orch.manual_assist_organize(1)

        day1_count = sum(1 for c in patched_rails["client"].created if c["day_id"] == 101)
        # 1 anchor + 6 added = 7 total. So day1_count (only counts new) ≤ 6.
        assert day1_count <= 6


# ---------------------------------------------------------------------------
# Pass 2: empty days get clustered leftover
# ---------------------------------------------------------------------------

class TestEmptyDayFill:
    @pytest.mark.asyncio
    async def test_empty_days_get_pool_split_by_proximity(self, patched_rails):
        from app.services import orchestrator as orch
        # Two clusters: Buenos Aires + Tigre (~30km north).
        ba = [_place(f"BA-{i}", "vid", lat=-34.6 + i * 0.001, lng=-58.4) for i in range(4)]
        tigre = [_place(f"Tigre-{i}", "vid", lat=-34.4 + i * 0.001, lng=-58.5) for i in range(4)]
        trip = _trip(2, placed={}, pool=ba + tigre)
        patched_rails["client"] = FakeRails(trip)

        await orch.manual_assist_organize(1)

        day1_names = [c["payload"]["name"] for c in patched_rails["client"].created if c["day_id"] == 101]
        day2_names = [c["payload"]["name"] for c in patched_rails["client"].created if c["day_id"] == 102]
        # Each day should be dominated by ONE cluster (lat-sort splits cleanly).
        # Day 1 = lower lats (BA), Day 2 = higher lats (Tigre).
        assert all(n.startswith("BA-") for n in day1_names), day1_names
        assert all(n.startswith("Tigre-") for n in day2_names), day2_names

    @pytest.mark.asyncio
    async def test_no_geo_items_round_robin_across_empty_days(self, patched_rails):
        """Items missing lat/lng should still get distributed — never dropped."""
        from app.services import orchestrator as orch
        no_geo = [_place(f"NoGeo-{i}", "vid") for i in range(3)]
        trip = _trip(3, placed={}, pool=no_geo)
        patched_rails["client"] = FakeRails(trip)

        await orch.manual_assist_organize(1)

        all_created = [c["payload"]["name"] for c in patched_rails["client"].created]
        for i in range(3):
            assert f"NoGeo-{i}" in all_created


# ---------------------------------------------------------------------------
# Idempotency
# ---------------------------------------------------------------------------

class TestIdempotency:
    @pytest.mark.asyncio
    async def test_running_twice_does_not_duplicate(self, patched_rails):
        from app.services import orchestrator as orch
        pool = [
            _place("Casa Rosada", "vidA", lat=-34.6, lng=-58.37),
            _place("Plaza de Mayo", "vidA", lat=-34.61, lng=-58.37),
        ]
        trip = _trip(
            2,
            placed={1: [_placed_item("Casa Rosada", "vidA")]},
            pool=pool,
        )
        patched_rails["client"] = FakeRails(trip)

        first = await orch.manual_assist_organize(1)
        added_first = first["added"]

        # Run again — pool is now fully placed; nothing should be added.
        second = await orch.manual_assist_organize(1)
        assert second["added"] == 0, (
            f"Second run added {second['added']} items — manual_assist is "
            f"not idempotent. First run added {added_first}."
        )


# ---------------------------------------------------------------------------
# Edge cases
# ---------------------------------------------------------------------------

class TestEdgeCases:
    @pytest.mark.asyncio
    async def test_returns_safely_when_no_pool(self, patched_rails):
        from app.services import orchestrator as orch
        trip = _trip(3, placed={}, pool=[])
        patched_rails["client"] = FakeRails(trip)
        result = await orch.manual_assist_organize(1)
        assert result["added"] == 0

    @pytest.mark.asyncio
    async def test_returns_safely_when_no_days(self, patched_rails):
        from app.services import orchestrator as orch
        trip = {
            "id": 1,
            "day_plans": [],
            "traveler_profile": {
                "places_mentioned": [_place("X", "vid", lat=0, lng=0)],
            },
        }
        patched_rails["client"] = FakeRails(trip)
        result = await orch.manual_assist_organize(1)
        assert result["added"] == 0


# ---------------------------------------------------------------------------
# _cluster_by_proximity unit tests
# ---------------------------------------------------------------------------

class TestClusterByProximity:
    def test_empty_input_returns_empty_clusters(self):
        from app.services.orchestrator import _cluster_by_proximity
        assert _cluster_by_proximity([], 3) == [[], [], []]

    def test_zero_clusters_returns_empty_list(self):
        from app.services.orchestrator import _cluster_by_proximity
        assert _cluster_by_proximity([{"latitude": 1, "longitude": 1}], 0) == []

    def test_evenly_distributes(self):
        from app.services.orchestrator import _cluster_by_proximity
        places = [{"latitude": float(i), "longitude": 0.0} for i in range(6)]
        out = _cluster_by_proximity(places, 3)
        assert len(out) == 3
        assert all(len(g) == 2 for g in out)

    def test_remainder_goes_to_first_clusters(self):
        from app.services.orchestrator import _cluster_by_proximity
        places = [{"latitude": float(i), "longitude": 0.0} for i in range(7)]
        out = _cluster_by_proximity(places, 3)
        sizes = [len(g) for g in out]
        assert sizes == [3, 2, 2]

    def test_sorted_by_lat_so_clusters_are_geographically_contiguous(self):
        from app.services.orchestrator import _cluster_by_proximity
        # Mix latitudes — output groups should still be sorted ranges.
        places = [
            {"latitude": 5.0, "longitude": 0.0, "name": "north"},
            {"latitude": 1.0, "longitude": 0.0, "name": "south"},
            {"latitude": 3.0, "longitude": 0.0, "name": "mid"},
        ]
        out = _cluster_by_proximity(places, 3)
        # Each cluster gets one — south, mid, north.
        assert out[0][0]["name"] == "south"
        assert out[1][0]["name"] == "mid"
        assert out[2][0]["name"] == "north"

    def test_excludes_places_without_latitude(self):
        from app.services.orchestrator import _cluster_by_proximity
        places = [
            {"latitude": 1.0, "longitude": 0.0},
            {"name": "no-geo"},
        ]
        out = _cluster_by_proximity(places, 2)
        # Only the one with lat lands in a cluster.
        total = sum(len(g) for g in out)
        assert total == 1


# ---------------------------------------------------------------------------
# _build_assist_item unit test
# ---------------------------------------------------------------------------

class TestBuildAssistItem:
    def test_carries_through_geo_and_rating(self):
        from app.services.orchestrator import _build_assist_item
        p = {
            "name": "Casa Rosada",
            "source_url": "https://vt.tiktok.com/abc",
            "latitude": -34.6,
            "longitude": -58.37,
            "google_place_id": "ChIJ...",
            "rating": 4.4,
            "category": "attraction",
            "address": "Plaza de Mayo, Argentina",
        }
        item = _build_assist_item(p)
        assert item["name"] == "Casa Rosada"
        assert item["latitude"] == -34.6
        assert item["google_place_id"] == "ChIJ..."
        assert item["rating"] == 4.4
        assert item["category"] == "attraction"
        # Source provenance preserved so smart-assist can group by video later.
        assert item["source_url"] == "https://vt.tiktok.com/abc"
        assert item["origin"] == "ai_assist_manual"
        assert item["source"] == "link"

    def test_no_source_url_marks_source_as_ai(self):
        from app.services.orchestrator import _build_assist_item
        item = _build_assist_item({"name": "X"})
        assert item["source"] == "ai"
        assert item["category"] == "attraction"  # default

    def test_default_duration_when_missing(self):
        from app.services.orchestrator import _build_assist_item
        item = _build_assist_item({"name": "X"})
        assert item["duration_minutes"] == 90


# ---------------------------------------------------------------------------
# _geocode_places_for_manual unit tests
# ---------------------------------------------------------------------------

class FakePlacesClient:
    """Stub GooglePlacesClient that returns canned data without network."""

    def __init__(self, search_result=None, details_result=None):
        self.search_result = search_result
        self.details_result = details_result
        self.search_calls: list[tuple] = []
        self.details_calls: list[str] = []

    async def search(self, query, location=None):
        self.search_calls.append((query, location))
        return self.search_result or []

    async def get_details(self, place_id):
        self.details_calls.append(place_id)
        return self.details_result


class TestExtractProfileAndBuildManualPath:
    """Anti-regression for the trip 42 NameError. The manual-mode block
    inside extract_profile_and_build referenced a `places` variable that
    didn't exist in scope (it's a local of build_trip_itinerary, not
    extract_profile_and_build). The broad except below caught it as
    'non-fatal' so geocoding silently never ran.

    These tests don't run the full pipeline — they assert that the
    function's manual block instantiates GooglePlacesClient itself and
    doesn't reach for an undefined variable.
    """

    def test_manual_block_does_not_reference_undefined_places_var(self):
        """Static check: the manual enrichment block must call
        _geocode_places_for_manual with places_client=places_client (the
        local instance), NOT places (which used to NameError). This is a
        regex check on the source so a future refactor can't silently
        reintroduce the old bug."""
        import inspect
        from app.services import orchestrator as orch
        src = inspect.getsource(orch.extract_profile_and_build)
        # Find the manual block (between 'if ai_mode == "manual":' and
        # the next return).
        assert "if ai_mode == \"manual\":" in src
        manual_section = src.split("if ai_mode == \"manual\":", 1)[1]
        # The actual call must pass places_client=places_client (local)
        # — never `places_client=places` which doesn't exist in scope.
        # We allow either named arg style as long as it doesn't reference
        # the bare `places` variable.
        # Find the _geocode_places_for_manual call.
        assert "_geocode_places_for_manual(" in manual_section
        # Pull the parameter slice for that call.
        call_slice = manual_section.split("_geocode_places_for_manual(", 1)[1]
        # Stop at the next closing paren followed by newline (rough end of call).
        # Just check the first ~500 chars after the call open.
        head = call_slice[:600]
        assert "places_client=places_client" in head, (
            f"Expected `places_client=places_client` in the manual block, "
            f"got: {head[:200]}"
        )
        assert "places_client=places," not in head, (
            "Regression: trip 42 NameError reappeared — `places_client=places` "
            "references an undefined variable in this scope."
        )

    def test_manual_block_instantiates_places_client_locally(self):
        """The manual block must spin up its own GooglePlacesClient.
        Without it the geocoding helper has nothing to call."""
        import inspect
        from app.services import orchestrator as orch
        src = inspect.getsource(orch.extract_profile_and_build)
        manual_section = src.split("if ai_mode == \"manual\":", 1)[1]
        assert "GooglePlacesClient(" in manual_section, (
            "Manual block must instantiate GooglePlacesClient locally — "
            "extract_profile_and_build doesn't keep one in scope."
        )


class TestAnalyzeTripRacePreservation:
    """Trip 42 surfaced a race condition: extract_profile_and_build's
    Phase 2 enriched 23/23 places with geo+photo via Google Places, then
    Rails' Link callback fired /analyze-trip an instant later. analyze_trip
    re-ran the Haiku call and overwrote places_mentioned with NAKED entries
    — wiping the enrichment, leaving cards "no data" and pins on Tokyo.

    The fix: when analyze_trip is about to write a fresh profile and the
    EXISTING profile already has majority-enriched places_mentioned,
    preserve those entries verbatim. Other profile fields (style,
    interests, country, cities) still get the fresh values.
    """

    @pytest.mark.asyncio
    async def test_preserves_enriched_places_on_race(self, monkeypatch):
        """End-to-end: existing profile has 5/5 enriched places. Fresh
        analyze_trip Haiku returns 5 NAKED places. After analyze_trip
        runs, places_mentioned must still have lat/photo/etc."""
        from app.services import orchestrator as orch

        existing = {
            "places_mentioned": [
                {"name": "Casa Rosada", "latitude": -34.6, "longitude": -58.4,
                 "photo_url": "p1", "rating": 4.5},
                {"name": "Eiffel Tower", "latitude": 48.85, "longitude": 2.29,
                 "photo_url": "p2", "rating": 4.8},
                {"name": "Pantheon", "latitude": 41.9, "longitude": 12.5,
                 "photo_url": "p3", "rating": 4.7},
                {"name": "Louvre", "latitude": 48.86, "longitude": 2.34,
                 "photo_url": "p4", "rating": 4.6},
                {"name": "Notre-Dame", "latitude": 48.85, "longitude": 2.35,
                 "photo_url": "p5", "rating": 4.7},
            ],
        }
        fresh_naked_profile = {
            "travel_style": "urban explorer",
            "interests": ["arquitetura", "gastronomia"],
            "places_mentioned": [
                {"name": "Casa Rosada"},
                {"name": "Eiffel Tower"},
                {"name": "Pantheon"},
                # Slightly different name — wouldn't merge, would drop.
                {"name": "Some Other Place"},
            ],
        }
        trip = {
            "id": 1,
            "destination": "Buenos Aires",
            "links": [
                {"url": "https://x", "extracted_data": {"content_text": "x"}},
            ],
            "traveler_profile": existing,
        }

        # Stub RailsClient
        captured: dict = {"updates": None}
        class FakeRails:
            def __init__(self, client=None): pass
            async def get_trip(self, tid): return trip
            async def get_links(self, tid): return trip["links"]
            async def update_trip(self, tid, updates):
                captured["updates"] = updates
                return {}
        monkeypatch.setattr(orch, "RailsClient", FakeRails)

        # Stub the Haiku call to return the naked fresh profile
        async def fake_analyze(content, dest, cost):
            return dict(fresh_naked_profile)
        monkeypatch.setattr(orch, "_analyze_profile", fake_analyze)

        await orch.analyze_trip(1)

        # The update should have preserved the existing enriched places.
        assert captured["updates"] is not None
        saved = captured["updates"]["traveler_profile"]
        saved_places = saved.get("places_mentioned") or []
        # Should match the EXISTING (5 enriched), not the FRESH naked (4).
        assert len(saved_places) == 5
        with_geo = sum(1 for p in saved_places if p.get("latitude") is not None)
        with_photo = sum(1 for p in saved_places if p.get("photo_url"))
        assert with_geo == 5
        assert with_photo == 5
        # Other profile fields ARE updated (the fresh values win).
        assert saved.get("travel_style") == "urban explorer"

    @pytest.mark.asyncio
    async def test_overwrites_when_existing_is_empty(self, monkeypatch):
        """First-run case: nothing enriched yet. analyze_trip should
        write the fresh Haiku output normally."""
        from app.services import orchestrator as orch

        trip = {
            "id": 2,
            "destination": "Paris",
            "links": [
                {"url": "https://x", "extracted_data": {"content_text": "x"}},
            ],
            "traveler_profile": {},  # no existing profile
        }
        fresh = {
            "travel_style": "explorer",
            "places_mentioned": [{"name": "Eiffel"}, {"name": "Louvre"}],
        }

        captured: dict = {"updates": None}
        class FakeRails:
            def __init__(self, client=None): pass
            async def get_trip(self, tid): return trip
            async def get_links(self, tid): return trip["links"]
            async def update_trip(self, tid, updates):
                captured["updates"] = updates
                return {}
        monkeypatch.setattr(orch, "RailsClient", FakeRails)

        async def fake_analyze(content, dest, cost):
            return dict(fresh)
        monkeypatch.setattr(orch, "_analyze_profile", fake_analyze)

        await orch.analyze_trip(2)
        saved = captured["updates"]["traveler_profile"]
        # Fresh wins because there's nothing enriched to preserve.
        assert len(saved["places_mentioned"]) == 2

    @pytest.mark.asyncio
    async def test_overwrites_when_existing_lacks_geo(self, monkeypatch):
        """Existing profile has places but they're all naked (no geo).
        Don't lock that in — the fresh call might get geo this time."""
        from app.services import orchestrator as orch

        trip = {
            "id": 3,
            "destination": "Tokyo",
            "links": [{"url": "https://x", "extracted_data": {"content_text": "x"}}],
            "traveler_profile": {
                "places_mentioned": [
                    {"name": "X"}, {"name": "Y"}, {"name": "Z"},
                ],
            },
        }
        fresh = {
            "places_mentioned": [
                {"name": "X"}, {"name": "Y"}, {"name": "Z"}, {"name": "Q"},
            ],
        }

        captured: dict = {"updates": None}
        class FakeRails:
            def __init__(self, client=None): pass
            async def get_trip(self, tid): return trip
            async def get_links(self, tid): return trip["links"]
            async def update_trip(self, tid, updates):
                captured["updates"] = updates
                return {}
        monkeypatch.setattr(orch, "RailsClient", FakeRails)

        async def fake_analyze(content, dest, cost):
            return dict(fresh)
        monkeypatch.setattr(orch, "_analyze_profile", fake_analyze)

        await orch.analyze_trip(3)
        saved = captured["updates"]["traveler_profile"]
        # Fresh wins (4 entries) — no enrichment to preserve.
        assert len(saved["places_mentioned"]) == 4


class TestGeocodePlacesForManual:
    @pytest.mark.asyncio
    async def test_skips_already_enriched_places(self):
        """A place that already has google_place_id + lat/lng must NOT
        be re-queried — re-running extract on the same trip would burn
        Places API quota for no value."""
        from app.services.orchestrator import _geocode_places_for_manual
        already = [{
            "name": "Casa Rosada",
            "source_url": "v",
            "google_place_id": "ChIJabc",
            "latitude": -34.6,
            "longitude": -58.37,
        }]
        client = FakePlacesClient()
        out = await _geocode_places_for_manual(
            already, destination="Buenos Aires", places_client=client,
        )
        assert client.search_calls == []
        assert client.details_calls == []
        assert out[0]["google_place_id"] == "ChIJabc"

    @pytest.mark.asyncio
    async def test_enriches_naked_place_with_search_then_details(self):
        from app.services.orchestrator import _geocode_places_for_manual
        client = FakePlacesClient(
            search_result=[{
                "place_id": "ChIJxyz",
                "name": "Casa Rosada",
                "address": "Plaza de Mayo",
                "latitude": -34.6,
                "longitude": -58.37,
                "rating": 4.5,
                "user_ratings_total": 100,
                "types": ["tourist_attraction"],
            }],
            details_result={
                "place_id": "ChIJxyz",
                "address": "Balcarce 50, Buenos Aires",
                "latitude": -34.6080,
                "longitude": -58.3702,
                "rating": 4.4,
                "reviews_count": 12345,
                "photos": ["https://photo1", "https://photo2"],
                "phone": "+54 11 4344-3600",
                "website": "https://casarosada.gob.ar",
                "operating_hours": {"Monday": "Closed"},
                "google_maps_url": "https://maps.google.com/?cid=123",
                "types": ["tourist_attraction"],
            },
        )
        places = [{"name": "Casa Rosada", "source_url": "v"}]
        out = await _geocode_places_for_manual(
            places, destination="Buenos Aires", places_client=client,
        )
        assert len(client.search_calls) == 1
        assert client.search_calls[0][0] == "Casa Rosada"
        assert len(client.details_calls) == 1
        # Details fields preferred over search fields when both present.
        assert out[0]["latitude"] == -34.6080
        assert out[0]["address"] == "Balcarce 50, Buenos Aires"
        assert out[0]["rating"] == 4.4
        assert out[0]["reviews_count"] == 12345
        assert out[0]["photo_url"] == "https://photo1"
        assert out[0]["photos"] == ["https://photo1", "https://photo2"]
        assert out[0]["phone"] == "+54 11 4344-3600"
        assert out[0]["website"] == "https://casarosada.gob.ar"
        assert out[0]["operating_hours"] == {"Monday": "Closed"}
        assert out[0]["google_maps_url"] == "https://maps.google.com/?cid=123"
        assert out[0]["category"] == "attraction"

    @pytest.mark.asyncio
    async def test_no_search_results_keeps_place_naked(self):
        """Search returning nothing should leave the place as-is, not
        crash and not return None for required fields."""
        from app.services.orchestrator import _geocode_places_for_manual
        client = FakePlacesClient(search_result=[])
        places = [{"name": "Inexistant Place", "source_url": "v"}]
        out = await _geocode_places_for_manual(
            places, destination="Anywhere", places_client=client,
        )
        assert len(out) == 1
        assert out[0]["name"] == "Inexistant Place"
        # No geo, no extras — not crashed.
        assert "google_place_id" not in out[0] or out[0].get("google_place_id") is None

    @pytest.mark.asyncio
    async def test_empty_input_returns_empty(self):
        from app.services.orchestrator import _geocode_places_for_manual
        client = FakePlacesClient()
        out = await _geocode_places_for_manual([], destination="X", places_client=client)
        assert out == []
        assert client.search_calls == []

    @pytest.mark.asyncio
    async def test_search_failure_does_not_kill_other_places(self):
        """One failed lookup shouldn't drop everything else from the pool."""
        from app.services.orchestrator import _geocode_places_for_manual

        class FlakeyClient(FakePlacesClient):
            def __init__(self):
                super().__init__()
                self.calls = 0

            async def search(self, query, location=None):
                self.calls += 1
                if self.calls == 1:
                    raise RuntimeError("simulated transient error")
                return [{
                    "place_id": "ChIJok",
                    "latitude": 1.0,
                    "longitude": 1.0,
                    "types": [],
                }]

            async def get_details(self, place_id):
                return {
                    "place_id": place_id,
                    "latitude": 1.0,
                    "longitude": 1.0,
                    "types": [],
                }

        client = FlakeyClient()
        places = [
            {"name": "A", "source_url": "v"},
            {"name": "B", "source_url": "v"},
        ]
        out = await _geocode_places_for_manual(
            places, destination="X", places_client=client,
        )
        # Both still in output; A bare, B enriched.
        assert len(out) == 2
        # Order may not match input due to gather, so check both states exist.
        has_naked = any(p.get("latitude") is None and p["name"] in ("A", "B") for p in out)
        has_enriched = any(p.get("latitude") == 1.0 for p in out)
        assert has_naked and has_enriched
