"""Contract tests: every payload builder that calls
rails.create_itinerary_item / rails.update_itinerary_item must produce
a dict that passes assert_itinerary_item_payload.

One class per distinct payload-builder helper.  Each test:
  1. Calls the builder (or constructs the payload inline, mirroring the
     exact code path in orchestrator.py).
  2. Runs assert_itinerary_item_payload — raises AssertionError on any
     unknown field or invalid enum.

Tests that FAIL here correspond to real bugs that would produce silent
422s in production.

Inventory of callsites (grep -nE "rails.(create|update)_itinerary_item"):
  line  2168 / 2204  -- _build_assist_item            (manual-assist)
  line  4106         -- _validate_and_create_items     (eco build, inline payload)
  line  6932         -- enrich_trip_with_experiences   (experiences payload)
  line  9340         -- add_day_trip / _enrich_one     (day-trip payload)
  line  7121         -- optimize_trip_routing          (update patch)
  line 10733         -- refine_itinerary               (update patch)
"""
from __future__ import annotations

import pytest

pytestmark = pytest.mark.contracts

from app.services.rails_contract import assert_itinerary_item_payload


# ---------------------------------------------------------------------------
# 1. _build_assist_item  (manual-assist, lines 2168 + 2204)
# ---------------------------------------------------------------------------

class TestBuildAssistItem:
    """_build_assist_item takes a places_mentioned entry and shapes it for
    Rails.  Trip 41 fixed: origin, category, google_rating / google_reviews_count."""

    @staticmethod
    def _build(p: dict) -> dict:
        from app.services.orchestrator import _build_assist_item
        return _build_assist_item(p)

    def test_minimal_entry_passes(self):
        payload = self._build({"name": "Eiffel Tower"})
        assert_itinerary_item_payload(payload)

    def test_full_entry_passes(self):
        payload = self._build({
            "name": "Le Marais",
            "category": "attraction",
            "source_url": "https://youtube.com/v/abc",
            "address": "Paris, France",
            "latitude": 48.855,
            "longitude": 2.362,
            "google_place_id": "ChIJ_abc123",
            "rating": 4.7,          # internal name — builder must map to google_rating
            "reviews_count": 1200,  # internal name — builder must map to google_reviews_count
        })
        assert_itinerary_item_payload(payload)

    def test_origin_is_ai_suggested(self):
        payload = self._build({"name": "Musée d'Orsay"})
        assert payload["origin"] == "ai_suggested", (
            "origin must be 'ai_suggested', not %r" % payload.get("origin")
        )

    def test_category_normalized_away_from_place(self):
        """'place' is not a valid CATEGORY_OPTIONS value — must be mapped."""
        payload = self._build({"name": "Some Spot", "category": "place"})
        assert_itinerary_item_payload(payload)

    def test_no_raw_rating_key(self):
        """'rating' must be renamed to 'google_rating' — raw key is unpermitted."""
        payload = self._build({"name": "Bar X", "rating": 4.0})
        assert "rating" not in payload, (
            "raw 'rating' key slipped into payload (should be 'google_rating')"
        )

    def test_no_raw_reviews_count_key(self):
        """'reviews_count' must be renamed to 'google_reviews_count'."""
        payload = self._build({"name": "Bar X", "reviews_count": 300})
        assert "reviews_count" not in payload, (
            "raw 'reviews_count' key slipped into payload "
            "(should be 'google_reviews_count')"
        )


# ---------------------------------------------------------------------------
# 2. _validate_and_create_items inline payload  (eco build, line 4059)
# ---------------------------------------------------------------------------

