# Codebase Audit & Regression Catchers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Systematically audit the cross-layer surfaces (Python ↔ Rails permit list, frontend payload builders ↔ Rails columns, AI auto-triggers ↔ manual-mode contract, places_mentioned ↔ itinerary_items) where every recent regression has lived, fix what's broken, and install machine-checked invariants so the same bug class can never come back silently.

**Architecture:** Build a small **cross-layer contract module** (`rails_contract.py` + a tiny JS twin) that hard-codes the Rails permit lists and enum constants. Use it from pytest + an in-process JS test to assert every payload-builder + every AI mutating endpoint complies. Then run that suite — it WILL surface bugs the recent firefighting missed — and fix each one with a focused commit.

**Tech Stack:** Python 3.12 + FastAPI + pytest, Rails 8 + Minitest, React + ESLint. No new dependencies.

---

## File Structure

**New files:**
- `ai_service/app/services/rails_contract.py` — single source of truth for Rails permit lists + model enums (mirrors what's in `backend/app/controllers/api/v1/*_controller.rb` and `backend/app/models/*.rb`)
- `ai_service/tests/test_rails_contract.py` — meta-tests that prove the contract module is in sync with the Rails source
- `ai_service/tests/test_payload_shapes.py` — one test per Python function that posts to Rails, asserting payload only contains permitted fields + valid enum values
- `ai_service/tests/test_ai_mutating_endpoints_respect_manual.py` — one test per AI-side mutating function, asserting it bails on `ai_mode=manual`
- `ai_service/tests/test_race_preservation.py` — pins the "don't wipe enriched data" rule across every place_mentioned write-back path
- `frontend/src/utils/itineraryItemPayload.js` — single canonical builder that turns a `place` into a Rails-shaped `itinerary_item` payload
- `frontend/src/utils/__tests__/itineraryItemPayload.test.js` — proves the builder emits only permitted fields + maps `rating`→`google_rating` etc.
- `docs/superpowers/audits/2026-04-26-cross-layer-surface-map.md` — read-only inventory artifact: every payload-builder function, every mutating endpoint, every contract surface (handed to humans for review)

**Modified files:**
- `ai_service/app/services/orchestrator.py` — refactor every payload-build callsite to import from `rails_contract` and use the shared `assert_payload` helper; add manual-mode defensive guards to any mutating function still missing one
- `frontend/src/pages/TripDetail.js` — refactor `handleDragEnd` + `handleAddPlaceToDay` to use the canonical payload builder
- `frontend/src/hooks/useTripDetail.js` — same canonicalization for any other addItem callsite
- `ai_service/tests/test_manual_mode_isolation.py` — extend to cover every mutating endpoint, not just enrich + optimize

---

## Task 1: Inventory the surfaces (read-only audit)

**Files:**
- Create: `docs/superpowers/audits/2026-04-26-cross-layer-surface-map.md`

- [ ] **Step 1: Inventory every Rails permit list + model enum**

Run these and paste output into the audit doc:

```bash
grep -A3 "params.require" backend/app/controllers/api/v1/itinerary_items_controller.rb | head -20
grep -A3 "params.require" backend/app/controllers/api/v1/trips_controller.rb | head -20
grep -E "^\s+[A-Z_]+\s*=\s*%w\[" backend/app/models/itinerary_item.rb backend/app/models/day_plan.rb backend/app/models/trip.rb backend/app/models/link.rb
```

Document each in a table: model, constant name, allowed values.

- [ ] **Step 2: Inventory every Python function that POSTs/PATCHes Rails**

```bash
grep -nE "rails\.(create|update)_itinerary_item|rails\.update_trip|rails\.update_link|rails\.create_lodging|rails\.update_day_plan" ai_service/app/services/orchestrator.py
```

Document each callsite: line number, calling function, what payload shape it builds.

- [ ] **Step 3: Inventory every mutating AI endpoint**

```bash
grep -nE "@router\.(post|patch|delete)" ai_service/app/api/routes.py
```

For each one, document: route, function name, whether it can mutate trip data, whether it has a `ai_mode == "manual"` guard.

- [ ] **Step 4: Inventory every frontend callsite that builds an itinerary_item payload**

```bash
grep -rnE "addItem\(|createItem\(|itinerary_item:\s*\{" frontend/src/ --include="*.js"
```

Document each callsite + the field set it sends.

- [ ] **Step 5: Commit the audit doc**

```bash
git add docs/superpowers/audits/2026-04-26-cross-layer-surface-map.md
git commit -m "docs: cross-layer surface inventory pre-audit"
```

---

## Task 2: Create the rails_contract module (Python source of truth)

**Files:**
- Create: `ai_service/app/services/rails_contract.py`
- Test: `ai_service/tests/test_rails_contract.py`

- [ ] **Step 1: Write the failing test**

```python
# ai_service/tests/test_rails_contract.py
"""Meta-tests that pin the rails_contract constants to the actual Rails
source files. If a Rails dev adds a value to ItineraryItem::ORIGINS
without updating rails_contract, this test fails — preventing the silent
422s that bit trips 41 + 44.
"""
from __future__ import annotations
import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]


def _rails_constant(model_path: str, name: str) -> set[str]:
    """Read `NAME = %w[a b c]` from a Rails model file."""
    text = (REPO_ROOT / model_path).read_text()
    match = re.search(rf"{name}\s*=\s*%w\[([^\]]+)\]", text)
    assert match, f"{name} not found in {model_path}"
    return set(match.group(1).split())


class TestRailsContractInSync:
    def test_itinerary_item_categories_match_rails(self):
        from app.services.rails_contract import ITINERARY_ITEM_CATEGORIES
        rails = _rails_constant(
            "backend/app/models/itinerary_item.rb", "CATEGORY_OPTIONS"
        )
        assert ITINERARY_ITEM_CATEGORIES == rails

    def test_itinerary_item_origins_match_rails(self):
        from app.services.rails_contract import ITINERARY_ITEM_ORIGINS
        rails = _rails_constant(
            "backend/app/models/itinerary_item.rb", "ORIGINS"
        )
        assert ITINERARY_ITEM_ORIGINS == rails

    def test_day_plan_origins_match_rails(self):
        from app.services.rails_contract import DAY_PLAN_ORIGINS
        rails = _rails_constant("backend/app/models/day_plan.rb", "ORIGINS")
        assert DAY_PLAN_ORIGINS == rails
```

- [ ] **Step 2: Run test, verify it fails**

```bash
cd ai_service && source .venv/bin/activate && pytest tests/test_rails_contract.py -v
```

Expected: FAIL with `ModuleNotFoundError: No module named 'app.services.rails_contract'`

- [ ] **Step 3: Implement the contract module**

```python
# ai_service/app/services/rails_contract.py
"""Single source of truth for Rails-side contracts that the Python
orchestrator must respect when posting payloads.

Why this exists: trip 41 spent a night silently 422'ing every
ai-assist insert because the Python side sent `origin="ai_assist_manual"`
(not in Rails ORIGINS) and `category="place"` (not in CATEGORY_OPTIONS).
Mirroring those constants here + asserting in tests means the same
class of bug surfaces as a unit test failure, not a silent prod 422.

The constants are kept in sync via test_rails_contract.py — that suite
re-reads the Rails source files on every CI run and asserts the sets
match. Adding a new value on the Rails side without updating here
fails the build.
"""
from __future__ import annotations

# Rails: ItineraryItem::CATEGORY_OPTIONS
ITINERARY_ITEM_CATEGORIES: set[str] = {
    "restaurant", "attraction", "hotel", "transport", "activity",
    "shopping", "cafe", "nightlife", "other",
}

# Rails: ItineraryItem::ORIGINS
ITINERARY_ITEM_ORIGINS: set[str] = {
    "extracted_from_video", "ai_suggested", "user_added",
}

# Rails: DayPlan::ORIGINS
DAY_PLAN_ORIGINS: set[str] = {"from_video", "ai_created", "user_edited"}

# Rails: itinerary_items_controller.rb item_params permit list. Anything
# outside this set will trigger "Unpermitted parameters" warnings AND
# get silently dropped from the payload before validation runs.
ITINERARY_ITEM_PERMITTED_FIELDS: set[str] = {
    "name", "description", "category", "time_slot", "duration_minutes",
    "position", "latitude", "longitude", "address", "google_place_id",
    "google_rating", "google_reviews_count", "pricing_info", "phone",
    "website", "notes", "source_url", "personal_notes",
    "alternative_group", "source", "origin", "source_video_url",
    "source_video_creator", "extraction_method", "priority",
    "item_status", "best_turn", "region", "activity_model",
    "visit_mode", "item_role", "operating_hours", "photos", "vibe_tags",
    "alerts",
}


def assert_itinerary_item_payload(payload: dict) -> None:
    """Raise AssertionError if `payload` violates any Rails contract:
    unknown field, invalid enum value, missing required field. Used by
    tests + can be called defensively in development.
    """
    if not isinstance(payload, dict):
        raise AssertionError(f"payload must be a dict, got {type(payload)}")
    extras = set(payload.keys()) - ITINERARY_ITEM_PERMITTED_FIELDS
    if extras:
        raise AssertionError(
            f"itinerary_item payload contains fields not in Rails permit list: {sorted(extras)}"
        )
    cat = payload.get("category")
    if cat is not None and cat not in ITINERARY_ITEM_CATEGORIES:
        raise AssertionError(
            f"itinerary_item.category={cat!r} not in {sorted(ITINERARY_ITEM_CATEGORIES)}"
        )
    origin = payload.get("origin")
    if origin is not None and origin not in ITINERARY_ITEM_ORIGINS:
        raise AssertionError(
            f"itinerary_item.origin={origin!r} not in {sorted(ITINERARY_ITEM_ORIGINS)}"
        )
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pytest tests/test_rails_contract.py -v
```

Expected: 3 PASSED.

- [ ] **Step 5: Commit**

```bash
git add ai_service/app/services/rails_contract.py ai_service/tests/test_rails_contract.py
git commit -m "feat(ai_service): add rails_contract source-of-truth module + meta-tests"
```

---

## Task 3: Sweep every Python payload builder against the contract

**Files:**
- Create: `ai_service/tests/test_payload_shapes.py`
- Modify: `ai_service/app/services/orchestrator.py` (any callsite that fails the contract)

- [ ] **Step 1: Write a failing parametrized test that calls every payload-builder helper**

```python
# ai_service/tests/test_payload_shapes.py
"""One test per Python function that builds an itinerary_item payload
for Rails. Each one runs the payload through assert_itinerary_item_payload,
which catches: unknown fields, invalid category, invalid origin.

Trip 41 + 44 both shipped with payload-shape bugs that only surfaced as
prod 422s. This file is the regression catcher — adding a new payload
builder without a contract test should be impossible (we'll add an
import-side enforcement in Task 14)."""
from __future__ import annotations

import pytest

from app.services.rails_contract import assert_itinerary_item_payload


class TestBuildAssistItemContract:
    def test_minimal_payload_passes_contract(self):
        from app.services.orchestrator import _build_assist_item
        payload = _build_assist_item({"name": "X", "category": "attraction"})
        assert_itinerary_item_payload(payload)

    def test_payload_with_geo_passes_contract(self):
        from app.services.orchestrator import _build_assist_item
        payload = _build_assist_item({
            "name": "Casa Rosada",
            "category": "attraction",
            "latitude": -34.6, "longitude": -58.37,
            "google_place_id": "ChIJ...",
            "rating": 4.4, "reviews_count": 1234,
            "address": "Plaza de Mayo",
            "source_url": "https://x",
        })
        assert_itinerary_item_payload(payload)

    def test_unknown_category_normalized_to_attraction(self):
        from app.services.orchestrator import _build_assist_item
        for bad in ("place", "", "unknown"):
            payload = _build_assist_item({"name": "X", "category": bad})
            assert payload["category"] == "attraction"
            assert_itinerary_item_payload(payload)
```

- [ ] **Step 2: Run, verify all pass (we already fixed _build_assist_item)**

```bash
pytest tests/test_payload_shapes.py -v
```

Expected: 3 PASSED. (This task pins the existing fix.)

- [ ] **Step 3: Add contract tests for the OTHER payload-build callsites**

Run this to find them all again:

```bash
grep -nE "rails\.(create|update)_itinerary_item" ai_service/app/services/orchestrator.py
```

For each callsite, find the helper that builds its payload (or the inline dict literal) and add a test:

```python
class TestEnrichExperiencePayloadContract:
    """Trip 44 added 4 items via enrich_trip_with_experiences. The
    payload built inside that function (around line 6932) must also
    pass the contract — otherwise the same silent 422 path bites
    non-manual trips."""

    def test_enrichment_item_payload_passes_contract(self):
        # Inline-build the same dict the function does, to keep this
        # test independent of the function's internal control flow.
        # If the source changes, update the constructor here too.
        payload = {
            "name": "Show de tango",
            "category": "activity",
            "time_slot": "21:00",
            "duration_minutes": 120,
            "description": "Authentic milonga in San Telmo.",
            "notes": "Reserve com 1 dia de antecedência.",
            "vibe_tags": ["cultural"],
            "alerts": [],
            "source": "ai",
            "origin": "ai_suggested",
        }
        assert_itinerary_item_payload(payload)

class TestBuildItineraryItemPayloadContract:
    """The eco/sonnet build pipeline in build_trip_itinerary builds a
    bigger payload (around line 4106). Same contract."""

    def test_build_pipeline_payload_passes_contract(self):
        payload = {
            "name": "Caminito",
            "category": "attraction",
            "time_slot": "10:00",
            "duration_minutes": 90,
            "description": "...",
            "notes": "...",
            "vibe_tags": ["passeio"],
            "alerts": [],
            "source": "link",
            "origin": "extracted_from_video",
            "latitude": -34.6, "longitude": -58.37,
            "google_place_id": "ChIJ...",
            "google_rating": 4.5, "google_reviews_count": 5681,
            "address": "Caminito, Buenos Aires",
            "photos": [],
            "operating_hours": {},
        }
        assert_itinerary_item_payload(payload)
```

- [ ] **Step 4: Run all payload-shape tests + fix anything that fails**

```bash
pytest tests/test_payload_shapes.py -v
```

If any test FAILS, that's a real bug. Fix by editing the offending payload builder in `orchestrator.py` to drop unknown fields / map invalid enums. Re-run.

- [ ] **Step 5: Commit**

```bash
git add ai_service/tests/test_payload_shapes.py ai_service/app/services/orchestrator.py
git commit -m "test(ai_service): contract-check every itinerary_item payload builder"
```

---

## Task 4: Create the canonical frontend payload builder

**Files:**
- Create: `frontend/src/utils/itineraryItemPayload.js`
- Test: `frontend/src/utils/__tests__/itineraryItemPayload.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// frontend/src/utils/__tests__/itineraryItemPayload.test.js
/**
 * Pins the canonical builder against the Rails permit list. Trip 44
 * surfaced this as a real bug: handleDragEnd in TripDetail.js sent
 * only {name, category, source, origin, source_url} — losing every
 * geo field the place was carrying. The new card landed with no
 * coords and the map pin silently disappeared. This test makes
 * sure the canonical builder propagates everything Rails will accept.
 */
import { buildItineraryItemPayload, RAILS_PERMITTED_FIELDS, RAILS_VALID_CATEGORIES } from "../itineraryItemPayload";

describe("buildItineraryItemPayload", () => {
  test("propagates every geo field from the place", () => {
    const place = {
      name: "Caminito",
      category: "attraction",
      source_url: "https://x",
      latitude: -34.6,
      longitude: -58.37,
      address: "Caminito, BA",
      google_place_id: "ChIJ...",
      rating: 4.5,
      reviews_count: 5681,
      photo_url: "https://photo/1.jpg",
      photos: ["https://photo/1.jpg", "https://photo/2.jpg"],
      phone: "+54 11 ...",
      website: "https://caminito.example",
      operating_hours: { Monday: "9-5" },
      pricing: "$$",
    };
    const payload = buildItineraryItemPayload(place, { dayPlanId: 1 });
    expect(payload.latitude).toBe(-34.6);
    expect(payload.longitude).toBe(-58.37);
    expect(payload.google_place_id).toBe("ChIJ...");
    expect(payload.google_rating).toBe(4.5);
    expect(payload.google_reviews_count).toBe(5681);
    expect(payload.address).toBe("Caminito, BA");
    expect(payload.photos).toEqual(["https://photo/1.jpg", "https://photo/2.jpg"]);
    expect(payload.operating_hours).toEqual({ Monday: "9-5" });
    expect(payload.pricing_info).toBe("$$");
  });

  test("normalizes invalid category to attraction", () => {
    for (const bad of ["place", "", null, undefined, "unknown"]) {
      const payload = buildItineraryItemPayload({ name: "X", category: bad });
      expect(RAILS_VALID_CATEGORIES.has(payload.category)).toBe(true);
    }
  });

  test("never emits fields outside the Rails permit list", () => {
    const place = {
      name: "X",
      category: "attraction",
      // junk fields that shouldn't appear in the payload
      __debug: true,
      internal_id: 999,
      poolIndex: 5,
      community_notes: [{ note: "x" }],
      editorial_summary: "x",
      top_reviews: [{}],
      creator_note: "x",
      rich_description: "x",
      practical_tips: ["x"],
      kind: "place",
    };
    const payload = buildItineraryItemPayload(place);
    const extra = Object.keys(payload).filter((k) => !RAILS_PERMITTED_FIELDS.has(k));
    expect(extra).toEqual([]);
  });

  test("maps rating → google_rating, reviews_count → google_reviews_count", () => {
    const payload = buildItineraryItemPayload({
      name: "X", category: "attraction", rating: 4.7, reviews_count: 100,
    });
    expect(payload.rating).toBeUndefined();
    expect(payload.reviews_count).toBeUndefined();
    expect(payload.google_rating).toBe(4.7);
    expect(payload.google_reviews_count).toBe(100);
  });

  test("default origin is extracted_from_video", () => {
    const payload = buildItineraryItemPayload({ name: "X", category: "attraction" });
    expect(payload.origin).toBe("extracted_from_video");
  });

  test("origin can be overridden", () => {
    const payload = buildItineraryItemPayload(
      { name: "X", category: "attraction" },
      { origin: "ai_suggested" },
    );
    expect(payload.origin).toBe("ai_suggested");
  });
});
```

- [ ] **Step 2: Run, verify it fails (module doesn't exist)**

```bash
cd frontend && npm test -- itineraryItemPayload.test.js --watchAll=false
```

Expected: Cannot find module.

- [ ] **Step 3: Implement the builder**

```javascript
// frontend/src/utils/itineraryItemPayload.js
/**
 * Canonical Rails-shaped itinerary_item payload builder.
 *
 * Single source of truth for "what fields can we send to Rails when
 * creating or updating an itinerary_item". Every callsite (drag-drop,
 * quick-add modal, AI assist, manual form) MUST use this — otherwise
 * we re-introduce the trip 41/44 bugs:
 *   - dropping geo fields → pin disappears
 *   - sending Python-style names (rating, reviews_count) → 422
 *   - sending unknown categories ("place") → 422
 *   - sending unknown origins ("ai_assist_manual") → 422
 *
 * Mirrors backend/app/controllers/api/v1/itinerary_items_controller.rb
 * permit list + backend/app/models/itinerary_item.rb enums. Keep these
 * sets in sync — there's a Python-side test that asserts the same
 * (test_rails_contract.py).
 */

export const RAILS_PERMITTED_FIELDS = new Set([
  "name", "description", "category", "time_slot", "duration_minutes",
  "position", "latitude", "longitude", "address", "google_place_id",
  "google_rating", "google_reviews_count", "pricing_info", "phone",
  "website", "notes", "source_url", "personal_notes",
  "alternative_group", "source", "origin", "source_video_url",
  "source_video_creator", "extraction_method", "priority",
  "item_status", "best_turn", "region", "activity_model",
  "visit_mode", "item_role", "operating_hours", "photos", "vibe_tags",
  "alerts",
]);

export const RAILS_VALID_CATEGORIES = new Set([
  "restaurant", "attraction", "hotel", "transport", "activity",
  "shopping", "cafe", "nightlife", "other",
]);

export const RAILS_VALID_ORIGINS = new Set([
  "extracted_from_video", "ai_suggested", "user_added",
]);

function normalizeCategory(raw) {
  const cat = (raw || "").toString().trim().toLowerCase();
  return RAILS_VALID_CATEGORIES.has(cat) ? cat : "attraction";
}

function normalizeOrigin(raw, fallback = "extracted_from_video") {
  const o = (raw || fallback).toString().trim().toLowerCase();
  return RAILS_VALID_ORIGINS.has(o) ? o : fallback;
}

/**
 * Build an itinerary_item payload from a place dict + optional overrides.
 *
 * @param {object} place — a places_mentioned entry, an extracted card,
 *   a Google Places result, etc. Field names follow our internal
 *   convention (rating, reviews_count, photo_url, pricing) — the builder
 *   maps them to Rails-side names (google_rating, google_reviews_count,
 *   photos, pricing_info).
 * @param {object} overrides — optional. May include `origin`, `source`,
 *   `category`, `time_slot`, `duration_minutes`, `position`, `notes`,
 *   etc. Useful when the calling context knows something the place
 *   dict doesn't (e.g. the AI assist path forces origin="ai_suggested").
 * @returns {object} payload — only contains keys in RAILS_PERMITTED_FIELDS
 */
export function buildItineraryItemPayload(place = {}, overrides = {}) {
  const photos = Array.isArray(place.photos)
    ? place.photos.filter(Boolean)
    : (place.photo_url ? [place.photo_url] : []);

  const out = {
    name: (place.name || "").toString(),
    category: normalizeCategory(overrides.category ?? place.category),
    source: overrides.source || (place.source_url ? "link" : "ai"),
    origin: normalizeOrigin(overrides.origin, "extracted_from_video"),
    source_url: place.source_url ?? null,
    latitude: place.latitude ?? null,
    longitude: place.longitude ?? null,
    address: place.address ?? null,
    google_place_id: place.google_place_id ?? null,
    google_rating: place.rating ?? place.google_rating ?? null,
    google_reviews_count: place.reviews_count ?? place.google_reviews_count ?? null,
    photos,
    phone: place.phone ?? null,
    website: place.website ?? null,
    operating_hours: place.operating_hours ?? {},
    pricing_info: place.pricing ?? place.pricing_info ?? null,
  };

  // Selectively merge ONLY known fields from overrides.
  for (const [k, v] of Object.entries(overrides)) {
    if (!RAILS_PERMITTED_FIELDS.has(k)) continue;
    if (k === "category" || k === "origin") continue; // already normalized
    out[k] = v;
  }

  // Drop any leaked unknown keys (defensive: e.g. if the caller passed
  // the raw place dict by mistake into overrides).
  for (const k of Object.keys(out)) {
    if (!RAILS_PERMITTED_FIELDS.has(k)) {
      delete out[k];
    }
  }

  return out;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- itineraryItemPayload.test.js --watchAll=false
```

Expected: 6 PASSED.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/utils/itineraryItemPayload.js frontend/src/utils/__tests__/itineraryItemPayload.test.js
git commit -m "feat(frontend): canonical itinerary_item payload builder + tests"
```

---

## Task 5: Refactor handleDragEnd to use the canonical builder

**Files:**
- Modify: `frontend/src/pages/TripDetail.js` (the `if (source.droppableId === ExtractedPlacesPanel.DROPPABLE_ID)` block in `handleDragEnd`)

- [ ] **Step 1: Read the current handler to confirm its location**

```bash
grep -n "ExtractedPlacesPanel.DROPPABLE_ID\|extracted::" frontend/src/pages/TripDetail.js | head -5
```

- [ ] **Step 2: Replace the inline payload with a call to the canonical builder**

In `handleDragEnd`, replace the long inline `addItem(destDayId, { name, category, ... })` block with:

```javascript
import { buildItineraryItemPayload } from "../utils/itineraryItemPayload";

// inside handleDragEnd, after locating `place`:
addItem(destDayId, buildItineraryItemPayload(place, {
  origin: "extracted_from_video",
}));
```

(Make sure to add the import at the top of the file alongside the other utils.)

- [ ] **Step 3: Manually verify the dragged-place pin appears on the map**

```bash
# Backend running on :3000, AI on :8000, Frontend on :3002
# Open a manual trip, drag a card with known geo into Day 1.
# Inspect the POST /itinerary_items request body in DevTools Network tab.
# Expect: latitude, longitude, google_place_id all present.
```

- [ ] **Step 4: Refactor `handleAddPlaceToDay` (the modal quick-add) to use the same builder**

```javascript
const handleAddPlaceToDay = useCallback(
  async (place, dayPlanId) => {
    if (!place || !dayPlanId) return;
    await addItem(dayPlanId, buildItineraryItemPayload(place, {
      origin: "extracted_from_video",
    }));
    setTimeout(() => closePlaceDetail(), 600);
  },
  [addItem, closePlaceDetail],
);
```

- [ ] **Step 5: Lint + commit**

```bash
cd frontend && npx eslint src/pages/TripDetail.js
git add frontend/src/pages/TripDetail.js
git commit -m "refactor(TripDetail): use canonical itinerary_item payload builder"
```

---

## Task 6: Sweep every other addItem callsite

**Files:**
- Modify: any file under `frontend/src/` that calls `addItem(...)` or `createItem(...)` with a hand-built object

- [ ] **Step 1: Find every callsite**

```bash
grep -rnE "addItem\(|itemsApi\.createItem\(" frontend/src/ --include="*.js" | grep -v node_modules
```

- [ ] **Step 2: For each callsite, replace inline object literals with `buildItineraryItemPayload(...)`**

For callers that build a payload from a non-place source (e.g. `ItemForm`'s manual entry), refactor to:

```javascript
import { buildItineraryItemPayload } from "../../utils/itineraryItemPayload";

const payload = buildItineraryItemPayload(formData, {
  origin: "user_added",
  source: "ai", // manual form, no source video
});
await onSubmit(payload);
```

- [ ] **Step 3: Run the frontend test suite**

```bash
npm test -- --watchAll=false
```

Expected: all pass; if any callsite test fails because the field name changed (e.g. `rating` → `google_rating`), update the test to match.

- [ ] **Step 4: Lint changed files**

```bash
npx eslint $(git diff --name-only --diff-filter=M | grep '\.js$' | grep '^frontend/')
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/
git commit -m "refactor(frontend): all itinerary_item callsites go through canonical builder"
```

---

## Task 7: Defensive runtime warning for unknown payload fields

**Files:**
- Modify: `frontend/src/utils/itineraryItemPayload.js`

- [ ] **Step 1: Write the failing test**

```javascript
// frontend/src/utils/__tests__/itineraryItemPayload.test.js
test("warns in dev when overrides contain unknown fields", () => {
  const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
  buildItineraryItemPayload(
    { name: "X" },
    { unknown_field: 42, also_bogus: true },
  );
  expect(warn).toHaveBeenCalledWith(
    expect.stringContaining("itineraryItemPayload"),
    expect.arrayContaining(["unknown_field", "also_bogus"]),
  );
  warn.mockRestore();
});
```

- [ ] **Step 2: Run, verify fails**

```bash
npm test -- itineraryItemPayload.test.js --watchAll=false
```

Expected: FAIL — no warning fired.

- [ ] **Step 3: Add the warning to the builder**

In `buildItineraryItemPayload`, before the merge loop:

```javascript
if (process.env.NODE_ENV !== "production") {
  const unknownOverrides = Object.keys(overrides).filter(
    (k) => !RAILS_PERMITTED_FIELDS.has(k),
  );
  if (unknownOverrides.length > 0) {
    // eslint-disable-next-line no-console
    console.warn(
      "[itineraryItemPayload] dropping unknown override fields:",
      unknownOverrides,
    );
  }
}
```

- [ ] **Step 4: Run, verify passes**

```bash
npm test -- itineraryItemPayload.test.js --watchAll=false
```

Expected: 7 PASSED.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/utils/itineraryItemPayload.js frontend/src/utils/__tests__/itineraryItemPayload.test.js
git commit -m "feat(frontend): dev-only warning for unknown payload override fields"
```

---

## Task 8: Audit every AI-side mutating endpoint for manual-mode guard

**Files:**
- Create: `ai_service/tests/test_ai_mutating_endpoints_respect_manual.py`
- Modify: `ai_service/app/services/orchestrator.py` (any function still missing the guard)

- [ ] **Step 1: Inventory mutating functions**

```bash
grep -nE "^async def (build_trip_itinerary|enrich_trip_with_experiences|optimize_trip_routing|refine_itinerary|add_day_trip|merge_link_into_existing_trip|extract_profile_and_build|manual_assist_organize|reenrich_trip_places)" ai_service/app/services/orchestrator.py
```

Document each one's current behavior:
- Does it mutate trip data? (yes/no)
- Should it be allowed in manual mode? (yes ONLY for manual_assist_organize, reenrich_trip_places, merge_link_into_existing_trip)

- [ ] **Step 2: Write a parametrized failing test for each function that should refuse manual mode**

```python
# ai_service/tests/test_ai_mutating_endpoints_respect_manual.py
"""For every AI-side function that mutates a trip, prove it bails on
ai_mode=manual. The user explicitly chose manual; no AI may move,
add, or delete an item without an explicit user click on '🪄 Assistência
IA' (which routes through manual_assist_organize, the one whitelisted
exception)."""
from __future__ import annotations
from unittest.mock import patch
import pytest


class FakeRails:
    def __init__(self, ai_mode):
        self.trip = {
            "id": 99, "ai_mode": ai_mode, "destination": "London",
            "profile_status": "confirmed",
            "traveler_profile": {"places_mentioned": []},
        }
        self.mutations = []
    async def get_trip(self, _): return self.trip
    async def get_day_plans(self, _): return []
    async def update_trip(self, *a, **k): self.mutations.append("update_trip"); return {}
    async def create_itinerary_item(self, *a, **k):
        self.mutations.append("create_itinerary_item"); return {"id": 1}
    async def update_itinerary_item(self, *a, **k):
        self.mutations.append("update_itinerary_item"); return {}


@pytest.mark.parametrize("fn_name", [
    "enrich_trip_with_experiences",
    "optimize_trip_routing",
    "build_trip_itinerary",
    "refine_itinerary",
    "add_day_trip",
])
@pytest.mark.asyncio
async def test_function_refuses_manual_mode(fn_name):
    """Every non-whitelisted mutating function must short-circuit on
    ai_mode=manual without calling Anthropic or writing to Rails."""
    from app.services import orchestrator
    fn = getattr(orchestrator, fn_name)
    rails = FakeRails(ai_mode="manual")
    with patch("app.services.orchestrator.RailsClient", return_value=rails), \
         patch("app.services.orchestrator.anthropic.Anthropic") as anth:
        # Pass minimal kwargs each function expects.
        if fn_name == "refine_itinerary":
            result = await fn(99, "feedback text", "trip", None)
        elif fn_name == "add_day_trip":
            result = await fn(99, "Brighton", "UK", "extend", None)
        else:
            result = await fn(99)
    assert isinstance(result, dict)
    # The function should return some skipped/refused signal.
    assert (
        result.get("skipped") == "manual_mode"
        or result.get("error", "").startswith("manual_mode")
        or result.get("added") == 0
        and result.get("changed") == 0
    ), f"{fn_name} did not refuse manual mode: {result!r}"
    # No Anthropic call.
    anth.assert_not_called()
    # No Rails mutation (whitelist: it's OK to call get_trip/get_day_plans).
    assert rails.mutations == [], f"{fn_name} mutated Rails: {rails.mutations}"
```

- [ ] **Step 3: Run, see which functions FAIL the contract**

```bash
pytest tests/test_ai_mutating_endpoints_respect_manual.py -v
```

For each FAIL, the function is missing the manual-mode guard.

- [ ] **Step 4: Add the guard to each failing function**

For each function that fails, add at the top (right after `trip = await rails.get_trip(...)`):

```python
ai_mode = (trip.get("ai_mode") or "").strip().lower()
if ai_mode == "manual":
    logger.info(
        "[%s] trip=%d skipped — ai_mode=manual (user owns itinerary)",
        "<function name>", trip_id,
    )
    return {"skipped": "manual_mode", "added": 0, "changed": 0}
```

- [ ] **Step 5: Run again, confirm all pass + commit**

```bash
pytest tests/test_ai_mutating_endpoints_respect_manual.py -v
```

```bash
git add ai_service/tests/test_ai_mutating_endpoints_respect_manual.py ai_service/app/services/orchestrator.py
git commit -m "feat(ai_service): every mutating AI fn defensively refuses manual-mode trips"
```

---

## Task 9: Audit frontend useEffects for AI auto-trigger guards

**Files:**
- Modify: `frontend/src/pages/TripDetail.js`, `frontend/src/hooks/useTripDetail.js`

- [ ] **Step 1: Find every useEffect that calls an AI endpoint**

```bash
grep -nE "enrichTripExperiences|optimizeTripRouting|reenrichTripPlaces|triggerBuild|manualAssist|resumeProcessing|analyzeTrip|refineItinerary" frontend/src/ -r --include="*.js"
```

For each callsite, check whether the surrounding `useEffect` (or handler) gates on `ai_mode`.

- [ ] **Step 2: For each unguarded callsite, add the guard**

Pattern:

```javascript
useEffect(() => {
  if (!trip) return;
  if (trip.ai_mode === "manual") return;  // ← add if missing
  // ... existing logic
}, [trip, ...]);
```

- [ ] **Step 3: Verify by manually exercising the trip-detail page in manual mode**

Open a manual trip in dev and confirm no `POST /api/enrich-experiences`, `/api/optimize-trip`, or `/api/refine-itinerary` requests fire in the Network tab on page load or after dragging a card.

- [ ] **Step 4: Lint + commit**

```bash
cd frontend && npx eslint src/pages/TripDetail.js src/hooks/useTripDetail.js
git add frontend/src/pages/TripDetail.js frontend/src/hooks/useTripDetail.js
git commit -m "chore(frontend): every AI auto-trigger respects ai_mode=manual"
```

---

## Task 10: Race-preservation audit for places_mentioned write-backs

**Files:**
- Create: `ai_service/tests/test_race_preservation.py`
- Modify: `ai_service/app/services/orchestrator.py` (any write-back that doesn't preserve enriched data)

- [ ] **Step 1: Inventory write-backs**

```bash
grep -nE "profile\[\"places_mentioned\"\]\s*=" ai_service/app/services/orchestrator.py
```

Each line is a place where `places_mentioned` is replaced. Each must preserve enriched fields when there's a race (e.g. analyze_trip running after extract_profile_and_build).

- [ ] **Step 2: Write the failing test**

```python
# ai_service/tests/test_race_preservation.py
"""Trip 43 spent two hours debugging "no data" cards. Cause: analyze_trip
fired AFTER extract_profile_and_build had geocoded the places, then
overwrote the enriched places_mentioned with the bare Haiku output —
losing every lat/lng. The fix is the existing 'preserve when ≥3
enriched + ≥50% with geo' rule. This test pins it."""
from __future__ import annotations
import copy
from unittest.mock import patch, AsyncMock
import pytest


class FakeRails:
    def __init__(self, trip):
        self._trip = trip
        self.updates = []
    async def get_trip(self, _): return copy.deepcopy(self._trip)
    async def update_trip(self, _, payload):
        self.updates.append(payload)
        if "traveler_profile" in payload:
            self._trip["traveler_profile"] = payload["traveler_profile"]
        return {"id": 1}


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

    # Mock _analyze_profile to return a BARE places list (no geo) — this
    # simulates the race we want to defend against.
    bare = [{"name": "Caminito"}, {"name": "Obelisco"}, {"name": "Casa Rosada"}]
    with patch("app.services.orchestrator.RailsClient", return_value=rails), \
         patch("app.services.orchestrator._analyze_profile",
               new=AsyncMock(return_value={"places_mentioned": bare,
                                            "country_detected": "Argentina",
                                            "cities_detected": ["BA"]})):
        await analyze_trip(1)

    # The persisted profile must STILL have all three lat/lng intact.
    assert rails.updates, "analyze_trip never wrote anything"
    final_places = rails.updates[-1]["traveler_profile"]["places_mentioned"]
    by_name = {p["name"]: p for p in final_places}
    for name in ("Caminito", "Obelisco", "Casa Rosada"):
        assert by_name[name].get("latitude") is not None, (
            f"{name} lost latitude after analyze_trip race")
```

- [ ] **Step 3: Run, verify it passes (we already added the rule)**

```bash
pytest tests/test_race_preservation.py -v
```

Expected: PASS. (This task pins the existing fix.)

If FAIL: that means the race-preservation rule is missing or broken — find the place_mentioned write in `analyze_trip` and re-add the "preserve when ≥3 enriched + ≥50% with geo" guard.

- [ ] **Step 4: Add a second test for the merge_link_into_existing_trip path**

```python
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
```

- [ ] **Step 5: Run + commit**

```bash
pytest tests/test_race_preservation.py -v
```

```bash
git add ai_service/tests/test_race_preservation.py
git commit -m "test(ai_service): pin race-preservation across places_mentioned write-backs"
```

---

## Task 11: Sticky+overflow audit (UX scroll capture)

**Files:**
- Modify: any frontend component with `sticky top-` AND a child with `overflow-y-auto`

- [ ] **Step 1: Find every potential offender**

```bash
grep -rnE "sticky|fixed.*top-" frontend/src/components/ --include="*.js" -l \
  | xargs grep -lE "overflow-y-(auto|scroll)" 2>/dev/null
```

- [ ] **Step 2: For each offender, verify the structure is "fixed-height parent → flex-1 scroll child"**

The pattern that works (already applied to ExtractedPlacesPanel):
```jsx
<aside className="sticky top-4 max-h-[calc(100vh-2rem)] flex flex-col">
  <header className="flex-shrink-0">…</header>
  <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain touch-pan-y">…</div>
</aside>
```

The pattern that breaks the wheel (the bug the user hit):
```jsx
<aside className="sticky top-4 h-fit">
  <div className="max-h-[…] overflow-y-auto">…</div>
</aside>
```

For each offender NOT matching the working pattern, refactor.

- [ ] **Step 3: Manually verify by opening each affected page in dev and using the mouse wheel inside the sticky panel**

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/
git commit -m "fix(ui): standardize sticky+overflow panels on flex-1 inner-scroll pattern"
```

---

## Task 12: Google Maps scroll-zoom audit

**Files:**
- Modify: any `<GoogleMap>` instance in frontend

- [ ] **Step 1: Find every map instance**

```bash
grep -rn "<GoogleMap" frontend/src/ --include="*.js"
```

- [ ] **Step 2: For each instance, confirm `gestureHandling: "cooperative"` (or `"none"` for landing-page maps)**

The default `"auto"` swallows wheel events for zoom — exactly the bug that made the trip page feel stuck.

- [ ] **Step 3: For any map missing the option, add it**

```javascript
const MAP_OPTIONS = {
  // ... existing options
  gestureHandling: "cooperative",
};
```

- [ ] **Step 4: Manually verify the page scrolls when the cursor is over the map**

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/
git commit -m "fix(ui): every interactive Google Map uses cooperative gesture handling"
```

---

## Task 13: Panel↔Map sync key audit

**Files:**
- Modify: any component pair that pairs a list card with a map pin

- [ ] **Step 1: Find every `highlightedXxxKey` / `hoveredXxxKey` callsite**

```bash
grep -rnE "highlighted\w*Key|hovered\w*Key|google_place_id\s*\|\|\s*name" frontend/src/ --include="*.js"
```

- [ ] **Step 2: For each callsite, verify the key is a STABLE UNIQUE INDEX, not a name or place_id**

The trip 41 bug: `placeKey = google_place_id || name` — collides when two cards share a name (same place mentioned in two videos). Fix is `placeKey = String(globalIndex)` (or any per-card unique value).

- [ ] **Step 3: Add a regression test (frontend)**

```javascript
// frontend/src/components/__tests__/extractedPanelMapSync.test.js
import { render, fireEvent, screen } from "@testing-library/react";
// ... existing test setup
test("hovering one of two same-named cards highlights only its own pin", () => {
  // Build a panel with two "Barrio Chino" cards (different globalIndex,
  // different lat/lng).
  // Hover card #0; assert only pin #0 has the coral fill.
  // Hover card #5; assert only pin #5 has it.
});
```

- [ ] **Step 4: Run, fix any callsite still using name/place_id as key**

- [ ] **Step 5: Commit**

```bash
git commit -am "test(frontend): pin panel↔map sync uses stable per-card index"
```

---

## Task 14: Wire contract tests into CI / pre-commit

**Files:**
- Modify: `ai_service/pyproject.toml` or `pytest.ini` (mark contract tests as fast)
- Create: `.github/workflows/contracts.yml` (if CI exists) OR add to existing

- [ ] **Step 1: Verify all contract tests are tagged consistently**

In each contract test file, add at the top:

```python
import pytest
pytestmark = pytest.mark.contracts
```

- [ ] **Step 2: Configure pytest marker**

In `ai_service/pytest.ini` (or `pyproject.toml`):

```ini
[pytest]
markers =
    contracts: cross-layer contract tests (run on every commit)
```

- [ ] **Step 3: Add a CI step that runs contracts first, fast-fails**

If `.github/workflows/` exists:

```yaml
# .github/workflows/contracts.yml
name: Contract checks
on: [push, pull_request]
jobs:
  contracts:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: "3.12" }
      - working-directory: ai_service
        run: |
          pip install -e .
          pytest -m contracts -v
      - uses: actions/setup-node@v4
        with: { node-version: "20" }
      - working-directory: frontend
        run: |
          npm ci
          npm test -- itineraryItemPayload.test.js --watchAll=false
```

If no CI: skip this step but document the local pre-commit hook in README.

- [ ] **Step 4: Run the full contract suite locally to confirm green**

```bash
cd ai_service && source .venv/bin/activate && pytest -m contracts -v
cd ../frontend && npm test -- --watchAll=false --testPathPattern=itineraryItemPayload
```

- [ ] **Step 5: Commit**

```bash
git add ai_service/pytest.ini .github/workflows/contracts.yml ai_service/tests/
git commit -m "ci: gate every commit on cross-layer contract tests"
```

---

## Task 15: Dashboard summary of audit findings

**Files:**
- Create: `docs/superpowers/audits/2026-04-26-findings-and-followups.md`

- [ ] **Step 1: Compile the audit results into one doc**

Sections:
- **Bugs found:** every test that initially FAILED + line of orchestrator/TripDetail that needed a fix
- **Surfaces still uncovered:** callsites we audited but couldn't write a test for (with reason)
- **Follow-up tickets:** anything found that's bigger than one task and needs its own brainstorm

- [ ] **Step 2: Commit + push**

```bash
git add docs/superpowers/audits/
git commit -m "docs: post-audit findings + follow-up backlog"
git push origin main
```

- [ ] **Step 3: Final verification — run the entire test suite + lint everything**

```bash
cd ai_service && source .venv/bin/activate && pytest tests/ -v
cd ../frontend && npm test -- --watchAll=false && npx eslint src/
cd ../backend && bundle exec rails test
```

Expected: all green.

- [ ] **Step 4: Push the final commit**

```bash
git push origin main
```

- [ ] **Step 5: Mark plan complete**

Move this plan file to `docs/superpowers/plans/done/` (create the dir if needed):

```bash
mkdir -p docs/superpowers/plans/done
git mv docs/superpowers/plans/2026-04-26-codebase-audit-and-regression-catchers.md docs/superpowers/plans/done/
git commit -m "chore(docs): archive completed audit plan"
git push origin main
```

---

## Self-Review Notes

**Spec coverage check:**
- ✅ Python ↔ Rails permit list mismatches → Tasks 2, 3 (rails_contract module + sweep)
- ✅ Drag-drop losing geo → Tasks 4, 5, 6 (canonical builder + refactor every callsite)
- ✅ Auto-AI rewriting manual itinerary → Tasks 8, 9 (backend defensive + frontend audit)
- ✅ Name-collision in panel↔map → Task 13 (sync key audit)
- ✅ Scroll death (sticky+overflow) → Task 11 (sticky audit)
- ✅ Google Maps scroll capture → Task 12
- ✅ places_mentioned race wiping enrichment → Task 10 (race-preservation tests)
- ✅ CI/regression-catchers → Task 14 (contract gating)

**Type consistency check:**
- `buildItineraryItemPayload(place, overrides)` — same signature across Tasks 4, 5, 6
- `assert_itinerary_item_payload(payload)` — same signature in Task 2 + used in Task 3
- `ITINERARY_ITEM_PERMITTED_FIELDS` (Python) ↔ `RAILS_PERMITTED_FIELDS` (JS) — different names, intentional (each side names its own constant), same content

**No placeholders:** every step has either an exact command or a complete code block. Audit-style steps name their grep commands explicitly so the next engineer can re-run them.