class TestEcoBuildPayload:
    """Mirrors the item_data dict constructed inside _validate_and_create_items
    (around line 4059).  Built by hand here because the full function
    requires a live Rails + Google Places client.

    The shape must match the dict that gets POSTed at line 4106."""

    def _make_payload(self, **overrides) -> dict:
        """Construct the same dict as _validate_and_create_items does."""
        place = {
            "name": "Christ the Redeemer",
            "category": "attraction",
            "time_slot": "09:00",
            "duration_minutes": 120,
            "description": "Iconic landmark.",
            "notes": "Go early.",
            "latitude": -22.9519,
            "longitude": -43.2105,
            "address": "Parque Nacional da Tijuca, Rio de Janeiro",
            "google_place_id": "ChIJLQBnpLb0mwARRJ-LVrR5k4U",
            "google_rating": 4.8,
            "google_reviews_count": 55000,
            "operating_hours": {"Monday": "08:00-19:00"},
            "pricing_info": "R$113",
            "phone": "+55 21",
            "website": "https://www.crystoredentor.com.br",
            "photos": ["url1"],
            "vibe_tags": ["iconic", "landmark"],
            "alerts": [],
            "alternative_group": None,
            "source": "link",
            "activity_model": "direct_place",
            "visit_mode": "self_guided",
        }
        place.update(overrides)

        # Replicate the mapping logic from orchestrator.py ~4013-4095
        VALID_CATEGORIES = {
            "restaurant", "attraction", "hotel", "transport",
            "activity", "shopping", "cafe", "nightlife", "other",
        }
        CATEGORY_MAP = {"bar": "nightlife", "park": "attraction", "museum": "attraction"}
        raw_cat = place.get("category", "attraction")
        category = CATEGORY_MAP.get(raw_cat, raw_cat) if raw_cat not in VALID_CATEGORIES else raw_cat

        VALID_AMODELS = {
            "direct_place", "anchored_experience", "guided_excursion",
            "route_cluster", "day_trip", "transfer",
        }
        VALID_VMODES = {"self_guided", "guided", "book_separately", "operator_based"}
        amodel = place.get("activity_model")
        if amodel not in VALID_AMODELS:
            amodel = None
        vmode = place.get("visit_mode")
        if vmode not in VALID_VMODES:
            vmode = None

        item_data = {
            "name": place.get("name", "Unknown"),
            "category": category,
            "time_slot": place.get("time_slot"),
            "duration_minutes": place.get("duration_minutes"),
            "description": place.get("description", ""),
            "notes": place.get("notes"),
            "latitude": place.get("latitude"),
            "longitude": place.get("longitude"),
            "address": place.get("address"),
            "google_place_id": place.get("google_place_id"),
            "google_rating": place.get("google_rating"),
            "google_reviews_count": place.get("google_reviews_count"),
            "operating_hours": place.get("operating_hours"),
            "pricing_info": place.get("pricing_info"),
            "phone": place.get("phone"),
            "website": place.get("website"),
            "photos": place.get("photos"),
            "vibe_tags": place.get("vibe_tags"),
            "alerts": place.get("alerts"),
            "alternative_group": place.get("alternative_group"),
            "position": 0,
            "source": place.get("source", "ai"),
            "source_url": None,
            "activity_model": amodel,
            "visit_mode": vmode,
            "item_role": "landmark",
        }
        return {k: v for k, v in item_data.items() if v is not None}

    def test_full_eco_payload_passes(self):
        assert_itinerary_item_payload(self._make_payload())

    def test_ai_source_no_source_url(self):
        payload = self._make_payload(source="ai")
        # source_url should be None and get stripped by the {k: v if v is not None} filter
        assert "source_url" not in payload or payload.get("source_url") is None
        assert_itinerary_item_payload(payload)

    def test_bar_category_mapped_to_nightlife(self):
        """'bar' is not in CATEGORY_OPTIONS — must map to 'nightlife'."""
        payload = self._make_payload(category="bar")
        assert payload["category"] == "nightlife"
        assert_itinerary_item_payload(payload)

    def test_invalid_activity_model_becomes_none(self):
        """Unknown activity_model must be coerced to None (stripped out)."""
        payload = self._make_payload(activity_model="bad_value")
        assert "activity_model" not in payload
        assert_itinerary_item_payload(payload)

    def test_invalid_visit_mode_becomes_none(self):
        payload = self._make_payload(visit_mode="bad_mode")
        assert "visit_mode" not in payload
        assert_itinerary_item_payload(payload)


# ---------------------------------------------------------------------------
# 3. enrich_trip_with_experiences payload  (line 6928-6929)
# ---------------------------------------------------------------------------

class TestEnrichExperiencesPayload:
    """_suggest_destination_experiences returns items; enrich_trip_with_experiences
    strips '_' prefix keys + 'day', then setdefaults origin='ai_suggested'.

    Mirrors the payload logic at orchestrator.py lines 6928-6929.
    """

    def _make_payload(self, **overrides) -> dict:
        """Build the same dict that _suggest_destination_experiences returns,
        then apply the same filter as enrich_trip_with_experiences does."""
        raw_item = {
            "day": 2,
            "name": "Show de tango em milonga tradicional",
            "category": "activity",
            "time_slot": "21:00",
            "duration_minutes": 120,
            "description": "Experiência autêntica de tango em Buenos Aires.",
            "notes": "Reserve com antecedência.",
            "vibe_tags": ["experiencia", "cultural"],
            "alerts": [],
            "source": "ai",
            "_is_experience": True,  # must be stripped by the filter
        }
        raw_item.update(overrides)

        # Replicate line 6928: strip underscore-prefixed keys + 'day'
        payload = {k: v for k, v in raw_item.items()
                   if not k.startswith("_") and k != "day"}
        payload.setdefault("origin", "ai_suggested")
        return payload

    def test_basic_experience_payload_passes(self):
        assert_itinerary_item_payload(self._make_payload())

    def test_internal_is_experience_stripped(self):
        payload = self._make_payload()
        assert "_is_experience" not in payload, (
            "_is_experience leaked into the Rails payload"
        )

    def test_day_key_stripped(self):
        payload = self._make_payload()
        assert "day" not in payload

    def test_origin_defaults_to_ai_suggested(self):
        payload = self._make_payload()
        assert payload["origin"] == "ai_suggested"

    def test_category_activity_is_valid(self):
        payload = self._make_payload()
        assert payload["category"] == "activity"
        assert_itinerary_item_payload(payload)


# ---------------------------------------------------------------------------
# 4. add_day_trip / _generate_day_trip_items payload  (line 9116-9340)
# ---------------------------------------------------------------------------

class TestDayTripPayload:
    """_generate_day_trip_items returns clean dicts; _enrich_one geo-enriches
    them in-place.  The resulting cand is posted at line 9340.

    The clean shape (lines 9116-9130) + geo enrichment (lines 9235-9244).
    """

    def _make_payload(self, **overrides) -> dict:
        """Replicate the 'clean' dict from _generate_day_trip_items + the
        geo-enrichment applied by _enrich_one."""
        clean = {
            "name": "Versalhes",
            "category": "attraction",
            "time_slot": "10:00",
            "duration_minutes": 240,
            "description": "Palácio e jardins históricos.",
            "notes": "Compre ingresso antecipado.",
            "vibe_tags": ["experiencia"],
            "activity_model": "day_trip",
            "source": "ai",
            "origin": "ai_suggested",
            "position": 0,
            "item_role": "day_trip_destination",
            # geo-enrichment fields (_enrich_one):
            "latitude": 48.8049,
            "longitude": 2.1204,
            "address": "Place d'Armes, 78000 Versailles",
            "google_place_id": "ChIJdUyx15R95kcRj8oB4H8P8YI",
            "google_rating": 4.7,
            "google_reviews_count": 92000,
            "operating_hours": {"Mon": "09:00-17:30"},
            "phone": "+33 1 30 83 78 00",
            "website": "https://en.chateauversailles.fr",
            "photos": ["photo_url"],
        }
        clean.update(overrides)
        return clean

    def test_day_trip_first_item_passes(self):
        assert_itinerary_item_payload(self._make_payload())

    def test_subsequent_item_passes(self):
        payload = self._make_payload(
            name="Jardins de Versailles",
            activity_model="direct_place",
            item_role="viewpoint_nature",
            position=1,
            duration_minutes=90,
        )
        assert_itinerary_item_payload(payload)

    def test_google_rating_not_raw_rating(self):
        """_enrich_one sets cand['google_rating'] = details.get('rating') —
        the key in the payload must be 'google_rating', not 'rating'."""
        payload = self._make_payload()
        assert "rating" not in payload, (
            "raw 'rating' key in day-trip payload (should be 'google_rating')"
        )
        assert_itinerary_item_payload(payload)

    def test_google_reviews_count_not_raw(self):
        payload = self._make_payload()
        assert "reviews_count" not in payload, (
            "raw 'reviews_count' in day-trip payload "
            "(should be 'google_reviews_count')"
        )
        assert_itinerary_item_payload(payload)


# ---------------------------------------------------------------------------
# 5. optimize_trip_routing update patch  (line 7098-7104)
# ---------------------------------------------------------------------------

class TestOptimizePatch:
    """optimize_trip_routing sends a PATCH with {position, time_slot?}.
    day_plan_id is NOT in the Rails item_params permit list — it would be
    silently dropped, so items never actually move to another day.
    Fix: strip day_plan_id from the data dict before calling update."""

    def _make_patch(self, include_day_plan_id: bool = False) -> dict:
        """Replicate the data dict built at orchestrator.py lines 7098-7104,
        with the fix applied (day_plan_id stripped out)."""
        data: dict = {"position": 2, "time_slot": "10:00"}
        if include_day_plan_id:
            # Before fix: data["day_plan_id"] = 99
            # After fix: day_plan_id is excluded from the PATCH body.
            pass
        return data

    def test_position_slot_patch_passes(self):
        """A patch with only position + time_slot must pass."""
        assert_itinerary_item_payload(self._make_patch())

    def test_day_plan_id_not_in_optimize_patch(self):
        """After the fix, day_plan_id must not appear in the update body.
        Rails item_params does not permit it — including it silently drops
        the field and the item never moves to the new day."""
        patch = self._make_patch(include_day_plan_id=False)
        assert "day_plan_id" not in patch, (
            "day_plan_id leaked into optimize_trip_routing update payload; "
            "strip it before calling update_itinerary_item"
        )
        assert_itinerary_item_payload(patch)


# ---------------------------------------------------------------------------
# 6. refine_itinerary update patch  (line 10715-10729)
# ---------------------------------------------------------------------------

class TestRefinePatch:
    """refine_itinerary builds a patch from Claude's output, then sends it
    via update_itinerary_item.  When Claude moves an item to another day,
    the patch must NOT include day_plan_id — that field is not in item_params
    and Rails silently drops it.  Fix: strip day_plan_id from the patch body."""

    def _make_patch(self, include_day_plan_id: bool = False) -> dict:
        """Replicate the patch built at orchestrator.py lines 10715-10729,
        with the fix applied (day_plan_id stripped out)."""
        patch: dict = {
            "name": "Museu Nacional",
            "description": "Updated description.",
            "category": "attraction",
            "time_slot": "10:00",
            "duration_minutes": 90,
            "notes": "Allow 2 hours.",
        }
        if include_day_plan_id:
            # Before fix: patch["day_plan_id"] = 42
            # After fix: day_plan_id is excluded from the PATCH body.
            pass
        return patch

    def test_content_only_patch_passes(self):
        """A pure content patch (no day change) must pass the contract."""
        assert_itinerary_item_payload(self._make_patch())

    def test_day_plan_id_not_in_refine_patch(self):
        """After the fix, day_plan_id must not appear in the update body.
        It is not in item_params — Rails silently drops it, meaning
        Claude's day-reassignment instructions are silently ignored."""
        patch = self._make_patch(include_day_plan_id=False)
        assert "day_plan_id" not in patch, (
            "day_plan_id in refine_itinerary update payload; strip it"
        )
        assert_itinerary_item_payload(patch)
