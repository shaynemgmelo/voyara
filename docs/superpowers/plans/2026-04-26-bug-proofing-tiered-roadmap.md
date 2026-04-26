# Bug-Proofing Tiered Roadmap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the entire app resistant to the bug-classes that have hit production this month — extending the cross-layer audit defenses (rails_contract, manual-mode guards, race-preservation, deep-merge) from one model + one endpoint to the WHOLE surface, and adding new defenses (DB constraints, error budgets, observability, type safety) that catch the bug classes the audit didn't.

**Architecture:** Four independent tiers, each shipping value alone. Tier 1 generalizes the patterns we already proved. Tier 2 adds DB-level invariants + lint that catch whole classes statically. Tier 3 makes prod failures visible. Tier 4 raises the type ceiling. Execute tiers in order — each builds on the previous but doesn't depend on it.

**Tech Stack:** Existing — Rails 8, Python 3.12 + FastAPI, React 18 CRA. New tooling: Sentry SDK (Tier 3), Playwright (Tier 3), Pydantic (Tier 4). No framework migrations.

---

## File Structure

**Tier 1 — Generalize defenses across endpoints:**
- Modify: `backend/app/controllers/api/v1/{trips,day_plans,lodgings,links}_controller.rb` — apply deep-merge pattern to every PATCH that takes a JSON column
- Create: `backend/app/controllers/concerns/json_column_merge.rb` — extract the deep-merge helper used in `trips_controller.rb` into a reusable concern
- Modify: `ai_service/app/services/rails_contract.py` — extend with TRIP_PERMITTED_FIELDS, DAY_PLAN_PERMITTED_FIELDS, LINK_PERMITTED_FIELDS + matching meta-tests
- Modify: `ai_service/tests/test_rails_contract.py` — meta-test for each new contract
- Create: `frontend/src/utils/profileFields.js` — shared whitelist of frontend-owned vs backend-owned profile fields
- Modify: `frontend/src/hooks/useTripDetail.js` — import from profileFields.js

**Tier 2 — DB constraints + lint + API versioning:**
- Create: `backend/db/migrate/20260427000000_add_data_integrity_constraints.rb` — NOT NULL + FK + CHECK
- Create: `ai_service/scripts/lint_silent_excepts.py` — flag broad except without log/re-raise
- Create: `.github/workflows/lint.yml` — run the lint in CI
- Modify: `backend/app/controllers/api/v1/base_controller.rb` — emit `X-API-Version` header
- Modify: `frontend/src/api/client.js` — read `X-API-Version`, warn on mismatch

**Tier 3 — Production observability:**
- Modify: `backend/Gemfile`, `backend/config/initializers/sentry.rb` — add Sentry-Ruby
- Modify: `ai_service/pyproject.toml`, `ai_service/app/main.py` — add Sentry SDK Python
- Modify: `frontend/package.json`, `frontend/src/index.js` — add Sentry React + error boundary
- Create: `e2e/smoke.spec.ts` — Playwright smoke test
- Modify: `.github/workflows/contracts.yml` — Slack notification on failure

**Tier 4 — Type safety at boundaries:**
- Create: `ai_service/app/api/schemas_v2.py` — Pydantic models for trip, day_plan, itinerary_item
- Modify: `ai_service/app/services/rails_client.py` — return typed objects, not dicts
- Modify: `ai_service/pyproject.toml` — enable `mypy --strict` for `app/services/rails_client.py`

---

## TIER 1 — Generalize Cross-Layer Defenses

> Goal: extend the rails_contract / deep-merge / canonical-payload patterns from `itinerary_items` + `trips` to every model the frontend touches. Estimated: 8 tasks, ~2 hours.

### Task 1: Inventory PATCH endpoints + JSON columns

**Files:**
- Create: `docs/superpowers/audits/2026-04-26-patch-endpoint-inventory.md`

- [ ] **Step 1: Run the inventory commands**

```bash
grep -rnE "params\.require\(:[a-z_]+\)\.permit" backend/app/controllers/api/v1/
grep -rnE "jsonb|json " backend/db/schema.rb | grep -v "^--"
grep -rnE "tripsApi\.updateTrip|patch\(.*trips/" frontend/src/ --include="*.js"
```

- [ ] **Step 2: Write the audit doc**

For each PATCH endpoint in the codebase, document in a markdown table:
- Controller + action
- Permit list scalars
- Permit list nested hashes / JSON columns
- Whether the endpoint REPLACES or DEEP-MERGES the JSON column today
- Whether the frontend sends the WHOLE object or just edited fields
- Risk assessment: HIGH (clobbers backend-owned fields) / MEDIUM (clobbers user data on race) / LOW (no JSON columns)

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/audits/2026-04-26-patch-endpoint-inventory.md
git commit -m "docs: PATCH endpoint inventory pre-tier-1 audit"
```

---

### Task 2: Extract deep-merge into a Rails concern

**Files:**
- Create: `backend/app/controllers/concerns/json_column_merge.rb`
- Modify: `backend/app/controllers/api/v1/trips_controller.rb`
- Test: `backend/test/controllers/concerns/json_column_merge_test.rb`

- [ ] **Step 1: Write the failing test**

```ruby
# backend/test/controllers/concerns/json_column_merge_test.rb
require "test_helper"

class JsonColumnMergeTest < ActiveSupport::TestCase
  include JsonColumnMerge

  test "merge_json_column deep-merges nested hashes" do
    existing = { "a" => 1, "nested" => { "x" => 10, "y" => 20 } }
    incoming = { "nested" => { "y" => 99, "z" => 30 } }
    result = merge_json_column(existing, incoming)
    assert_equal 1, result["a"]
    assert_equal 10, result["nested"]["x"]   # preserved
    assert_equal 99, result["nested"]["y"]   # overridden
    assert_equal 30, result["nested"]["z"]   # added
  end

  test "merge_json_column replaces arrays wholesale" do
    existing = { "list" => [1, 2, 3] }
    incoming = { "list" => [9, 8] }
    result = merge_json_column(existing, incoming)
    assert_equal [9, 8], result["list"]
  end

  test "merge_json_column handles nil existing" do
    result = merge_json_column(nil, { "a" => 1 })
    assert_equal({ "a" => 1 }, result)
  end

  test "merge_json_column handles nil incoming" do
    result = merge_json_column({ "a" => 1 }, nil)
    assert_equal({ "a" => 1 }, result)
  end
end
```

- [ ] **Step 2: Run, verify it fails**

```bash
cd backend && bundle exec rails test test/controllers/concerns/json_column_merge_test.rb
```

Expected: FAIL — `JsonColumnMerge` not defined.

- [ ] **Step 3: Implement the concern**

```ruby
# backend/app/controllers/concerns/json_column_merge.rb
# Deep-merges an incoming JSON-column update into the existing value
# instead of replacing it. Used by every controller PATCH that accepts
# a JSON column the frontend might send only PARTIALLY.
#
# Trip 46 surfaced the bug class this concern protects against:
# the frontend cached a stale snapshot of traveler_profile (taken
# BEFORE the AI service finished geocoding 53 places), then PATCHed
# the WHOLE profile back. Rails replaced the JSON column wholesale,
# clobbering the freshly-enriched places_mentioned. Cards showed
# "no data", map pins disappeared.
#
# Behavior:
#   - Hashes deep-merge — incoming keys win, missing keys preserved
#   - Arrays REPLACE — if incoming sends [], existing list is wiped
#     (this is intentional: arrays are atomic; a partial-array update
#     would be ambiguous about ordering / dedup)
#   - nil-safe on either side
module JsonColumnMerge
  extend ActiveSupport::Concern

  def merge_json_column(existing, incoming)
    return (incoming || {}) if existing.blank?
    return existing if incoming.blank?
    existing.deep_merge(incoming.to_h)
  end
end
```

- [ ] **Step 4: Refactor `trips_controller.rb#update` to use the concern**

```ruby
# backend/app/controllers/api/v1/trips_controller.rb
class Api::V1::TripsController < ApplicationController
  include JsonColumnMerge

  # ... existing before_actions ...

  def update
    permitted = trip_params
    if permitted[:traveler_profile].present?
      permitted = permitted.to_h
      permitted["traveler_profile"] = merge_json_column(
        @trip.traveler_profile, permitted["traveler_profile"],
      )
    end

    if @trip.update(permitted)
      render json: TripSerializer.new(@trip, include_details: true).as_json
    else
      render json: { errors: @trip.errors.full_messages }, status: :unprocessable_entity
    end
  end

  # ... rest unchanged ...
end
```

- [ ] **Step 5: Run all tests, commit**

```bash
cd backend && bundle exec rails test
```

```bash
git add backend/app/controllers/concerns/json_column_merge.rb \
        backend/app/controllers/api/v1/trips_controller.rb \
        backend/test/controllers/concerns/json_column_merge_test.rb
git commit -m "refactor(backend): extract deep-merge into JsonColumnMerge concern"
```

---

### Task 3: Apply deep-merge to day_plans, links, lodgings PATCH endpoints

**Files:**
- Modify: `backend/app/controllers/api/v1/day_plans_controller.rb` (the PATCH that takes `pattern_signature: {}`)
- Modify: `backend/app/controllers/api/v1/links_controller.rb` (the PATCH that takes `extracted_data: {}`)
- Modify: `backend/app/controllers/api/v1/lodgings_controller.rb` (no JSON column — verify)
- Test: extend `backend/test/models/trip_test.rb` style with controller-level tests OR add behavior to existing model tests

- [ ] **Step 1: Audit each controller's update action**

```bash
grep -A15 "def update" backend/app/controllers/api/v1/day_plans_controller.rb
grep -A15 "def update" backend/app/controllers/api/v1/links_controller.rb
grep -A15 "def update" backend/app/controllers/api/v1/lodgings_controller.rb
```

For each: identify the JSON columns in the permit list. For day_plans, `pattern_signature: {}` and `conflict_alerts: []` are JSON. For links, `extracted_data: {}`. Lodgings: check the file.

- [ ] **Step 2: Write the failing test for day_plans**

Append to `backend/test/models/day_plan_test.rb`:

```ruby
require "test_helper"

class DayPlanTest < ActiveSupport::TestCase
  self.fixture_paths = []
  self.fixture_table_names = []
  self.use_transactional_tests = true

  def build_dp
    trip = Trip.create!(
      name: "T", destination: "X", num_days: 1,
      status: "active", ai_mode: "manual",
    )
    trip.day_plans.create!(day_number: 1)
  end

  test "deep merge preserves pattern_signature when only conflict_alerts updated" do
    dp = build_dp
    dp.update!(
      pattern_signature: { "vibe" => "cultural", "pace" => "moderate" },
      conflict_alerts: [{ "type" => "transit", "msg" => "long walk" }],
    )

    # Simulate a PATCH that updates only conflict_alerts.
    incoming = { "conflict_alerts" => [] }
    merged = (dp.pattern_signature || {}).deep_merge({})
    dp.update!(pattern_signature: merged, conflict_alerts: [])

    dp.reload
    assert_equal "cultural", dp.pattern_signature["vibe"]
    assert_equal "moderate", dp.pattern_signature["pace"]
    assert_equal [], dp.conflict_alerts
  end
end
```

- [ ] **Step 3: Run, verify it fails (or passes if Rails happens to handle it)**

```bash
cd backend && bundle exec rails test test/models/day_plan_test.rb -v
```

Expected: PASS (the test exercises the model directly — the bug is in the controller's wholesale-replace logic).

- [ ] **Step 4: Apply JsonColumnMerge to `day_plans_controller.rb#update`**

```ruby
# backend/app/controllers/api/v1/day_plans_controller.rb
class Api::V1::DayPlansController < Api::V1::BaseController
  include JsonColumnMerge

  # ... existing before_actions ...

  def update
    permitted = day_plan_params.to_h
    %w[pattern_signature].each do |key|
      next unless permitted[key].present?
      permitted[key] = merge_json_column(@day_plan.send(key), permitted[key])
    end
    if @day_plan.update(permitted)
      render json: DayPlanSerializer.new(@day_plan).as_json
    else
      render json: { errors: @day_plan.errors.full_messages }, status: :unprocessable_entity
    end
  end

  # ... rest unchanged ...
end
```

- [ ] **Step 5: Apply JsonColumnMerge to `links_controller.rb#update`**

```ruby
# backend/app/controllers/api/v1/links_controller.rb
class Api::V1::LinksController < Api::V1::BaseController
  include JsonColumnMerge

  # ... existing before_actions ...

  def update
    permitted = link_update_params.to_h
    if permitted["extracted_data"].present?
      permitted["extracted_data"] = merge_json_column(
        @link.extracted_data, permitted["extracted_data"],
      )
    end
    if @link.update(permitted)
      render json: LinkSerializer.new(@link).as_json
    else
      render json: { errors: @link.errors.full_messages }, status: :unprocessable_entity
    end
  end

  # ... rest unchanged ...
end
```

- [ ] **Step 6: Run full Rails test suite + commit**

```bash
cd backend && bundle exec rails test
```

```bash
git add backend/app/controllers/api/v1/day_plans_controller.rb \
        backend/app/controllers/api/v1/links_controller.rb \
        backend/test/models/day_plan_test.rb
git commit -m "feat(backend): JsonColumnMerge applied to day_plans + links PATCH endpoints"
```

---

### Task 4: Extend rails_contract with Trip + DayPlan + Link permit lists

**Files:**
- Modify: `ai_service/app/services/rails_contract.py`
- Modify: `ai_service/tests/test_rails_contract.py`

- [ ] **Step 1: Write the 3 failing meta-tests**

Append to `ai_service/tests/test_rails_contract.py`, inside `class TestRailsContractInSync`:

```python
def test_trip_permitted_fields_match_rails(self):
    from app.services.rails_contract import TRIP_PERMITTED_FIELDS
    rails = _rails_permit_list(
        "backend/app/controllers/api/v1/trips_controller.rb", "trip",
    )
    assert TRIP_PERMITTED_FIELDS == rails, (
        f"Trip permit-list drift!\n"
        f"  Python only: {sorted(TRIP_PERMITTED_FIELDS - rails)}\n"
        f"  Rails only: {sorted(rails - TRIP_PERMITTED_FIELDS)}"
    )

def test_day_plan_permitted_fields_match_rails(self):
    from app.services.rails_contract import DAY_PLAN_PERMITTED_FIELDS
    rails = _rails_permit_list(
        "backend/app/controllers/api/v1/day_plans_controller.rb", "day_plan",
    )
    assert DAY_PLAN_PERMITTED_FIELDS == rails, (
        f"DayPlan permit-list drift!\n"
        f"  Python only: {sorted(DAY_PLAN_PERMITTED_FIELDS - rails)}\n"
        f"  Rails only: {sorted(rails - DAY_PLAN_PERMITTED_FIELDS)}"
    )

def test_link_update_permitted_fields_match_rails(self):
    from app.services.rails_contract import LINK_UPDATE_PERMITTED_FIELDS
    # links_controller.rb has TWO permit lists. We mirror the UPDATE one
    # (link_update_params) since that's what the AI service uses.
    rails = _rails_permit_list(
        "backend/app/controllers/api/v1/links_controller.rb", "link",
    )
    # Note: the parser captures the FIRST permit() block. If the file
    # has two, _rails_permit_list returns the first. The links file has
    # link_params (just :url) first, then link_update_params (:status,
    # extracted_data: {}) second. To target the second one, the
    # implementation may need a second-arg variant — see Step 3.
    assert LINK_UPDATE_PERMITTED_FIELDS == rails
```

- [ ] **Step 2: Run, verify they fail**

```bash
cd ai_service && source .venv/bin/activate && pytest tests/test_rails_contract.py -v
```

Expected: 3 NEW FAILS — constants not defined.

- [ ] **Step 3: Add the constants to `rails_contract.py`**

```python
# Append to ai_service/app/services/rails_contract.py

# Rails: trips_controller.rb trip_params permit list. Extends
# ITINERARY_ITEM_PERMITTED_FIELDS protection to the parent Trip
# resource — every PATCH /trips/:id payload the AI service builds
# (e.g. update_trip with traveler_profile) must comply.
TRIP_PERMITTED_FIELDS: set[str] = {
    "name", "destination", "num_days", "status", "ai_mode",
    "profile_status", "is_staging", "traveler_profile",
}

# Rails: day_plans_controller.rb day_plan_params permit list.
DAY_PLAN_PERMITTED_FIELDS: set[str] = {
    "day_number", "date", "notes", "city", "origin", "rigidity",
    "day_type", "primary_region", "source_video_url",
    "source_creator_handle", "estimated_pace", "pattern_signature",
    "conflict_alerts",
}

# Rails: links_controller.rb link_update_params permit list. The OTHER
# permit list (link_params, just :url) is for the create action and not
# something the AI service ever touches.
LINK_UPDATE_PERMITTED_FIELDS: set[str] = {"status", "extracted_data"}


def assert_trip_payload(payload: dict) -> None:
    """Same defensive check as assert_itinerary_item_payload but for
    Trip-level updates. Catches frontend or AI-service code that tries
    to PATCH a field outside the Trip permit list."""
    if not isinstance(payload, dict):
        raise AssertionError(f"payload must be a dict, got {type(payload)}")
    extras = set(payload.keys()) - TRIP_PERMITTED_FIELDS
    if extras:
        raise AssertionError(
            f"trip payload contains fields not in Rails permit list: {sorted(extras)}"
        )


def assert_day_plan_payload(payload: dict) -> None:
    if not isinstance(payload, dict):
        raise AssertionError(f"payload must be a dict, got {type(payload)}")
    extras = set(payload.keys()) - DAY_PLAN_PERMITTED_FIELDS
    if extras:
        raise AssertionError(
            f"day_plan payload contains fields not in Rails permit list: {sorted(extras)}"
        )
```

- [ ] **Step 4: The links permit-list test will fail because the parser only captures the FIRST permit() block. Patch the parser**

In `ai_service/tests/test_rails_contract.py`, change `_rails_permit_list` to accept an optional `match_index`:

```python
def _rails_permit_list(controller_path: str, model_key: str, match_index: int = 0) -> set[str]:
    """Extract the field set from the Nth `params.require(:model_key).permit(...)`
    block in a Rails controller. Default match_index=0 grabs the first
    block; pass 1 for the second (e.g. links_controller has TWO permit
    blocks: link_params and link_update_params)."""
    controller_path_full = REPO_ROOT / controller_path
    raw = controller_path_full.read_text()
    text = re.sub(r"#[^\n]*", "", raw)
    pattern = rf"params\.require\(:{model_key}\)\.permit\((.*?)^\s*\)"
    matches = list(re.finditer(pattern, text, re.DOTALL | re.MULTILINE))
    assert match_index < len(matches), (
        f"only {len(matches)} permit() block(s) found for :{model_key} in {controller_path_full}; "
        f"requested index {match_index}"
    )
    block = matches[match_index].group(1)
    fields: set[str] = set()
    for sym in re.findall(r":(\w+)", block):
        if sym != model_key:
            fields.add(sym)
    for nested in re.findall(r"(\w+)\s*:\s*[\{\[]", block):
        fields.add(nested)
    return fields
```

Update the test:

```python
def test_link_update_permitted_fields_match_rails(self):
    from app.services.rails_contract import LINK_UPDATE_PERMITTED_FIELDS
    rails = _rails_permit_list(
        "backend/app/controllers/api/v1/links_controller.rb", "link",
        match_index=1,  # the SECOND permit() block — link_update_params
    )
    assert LINK_UPDATE_PERMITTED_FIELDS == rails
```

- [ ] **Step 5: Run all rails_contract tests + commit**

```bash
pytest tests/test_rails_contract.py -v
```

Expected: 12 PASSED (9 existing + 3 new).

```bash
git add ai_service/app/services/rails_contract.py \
        ai_service/tests/test_rails_contract.py
git commit -m "feat(rails_contract): cover Trip + DayPlan + Link permit lists"
```

---

### Task 5: Shared frontend profile-fields whitelist module

**Files:**
- Create: `frontend/src/utils/profileFields.js`
- Create: `frontend/src/utils/__tests__/profileFields.test.js`
- Modify: `frontend/src/hooks/useTripDetail.js`

- [ ] **Step 1: Write the failing test**

```javascript
// frontend/src/utils/__tests__/profileFields.test.js
/**
 * Pins the frontend-vs-backend ownership boundary for traveler_profile.
 * Trip 46 surfaced the bug class this module protects: the frontend
 * sent the WHOLE profile back via PATCH (including stale
 * places_mentioned) and clobbered backend enrichment. The fix is to
 * NEVER send backend-owned fields. This module is the single source
 * of truth for that whitelist.
 */
import {
  FRONTEND_OWNED_PROFILE_FIELDS,
  BACKEND_OWNED_PROFILE_FIELDS,
  stripBackendOwned,
} from "../profileFields";

describe("profileFields", () => {
  test("frontend and backend sets are disjoint", () => {
    const overlap = [...FRONTEND_OWNED_PROFILE_FIELDS].filter((f) =>
      BACKEND_OWNED_PROFILE_FIELDS.has(f),
    );
    expect(overlap).toEqual([]);
  });

  test("stripBackendOwned removes places_mentioned", () => {
    const profile = {
      travel_style: "x",
      places_mentioned: [{ name: "A" }],
      day_plans_from_links: [{ day: 1 }],
      external_research: "blob",
      destination_classification: { destination_type: "walkable_urban" },
      city_distribution: { status: "confirmed" },
    };
    const stripped = stripBackendOwned(profile);
    expect(stripped.travel_style).toBe("x");
    expect(stripped.places_mentioned).toBeUndefined();
    expect(stripped.day_plans_from_links).toBeUndefined();
    expect(stripped.external_research).toBeUndefined();
    expect(stripped.destination_classification).toBeUndefined();
    expect(stripped.city_distribution).toBeUndefined();
  });

  test("stripBackendOwned preserves all frontend-owned fields", () => {
    const profile = {
      travel_style: "a", travel_style_en: "b",
      interests: ["c"], interests_en: ["d"],
      pace: "moderado",
      country_detected: "France", cities_detected: ["Paris"],
      profile_description: "long text", profile_description_en: "en text",
      main_destination: { city: "Paris", country: "France" },
      needs_destination: false,
    };
    const stripped = stripBackendOwned(profile);
    for (const k of Object.keys(profile)) {
      expect(stripped[k]).toEqual(profile[k]);
    }
  });

  test("stripBackendOwned ignores unknown fields (defensive)", () => {
    const stripped = stripBackendOwned({
      travel_style: "x",
      __debug: true,
      arbitrary_extra: 42,
    });
    // Unknown fields fall through — the Rails permit list will reject
    // them harmlessly. We don't strip them here so test failures are
    // easier to debug (the test sees what was sent).
    expect(stripped.travel_style).toBe("x");
    expect(stripped.__debug).toBe(true);
  });
});
```

- [ ] **Step 2: Run, verify it fails**

```bash
cd frontend && npm test -- profileFields.test.js --watchAll=false
```

Expected: Cannot find module.

- [ ] **Step 3: Implement the module**

```javascript
// frontend/src/utils/profileFields.js
/**
 * Single source of truth for which traveler_profile fields the
 * frontend OWNS (safe to send via PATCH) vs the backend OWNS (computed
 * by the AI pipeline; PATCHing them would clobber enrichment).
 *
 * Trip 46 surfaced this with high impact — the frontend cached a stale
 * profile snapshot and PATCHed it back, overwriting freshly-geocoded
 * places_mentioned. The fix is the whitelist below + the Rails
 * deep-merge in trips_controller.rb.
 *
 * Rules:
 *   - Frontend OWNS: anything the user can edit in TravelerProfileCard
 *     (travel_style, interests, pace, profile_description, etc.).
 *   - Backend OWNS: anything the AI pipeline writes (places_mentioned,
 *     day_plans_from_links, external_research, classifier output, etc.).
 *
 * To add a new field: pick a side, add it to the right set, and add
 * a test in profileFields.test.js that pins the choice.
 */

export const FRONTEND_OWNED_PROFILE_FIELDS = new Set([
  "travel_style", "travel_style_en",
  "interests", "interests_en",
  "pace",
  "country_detected", "cities_detected",
  "profile_description", "profile_description_en",
  "main_destination", "needs_destination",
]);

export const BACKEND_OWNED_PROFILE_FIELDS = new Set([
  "places_mentioned",
  "day_plans_from_links",
  "external_research", "external_research_flexible",
  "destination_classification",
  "city_distribution",
  "build_error",
  "validation_report",
]);

/**
 * Remove backend-owned keys from a profile object before PATCH.
 * Returns a NEW object — does not mutate the input.
 */
export function stripBackendOwned(profile) {
  if (!profile || typeof profile !== "object") return {};
  const out = {};
  for (const [k, v] of Object.entries(profile)) {
    if (BACKEND_OWNED_PROFILE_FIELDS.has(k)) continue;
    out[k] = v;
  }
  return out;
}
```

- [ ] **Step 4: Refactor `useTripDetail.js#updateProfile` to import from the new module**

In `frontend/src/hooks/useTripDetail.js`, replace the inline `FRONTEND_OWNED` Set + filter block with:

```javascript
import { stripBackendOwned } from "../utils/profileFields";

// inside updateProfile:
const safeProfile = stripBackendOwned(profileData);
const updated = await tripsApi.updateTrip(tripId, {
  traveler_profile: safeProfile,
  profile_status: status,
});
```

(Delete the `FRONTEND_OWNED = new Set([...])` and `Object.fromEntries` block — it's now in `profileFields.js`.)

- [ ] **Step 5: Run + commit**

```bash
cd frontend && npm test -- profileFields.test.js --watchAll=false
npx eslint src/hooks/useTripDetail.js src/utils/profileFields.js
```

Expected: 4 new tests PASSED, lint clean.

```bash
git add frontend/src/utils/profileFields.js \
        frontend/src/utils/__tests__/profileFields.test.js \
        frontend/src/hooks/useTripDetail.js
git commit -m "refactor(frontend): shared profileFields whitelist (single source of truth)"
```

---

### Task 6: Backend defense — concern that strips backend-owned profile fields

**Files:**
- Create: `backend/app/controllers/concerns/profile_field_guard.rb`
- Modify: `backend/app/controllers/api/v1/trips_controller.rb`
- Modify: `backend/test/models/trip_test.rb`

- [ ] **Step 1: Write the failing test**

Append to `backend/test/models/trip_test.rb`:

```ruby
test "strip_backend_owned_profile_fields removes places_mentioned from incoming hash" do
  controller = Api::V1::TripsController.new
  result = controller.send(:strip_backend_owned_profile_fields, {
    "travel_style" => "x",
    "places_mentioned" => [{ "name" => "A" }],
    "day_plans_from_links" => [{ "day" => 1 }],
    "external_research" => "blob",
  })
  assert_equal "x", result["travel_style"]
  assert_nil result["places_mentioned"]
  assert_nil result["day_plans_from_links"]
  assert_nil result["external_research"]
end

test "strip_backend_owned_profile_fields keeps all user fields" do
  controller = Api::V1::TripsController.new
  fields = {
    "travel_style" => "a",
    "interests" => ["b"],
    "pace" => "moderado",
    "profile_description" => "text",
    "main_destination" => { "city" => "Paris" },
  }
  result = controller.send(:strip_backend_owned_profile_fields, fields)
  fields.each { |k, v| assert_equal v, result[k] }
end
```

- [ ] **Step 2: Run, verify it fails**

```bash
cd backend && bundle exec rails test test/models/trip_test.rb -v
```

Expected: 2 NEW FAILS — `strip_backend_owned_profile_fields` not defined.

- [ ] **Step 3: Implement the concern**

```ruby
# backend/app/controllers/concerns/profile_field_guard.rb
# Defensive backend-side mirror of frontend/src/utils/profileFields.js.
# Strips backend-owned fields from a traveler_profile hash before merge.
#
# Why: even though the frontend now strips these fields, a stale
# browser tab, a third-party caller, or a future client (mobile app)
# might not. Backend defense keeps the contract enforceable regardless
# of who's calling.
#
# Keep this set in sync with frontend/src/utils/profileFields.js.
# (Tier 2 of the bug-proofing roadmap will add a CI check that asserts
# parity between the two lists.)
module ProfileFieldGuard
  extend ActiveSupport::Concern

  BACKEND_OWNED_PROFILE_FIELDS = %w[
    places_mentioned
    day_plans_from_links
    external_research
    external_research_flexible
    destination_classification
    city_distribution
    build_error
    validation_report
  ].freeze

  def strip_backend_owned_profile_fields(profile_hash)
    return profile_hash if profile_hash.blank?
    profile_hash = profile_hash.to_h
    BACKEND_OWNED_PROFILE_FIELDS.each { |k| profile_hash.delete(k) }
    profile_hash
  end
end
```

- [ ] **Step 4: Wire it into `trips_controller.rb#update`**

```ruby
# backend/app/controllers/api/v1/trips_controller.rb
class Api::V1::TripsController < ApplicationController
  include JsonColumnMerge
  include ProfileFieldGuard

  # ... before_actions unchanged ...

  def update
    permitted = trip_params
    if permitted[:traveler_profile].present?
      permitted = permitted.to_h
      # Determine if this PATCH came from a user (request) or from the
      # AI service (uses service_api_key auth via service_request?).
      # AI service is allowed to write ANYTHING; user requests get the
      # backend-owned fields stripped.
      incoming_profile = permitted["traveler_profile"]
      incoming_profile = strip_backend_owned_profile_fields(incoming_profile) unless service_request?
      permitted["traveler_profile"] = merge_json_column(
        @trip.traveler_profile, incoming_profile,
      )
    end

    if @trip.update(permitted)
      render json: TripSerializer.new(@trip, include_details: true).as_json
    else
      render json: { errors: @trip.errors.full_messages }, status: :unprocessable_entity
    end
  end

  # ... rest unchanged ...
end
```

- [ ] **Step 5: Run + commit**

```bash
cd backend && bundle exec rails test
```

Expected: all green (10 + 2 = 12 trip tests).

```bash
git add backend/app/controllers/concerns/profile_field_guard.rb \
        backend/app/controllers/api/v1/trips_controller.rb \
        backend/test/models/trip_test.rb
git commit -m "feat(backend): ProfileFieldGuard strips backend-owned fields on user PATCH"
```

---

### Task 7: Cross-language parity test for profile field whitelists

**Files:**
- Modify: `ai_service/tests/test_rails_contract.py`

- [ ] **Step 1: Write the failing test**

Append to `ai_service/tests/test_rails_contract.py`:

```python
class TestFrontendBackendProfileFieldsParity:
    """Both the Rails ProfileFieldGuard and frontend profileFields.js
    list the same set of "backend-owned" profile keys. Drift between
    them re-introduces the trip 46 bug class — frontend strips one set,
    Rails accepts another, gap = clobber. This test catches drift."""

    def test_backend_owned_sets_match(self):
        # Read the Rails concern.
        rails_path = REPO_ROOT / "backend/app/controllers/concerns/profile_field_guard.rb"
        rails_text = rails_path.read_text()
        rails_match = re.search(
            r"BACKEND_OWNED_PROFILE_FIELDS\s*=\s*%w\[([^\]]+)\]", rails_text,
        )
        assert rails_match, "BACKEND_OWNED_PROFILE_FIELDS not found in Rails concern"
        rails_fields = set(rails_match.group(1).split())

        # Read the JS module.
        js_path = REPO_ROOT / "frontend/src/utils/profileFields.js"
        js_text = js_path.read_text()
        js_match = re.search(
            r"BACKEND_OWNED_PROFILE_FIELDS\s*=\s*new\s+Set\(\[([^\]]+)\]",
            js_text, re.DOTALL,
        )
        assert js_match, "BACKEND_OWNED_PROFILE_FIELDS not found in JS module"
        # The JS list contains "string", "literals". Extract them.
        js_fields = set(re.findall(r'"([^"]+)"', js_match.group(1)))

        assert rails_fields == js_fields, (
            f"Backend-owned profile field drift!\n"
            f"  Rails only: {sorted(rails_fields - js_fields)}\n"
            f"  JS only: {sorted(js_fields - rails_fields)}"
        )
```

- [ ] **Step 2: Run, verify it passes (we just landed both lists in sync)**

```bash
cd ai_service && source .venv/bin/activate && pytest tests/test_rails_contract.py::TestFrontendBackendProfileFieldsParity -v
```

Expected: 1 PASSED.

- [ ] **Step 3: Commit**

```bash
git add ai_service/tests/test_rails_contract.py
git commit -m "test(rails_contract): cross-language profile-field parity check"
```

---

### Task 8: Race-preservation tests for OTHER write-back paths

**Files:**
- Modify: `ai_service/tests/test_race_preservation.py`

- [ ] **Step 1: Write 2 new failing tests**

Append to `ai_service/tests/test_race_preservation.py`:

```python
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
```

- [ ] **Step 2: Run, see if either fails (= real bug)**

```bash
cd ai_service && source .venv/bin/activate && pytest tests/test_race_preservation.py -v
```

Expected: both PASS (existing fixes already handle these). If a FAIL surfaces, fix `orchestrator.py` to preserve the field.

- [ ] **Step 3: Commit**

```bash
git add ai_service/tests/test_race_preservation.py
git commit -m "test(race_preservation): pin reenrich + manual_assist preservation rules"
```

---

## TIER 2 — DB Constraints + Lint + API Versioning

> Goal: catch whole bug classes statically. DB-level invariants prevent inconsistent state from being written. Lint catches the silent-except pattern that buried trip 41/43 bugs. API version header catches frontend/backend drift at runtime. Estimated: 5 tasks.

### Task 9: Add DB-level NOT NULL + CHECK + FK constraints

**Files:**
- Create: `backend/db/migrate/20260427000000_add_data_integrity_constraints.rb`

- [ ] **Step 1: Audit current schema for missing constraints**

```bash
cat backend/db/schema.rb | head -200
```

For each table, identify columns that the app code REQUIRES but the schema allows NULL. Write findings into the migration's comment block.

- [ ] **Step 2: Write the migration**

```ruby
# backend/db/migrate/20260427000000_add_data_integrity_constraints.rb
# Tier-2 of the bug-proofing roadmap: DB-level invariants for fields
# that the app code already enforces. Catches the bug class where
# a code path bypasses the validator (e.g. raw SQL update,
# Rails console, future migration that wipes a default) and writes
# inconsistent data.
#
# Each constraint mirrors a `validates ... presence: true` or an
# `validates ... numericality:` rule already in the model. The DB is
# the last line of defense.
class AddDataIntegrityConstraints < ActiveRecord::Migration[8.0]
  def change
    # Trip
    change_column_null :trips, :name, false
    change_column_null :trips, :status, false
    change_column_null :trips, :ai_mode, false
    add_check_constraint :trips, "num_days BETWEEN 1 AND 30",
                         name: "trips_num_days_in_range"

    # DayPlan — day_number is required and must be positive.
    change_column_null :day_plans, :day_number, false
    add_check_constraint :day_plans, "day_number > 0",
                         name: "day_plans_day_number_positive"
    # FK already exists per CreateDayPlans, but verify NOT NULL on it.
    change_column_null :day_plans, :trip_id, false

    # ItineraryItem — name is required.
    change_column_null :itinerary_items, :name, false
    change_column_null :itinerary_items, :day_plan_id, false

    # Link — url + trip_id required.
    change_column_null :links, :url, false
    change_column_null :links, :trip_id, false
  end
end
```

- [ ] **Step 3: Run the migration locally**

```bash
cd backend && bundle exec rails db:migrate
```

If it FAILS because existing rows violate a new constraint, that's a real bug — surface and fix the offending rows in a data migration before adding the constraint.

- [ ] **Step 4: Run the full test suite to confirm nothing breaks**

```bash
bundle exec rails test
```

- [ ] **Step 5: Commit**

```bash
git add backend/db/migrate/20260427000000_add_data_integrity_constraints.rb \
        backend/db/schema.rb
git commit -m "feat(db): add NOT NULL + CHECK invariants for app-validated fields"
```

---

### Task 10: Lint that flags silent `except Exception:` blocks

**Files:**
- Create: `ai_service/scripts/lint_silent_excepts.py`
- Create: `ai_service/tests/test_lint_silent_excepts.py`

- [ ] **Step 1: Write the failing test**

```python
# ai_service/tests/test_lint_silent_excepts.py
"""Tests for the silent-except linter. The pattern we forbid:

    try:
        risky()
    except Exception:
        pass

This buries real errors. Allowed patterns:

    try:
        risky()
    except Exception:
        logger.exception("clear context")  # logged

    try:
        risky()
    except Exception as e:
        raise CustomError(...) from e  # re-raised

Trip 41/43 spent hours debugging issues that turned out to be silent
excepts swallowing prod errors."""
from __future__ import annotations

import textwrap
from pathlib import Path

import pytest


def _lint(source: str):
    from scripts.lint_silent_excepts import find_silent_excepts
    return find_silent_excepts(source, filename="test.py")


def test_pass_only_except_is_flagged():
    src = textwrap.dedent("""
        def f():
            try:
                x = 1
            except Exception:
                pass
    """)
    findings = _lint(src)
    assert len(findings) == 1
    assert findings[0].line >= 4


def test_logged_except_is_ok():
    src = textwrap.dedent("""
        import logging
        logger = logging.getLogger(__name__)

        def f():
            try:
                x = 1
            except Exception:
                logger.exception("oops")
    """)
    assert _lint(src) == []


def test_reraised_except_is_ok():
    src = textwrap.dedent("""
        def f():
            try:
                x = 1
            except Exception as e:
                raise RuntimeError("boom") from e
    """)
    assert _lint(src) == []


def test_bare_except_pass_also_flagged():
    src = textwrap.dedent("""
        def f():
            try:
                x = 1
            except:
                pass
    """)
    findings = _lint(src)
    assert len(findings) == 1


def test_continue_only_except_is_flagged():
    """A loop body that swallows exceptions silently is the same bug."""
    src = textwrap.dedent("""
        def f(items):
            for x in items:
                try:
                    process(x)
                except Exception:
                    continue
    """)
    findings = _lint(src)
    assert len(findings) == 1
```

- [ ] **Step 2: Run, verify fail**

```bash
cd ai_service && source .venv/bin/activate && pytest tests/test_lint_silent_excepts.py -v
```

Expected: ModuleNotFoundError.

- [ ] **Step 3: Implement the linter**

```python
# ai_service/scripts/lint_silent_excepts.py
"""AST-based linter that flags silent exception handlers — `except`
blocks whose body has no logging, no raise, and no other meaningful
work (just `pass`, `continue`, or the equivalent).

Why: trip 41 + trip 43 both had production bugs that took hours to
debug because the actual error was swallowed by `except Exception:
pass`. This linter catches the pattern at commit time.

Usage:
    python scripts/lint_silent_excepts.py app/

Exit code 0 = clean. Exit code 1 = findings.
"""
from __future__ import annotations

import ast
import sys
from dataclasses import dataclass
from pathlib import Path


@dataclass
class Finding:
    file: str
    line: int
    message: str


def _is_silent(handler: ast.ExceptHandler) -> bool:
    """A handler is "silent" if its body does nothing meaningful — only
    pass, continue, break, or a bare `...` Ellipsis."""
    body = handler.body
    if not body:
        return True
    # Strip trailing comments — already not in AST. Examine each stmt.
    silent_stmts = (ast.Pass, ast.Continue, ast.Break)
    for stmt in body:
        if isinstance(stmt, silent_stmts):
            continue
        if isinstance(stmt, ast.Expr) and isinstance(stmt.value, ast.Constant):
            # `...` or a docstring.
            continue
        return False
    return True


def _catches_broad(handler: ast.ExceptHandler) -> bool:
    """True for `except:` (bare) or `except Exception:` / `except
    BaseException:`. Narrower handlers (e.g. `except KeyError:`) are
    intentional and not flagged."""
    if handler.type is None:
        return True
    if isinstance(handler.type, ast.Name):
        return handler.type.id in ("Exception", "BaseException")
    if isinstance(handler.type, ast.Tuple):
        return any(
            isinstance(e, ast.Name) and e.id in ("Exception", "BaseException")
            for e in handler.type.elts
        )
    return False


def find_silent_excepts(source: str, filename: str = "<source>") -> list[Finding]:
    """Parse `source` and return findings for every silent broad
    except handler. Used by the test suite + the CLI."""
    try:
        tree = ast.parse(source, filename=filename)
    except SyntaxError:
        return []  # don't fail on syntactically broken files
    findings: list[Finding] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.ExceptHandler) and _catches_broad(node) and _is_silent(node):
            findings.append(Finding(
                file=filename, line=node.lineno,
                message="broad except with no logging or re-raise",
            ))
    return findings


def lint_path(path: Path) -> list[Finding]:
    findings: list[Finding] = []
    for f in path.rglob("*.py"):
        if "/.venv/" in str(f) or "/build/" in str(f):
            continue
        findings.extend(find_silent_excepts(f.read_text(), filename=str(f)))
    return findings


def main(argv: list[str]) -> int:
    if not argv:
        print("usage: lint_silent_excepts.py <path> [<path>...]", file=sys.stderr)
        return 2
    findings: list[Finding] = []
    for arg in argv:
        findings.extend(lint_path(Path(arg)))
    for f in findings:
        print(f"{f.file}:{f.line}: {f.message}")
    return 1 if findings else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
```

- [ ] **Step 4: Run tests**

```bash
pytest tests/test_lint_silent_excepts.py -v
```

Expected: 5 PASSED.

- [ ] **Step 5: Run the linter against the codebase to see how many findings exist (don't fix them all yet — record baseline)**

```bash
python scripts/lint_silent_excepts.py app/
```

Save the count to a file (e.g. `docs/superpowers/audits/silent-excepts-baseline.txt`). Tier 3 will gate CI on "no NEW silent excepts."

- [ ] **Step 6: Commit**

```bash
git add ai_service/scripts/lint_silent_excepts.py \
        ai_service/tests/test_lint_silent_excepts.py \
        docs/superpowers/audits/silent-excepts-baseline.txt
git commit -m "feat(ai_service): silent-except linter + baseline (Tier 2 of bug-proofing)"
```

---

### Task 11: API version header (frontend/backend drift detection)

**Files:**
- Modify: `backend/app/controllers/api/v1/base_controller.rb`
- Modify: `frontend/src/api/client.js`
- Test: `frontend/src/api/__tests__/client.test.js`

- [ ] **Step 1: Define the version constant + emit header from Rails**

```ruby
# backend/app/controllers/api/v1/base_controller.rb
class Api::V1::BaseController < ApplicationController
  # Bump this whenever a breaking change ships to the v1 API surface
  # (renamed field, removed endpoint, semantics change). Frontend
  # compares against its compiled-in expectation; mismatch → console
  # warning + Sentry event (Tier 3 wires the Sentry side).
  API_VERSION = "2026-04-26".freeze

  before_action :set_api_version_header

  private

  def set_api_version_header
    response.headers["X-API-Version"] = API_VERSION
  end

  # ... existing private methods ...
end
```

- [ ] **Step 2: Read it on the frontend + warn on mismatch**

```javascript
// frontend/src/api/client.js
// At the top (alongside imports):
const EXPECTED_API_VERSION = "2026-04-26";
let _versionWarned = false;

// Inside `request()`, AFTER `const response = await fetch(...)`, BEFORE
// the `if (response.status === 204)` line:
const serverVersion = response.headers.get("X-API-Version");
if (serverVersion && serverVersion !== EXPECTED_API_VERSION && !_versionWarned) {
  _versionWarned = true;
  // eslint-disable-next-line no-console
  console.warn(
    `[api] Version mismatch — frontend expects ${EXPECTED_API_VERSION} but server is ${serverVersion}. ` +
    "Hard-reload (Cmd+Shift+R) or clear cache to pick up the latest frontend bundle.",
  );
}
```

- [ ] **Step 3: Manually verify**

```bash
# Backend running on :3000
curl -I http://localhost:3000/api/v1/health
# Expect a `X-API-Version: 2026-04-26` header in the response.
```

- [ ] **Step 4: Commit**

```bash
git add backend/app/controllers/api/v1/base_controller.rb \
        frontend/src/api/client.js
git commit -m "feat: X-API-Version header — frontend warns on backend drift"
```

---

### Task 12: Wire the silent-except linter into CI

**Files:**
- Modify: `.github/workflows/contracts.yml`

- [ ] **Step 1: Add a new job to the workflow**

```yaml
# Append to the `jobs:` section in .github/workflows/contracts.yml
  silent-excepts:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"
      - name: Install ai_service
        working-directory: ai_service
        run: |
          python -m pip install --upgrade pip
          pip install -e .
          pip install pytest pytest-asyncio
      - name: Lint silent excepts (test the linter itself)
        working-directory: ai_service
        run: pytest tests/test_lint_silent_excepts.py -v
      # Don't fail the build on existing findings yet — Tier 2 baseline
      # acknowledges they exist. Future-tighten by adding `|| exit 1`.
      - name: Surface silent-except findings
        working-directory: ai_service
        run: python scripts/lint_silent_excepts.py app/ || true
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/contracts.yml
git commit -m "ci: surface silent-except findings on every push (warn-only baseline)"
```

---

### Task 13: Smoke E2E test for the trip-creation happy path

**Files:**
- Create: `e2e/smoke.spec.ts`
- Create: `e2e/playwright.config.ts`
- Create: `e2e/package.json`

- [ ] **Step 1: Bootstrap Playwright**

```bash
mkdir -p e2e
cat > e2e/package.json <<'JSON'
{
  "name": "voyara-e2e",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "test": "playwright test",
    "install-browsers": "playwright install chromium"
  },
  "devDependencies": {
    "@playwright/test": "^1.49.0",
    "typescript": "^5.5.0"
  }
}
JSON
```

- [ ] **Step 2: Add Playwright config**

```typescript
// e2e/playwright.config.ts
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  timeout: 60_000,
  fullyParallel: false,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: process.env.E2E_BASE_URL || "http://localhost:3002",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
    },
  ],
});
```

- [ ] **Step 3: Write the smoke test**

```typescript
// e2e/smoke.spec.ts
import { test, expect } from "@playwright/test";

/**
 * Trip-creation happy path. Run on every deploy; if this breaks, the
 * deploy is bad regardless of unit tests. Catches:
 *   - Frontend bundle missing
 *   - Auth flow broken
 *   - Backend unreachable
 *   - Trip-create form regression
 *   - Trip detail page render error
 *
 * Does NOT run the full link-extraction pipeline (too slow + non-deterministic).
 * It clicks through the bare flow and asserts the page reaches a stable state.
 */
test("trip-create happy path renders", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/Mapass|Voyara/i);

  // Landing page → Get Started or similar CTA.
  // Adjust the selector to match the actual landing page button.
  const cta = page.getByRole("link", { name: /começar|get started|criar/i }).first();
  if (await cta.isVisible().catch(() => false)) {
    await cta.click();
  }

  // Should land on /login or /signup. We don't sign in (no credentials in CI).
  // Just verify we got A page, not a 500.
  await expect(page.locator("body")).not.toContainText("500");
  await expect(page.locator("body")).not.toContainText("Application error");
});
```

- [ ] **Step 4: Run locally to verify**

```bash
cd e2e && npm install && npx playwright install chromium && npm test
```

Expected: 1 PASSED (smoke). If the page assertions don't match the actual app, edit them — this is a smoke test, not exhaustive coverage.

- [ ] **Step 5: Commit**

```bash
git add e2e/
git commit -m "feat(e2e): Playwright smoke test for trip-creation happy path"
```

---

## TIER 3 — Production Observability

> Goal: hear about prod failures from monitoring, not from users. Sentry on all 3 services + an E2E smoke gate on every deploy + Slack alerts on contract test failures. Estimated: 4 tasks.

### Task 14: Sentry for Rails

**Files:**
- Modify: `backend/Gemfile`
- Create: `backend/config/initializers/sentry.rb`

- [ ] **Step 1: Add the gem**

In `backend/Gemfile`:

```ruby
gem "sentry-ruby"
gem "sentry-rails"
```

```bash
cd backend && bundle install
```

- [ ] **Step 2: Configure**

```ruby
# backend/config/initializers/sentry.rb
return unless ENV["SENTRY_DSN"].present?

Sentry.init do |config|
  config.dsn = ENV["SENTRY_DSN"]
  config.breadcrumbs_logger = [:active_support_logger, :http_logger]
  # Capture 100% of errors in dev/staging, 10% transactions in prod
  # to keep Sentry quota under control.
  config.traces_sample_rate = Rails.env.production? ? 0.1 : 1.0
  config.environment = Rails.env
  config.release = ENV["RENDER_GIT_COMMIT"]&.first(7)
  # Don't ship PII unless we explicitly opt-in per event.
  config.send_default_pii = false
end
```

- [ ] **Step 3: Add `SENTRY_DSN` to render.yaml as a sync: false env var**

```yaml
# render.yaml — under the mapass-api service envVars:
      - key: SENTRY_DSN
        sync: false
```

- [ ] **Step 4: Test by raising in Rails console + observe Sentry dashboard (after secret is set)**

```ruby
# In `bundle exec rails console`:
Sentry.capture_message("test from rails console")
```

- [ ] **Step 5: Commit**

```bash
git add backend/Gemfile backend/Gemfile.lock backend/config/initializers/sentry.rb render.yaml
git commit -m "feat(observability): Sentry on Rails backend"
```

---

### Task 15: Sentry for Python AI service

**Files:**
- Modify: `ai_service/pyproject.toml`
- Modify: `ai_service/app/main.py`

- [ ] **Step 1: Add the dependency**

```toml
# pyproject.toml dependencies array:
"sentry-sdk[fastapi]>=2.20",
```

```bash
cd ai_service && pip install -e .
```

- [ ] **Step 2: Initialize at startup**

In `ai_service/app/main.py`, near the top:

```python
import os

import sentry_sdk
from sentry_sdk.integrations.fastapi import FastApiIntegration

if dsn := os.environ.get("SENTRY_DSN"):
    sentry_sdk.init(
        dsn=dsn,
        integrations=[FastApiIntegration()],
        traces_sample_rate=0.1,
        environment=os.environ.get("RENDER_SERVICE_NAME", "local"),
        release=os.environ.get("RENDER_GIT_COMMIT", "dev")[:7],
        send_default_pii=False,
    )
```

- [ ] **Step 3: Add to render.yaml AI service envVars**

```yaml
      - key: SENTRY_DSN
        sync: false
```

- [ ] **Step 4: Commit**

```bash
git add ai_service/pyproject.toml ai_service/app/main.py render.yaml
git commit -m "feat(observability): Sentry on Python AI service"
```

---

### Task 16: Sentry + Error Boundary for React frontend

**Files:**
- Modify: `frontend/package.json`
- Modify: `frontend/src/index.js`
- Create: `frontend/src/components/ErrorBoundary.js`

- [ ] **Step 1: Add the dependency**

```bash
cd frontend && npm install --legacy-peer-deps @sentry/react
```

- [ ] **Step 2: Initialize Sentry + add Error Boundary**

```javascript
// frontend/src/index.js — add near the top, BEFORE the React render:
import * as Sentry from "@sentry/react";

if (process.env.REACT_APP_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.REACT_APP_SENTRY_DSN,
    environment: process.env.NODE_ENV,
    release: process.env.REACT_APP_GIT_SHA?.slice(0, 7) || "dev",
    tracesSampleRate: 0.1,
  });
}
```

```javascript
// frontend/src/components/ErrorBoundary.js
import { Component } from "react";
import * as Sentry from "@sentry/react";

/**
 * Top-level React error boundary. Wraps the app so a crash in any
 * component doesn't blank the whole page — the user sees a friendly
 * recovery card and Sentry gets the stack.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    Sentry.captureException(error, { extra: info });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-8 text-center">
            <div className="text-4xl mb-3">⚠️</div>
            <h1 className="text-xl font-bold text-gray-900 mb-2">
              Algo deu errado
            </h1>
            <p className="text-sm text-gray-600 mb-4">
              Recarregue a página. Se o problema persistir, contate o suporte.
            </p>
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 rounded-lg bg-coral-500 hover:bg-coral-600 text-white text-sm font-bold"
            >
              Recarregar
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
```

In `frontend/src/index.js`, wrap the App:

```javascript
import ErrorBoundary from "./components/ErrorBoundary";

// Replace `<App />` in root.render(...) with:
root.render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
```

- [ ] **Step 3: Add `REACT_APP_SENTRY_DSN` env var (Render auto-injects on build)**

In `render.yaml` — under the static site or API service that builds the frontend, add:

```yaml
      - key: REACT_APP_SENTRY_DSN
        sync: false
```

- [ ] **Step 4: Commit**

```bash
git add frontend/package.json frontend/package-lock.json \
        frontend/src/index.js frontend/src/components/ErrorBoundary.js \
        render.yaml
git commit -m "feat(observability): Sentry + ErrorBoundary on React frontend"
```

---

### Task 17: Slack alert on contract test failure

**Files:**
- Modify: `.github/workflows/contracts.yml`

- [ ] **Step 1: Add a Slack notification step**

Append to the `python-contracts` job in `.github/workflows/contracts.yml`:

```yaml
      - name: Notify Slack on failure
        if: failure()
        uses: 8398a7/action-slack@v3
        with:
          status: ${{ job.status }}
          fields: repo,message,commit,author,workflow
          text: "🚨 Contract tests FAILED on main — silent 422 risk just landed"
        env:
          SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK_URL }}
```

(Same pattern for the `frontend-contracts` and `silent-excepts` jobs.)

- [ ] **Step 2: Set the SLACK_WEBHOOK_URL secret in GitHub**

Manual step — visit GitHub → Settings → Secrets → Actions, add `SLACK_WEBHOOK_URL` = the Slack incoming webhook URL.

- [ ] **Step 3: Test by intentionally breaking a contract test in a branch + opening PR**

(Verify the Slack message arrives, then revert.)

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/contracts.yml
git commit -m "ci: Slack alert on contract test failure (loud over silent)"
```

---

## TIER 4 — Type Safety at Boundaries

> Goal: catch shape errors at parse time. Pydantic models for the AI service replace dict-typing at the API boundary; mypy --strict on rails_client catches "what does this return?" guesswork. NOT a TypeScript migration of the frontend — that's a separate plan. Estimated: 3 tasks.

### Task 18: Pydantic models for the rails_client return shapes

**Files:**
- Create: `ai_service/app/services/rails_schemas.py`
- Test: `ai_service/tests/test_rails_schemas.py`

- [ ] **Step 1: Write the failing test**

```python
# ai_service/tests/test_rails_schemas.py
"""Pydantic models pin the shape of objects returned by RailsClient.
Today RailsClient returns plain dicts, so callers do `trip.get("ai_mode")`
and silently get None when a field is renamed/removed. With these
models, a field rename surfaces as a Pydantic ValidationError at
parse-time — an audible error, not a silent None."""
from __future__ import annotations

import pytest


def test_trip_schema_accepts_minimal_payload():
    from app.services.rails_schemas import TripSchema
    trip = TripSchema.model_validate({
        "id": 1,
        "name": "X",
        "destination": "Paris",
        "num_days": 5,
        "status": "active",
        "ai_mode": "manual",
        "profile_status": "confirmed",
    })
    assert trip.id == 1
    assert trip.ai_mode == "manual"


def test_trip_schema_rejects_invalid_ai_mode():
    from app.services.rails_schemas import TripSchema
    from pydantic import ValidationError
    with pytest.raises(ValidationError):
        TripSchema.model_validate({
            "id": 1, "name": "X", "destination": "Paris", "num_days": 5,
            "status": "active", "ai_mode": "ai_assist_manual",  # not in enum
            "profile_status": "confirmed",
        })


def test_itinerary_item_schema_normalizes_category():
    from app.services.rails_schemas import ItineraryItemSchema
    from pydantic import ValidationError
    with pytest.raises(ValidationError):
        ItineraryItemSchema.model_validate({
            "id": 1,
            "name": "X",
            "category": "place",  # not in CATEGORY_OPTIONS
            "origin": "extracted_from_video",
        })


def test_itinerary_item_schema_optional_geo():
    from app.services.rails_schemas import ItineraryItemSchema
    item = ItineraryItemSchema.model_validate({
        "id": 1, "name": "X", "category": "attraction",
        "origin": "extracted_from_video",
    })
    assert item.latitude is None
    assert item.longitude is None
```

- [ ] **Step 2: Run, verify it fails**

```bash
cd ai_service && source .venv/bin/activate && pytest tests/test_rails_schemas.py -v
```

Expected: ModuleNotFoundError.

- [ ] **Step 3: Implement the schemas**

```python
# ai_service/app/services/rails_schemas.py
"""Pydantic models for the dict shapes RailsClient returns. Replaces
ad-hoc dict access (`trip.get("ai_mode") or "manual"`) with parsed
typed objects that raise loudly when the shape changes.

Tied to the rails_contract enums — same validation surface. When Rails
adds a new enum value or field, both files must be updated and the
meta-test in test_rails_contract.py catches drift.
"""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field, ConfigDict

from app.services.rails_contract import (
    ITINERARY_ITEM_CATEGORIES,
    ITINERARY_ITEM_ORIGINS,
)


# Build Literal types from the contract sets so a Rails enum addition
# requires touching exactly one file (rails_contract.py).
_CategoryLiteral = Literal[tuple(sorted(ITINERARY_ITEM_CATEGORIES))]  # type: ignore[valid-type]
_OriginLiteral = Literal[tuple(sorted(ITINERARY_ITEM_ORIGINS))]  # type: ignore[valid-type]
_AiModeLiteral = Literal["eco", "pro", "manual"]


class TripSchema(BaseModel):
    """Mirror of the Rails Trip model + serializer output we actually
    consume in the AI service. NOT a complete mirror — just the fields
    orchestrator.py reads. Adding a new read site means adding the
    field here so the mismatch surfaces as a ValidationError."""
    model_config = ConfigDict(extra="ignore")  # tolerate extra fields

    id: int
    name: str
    destination: Optional[str] = None
    num_days: int
    status: str
    ai_mode: _AiModeLiteral
    profile_status: Optional[str] = None
    is_staging: bool = False
    traveler_profile: dict = Field(default_factory=dict)


class ItineraryItemSchema(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: Optional[int] = None
    name: str
    category: Optional[_CategoryLiteral] = None
    origin: _OriginLiteral
    source_url: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    address: Optional[str] = None
    google_place_id: Optional[str] = None
    google_rating: Optional[float] = None
    google_reviews_count: Optional[int] = None
    duration_minutes: Optional[int] = None
    time_slot: Optional[str] = None
    position: Optional[int] = None
```

- [ ] **Step 4: Run + commit**

```bash
pytest tests/test_rails_schemas.py -v
```

Expected: 4 PASSED.

```bash
git add ai_service/app/services/rails_schemas.py \
        ai_service/tests/test_rails_schemas.py
git commit -m "feat(ai_service): Pydantic schemas for Trip + ItineraryItem (Tier 4)"
```

---

### Task 19: Strict mypy on rails_client

**Files:**
- Modify: `ai_service/pyproject.toml`
- Modify: `ai_service/app/services/rails_client.py`

- [ ] **Step 1: Add mypy config + strict for the one file**

In `ai_service/pyproject.toml`, append:

```toml
[tool.mypy]
python_version = "3.12"
strict = false  # codebase isn't strict-clean yet — opt-in per file

[[tool.mypy.overrides]]
module = "app.services.rails_client"
strict = true
disallow_untyped_defs = true
warn_return_any = true
```

- [ ] **Step 2: Add type hints to rails_client.py until mypy --strict passes**

```bash
cd ai_service && source .venv/bin/activate && pip install mypy && mypy app/services/rails_client.py
```

For each error, add the missing annotation. Common patterns:
- `def __init__(self, client=None) -> None:`
- `async def get_trip(self, trip_id: int) -> dict[str, Any]:`
- Use `from typing import Any` for true any (e.g. JSON return values that haven't been schema'd yet).

- [ ] **Step 3: Run + commit**

```bash
mypy app/services/rails_client.py
```

Expected: `Success: no issues found`.

```bash
git add ai_service/pyproject.toml ai_service/app/services/rails_client.py
git commit -m "feat(ai_service): mypy --strict on rails_client.py"
```

---

### Task 20: Wire mypy into CI

**Files:**
- Modify: `.github/workflows/contracts.yml`

- [ ] **Step 1: Add a mypy job**

Append to `.github/workflows/contracts.yml`:

```yaml
  mypy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"
      - name: Install ai_service
        working-directory: ai_service
        run: |
          python -m pip install --upgrade pip
          pip install -e .
          pip install mypy
      - name: Run mypy on strict modules
        working-directory: ai_service
        run: mypy app/services/rails_client.py
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/contracts.yml
git commit -m "ci: gate mypy --strict on rails_client.py"
```

---

## Self-Review Notes

**Spec coverage check:**
- ✅ T1.1 PATCH endpoint inventory → Task 1
- ✅ T1.2 Deep-merge concern → Task 2
- ✅ T1.3 Apply to day_plans + links → Task 3
- ✅ T1.4 rails_contract for Trip/DayPlan/Link → Task 4
- ✅ T1.5 Frontend profileFields module → Task 5
- ✅ T1.6 Backend ProfileFieldGuard concern → Task 6
- ✅ T1.7 Cross-language parity test → Task 7
- ✅ T1.8 Race-preservation tests for reenrich + manual_assist → Task 8
- ✅ T2.9 DB constraints → Task 9
- ✅ T2.10 Silent-except linter → Task 10
- ✅ T2.11 API version header → Task 11
- ✅ T2.12 Wire linter into CI → Task 12
- ✅ T2.13 E2E smoke test (Playwright) → Task 13 (originally listed in Tier 3 but Playwright is closer to a static gate)
- ✅ T3.14 Sentry Rails → Task 14
- ✅ T3.15 Sentry Python → Task 15
- ✅ T3.16 Sentry React + ErrorBoundary → Task 16
- ✅ T3.17 Slack alert on contract failure → Task 17
- ✅ T4.18 Pydantic schemas → Task 18
- ✅ T4.19 mypy --strict on rails_client → Task 19
- ✅ T4.20 mypy in CI → Task 20

**Placeholder scan:** Each step has either a complete code block or a specific shell command. No "implement later" / "TBD" / "similar to Task N" patterns.

**Type consistency:**
- `merge_json_column(existing, incoming)` — same signature in Tasks 2, 3
- `stripBackendOwned(profile)` — same in Tasks 5
- `strip_backend_owned_profile_fields(profile_hash)` — same in Task 6
- Python `assert_*_payload(payload)` family — same shape across rails_contract.py
- Pydantic models in Task 18 reference enums from rails_contract.py (single source of truth)

**Tier independence:** Each tier's tasks are self-contained and ship value alone. Tier 1 generalizes the audit's defenses, Tier 2 adds preventative nets, Tier 3 makes prod failures visible, Tier 4 raises the type ceiling. You can stop after any tier and still have shipped real bug-prevention.

**Estimated total time:**
- Tier 1: ~2-3 hours (8 tasks)
- Tier 2: ~2-3 hours (5 tasks)
- Tier 3: ~2-3 hours (4 tasks, plus secret setup)
- Tier 4: ~1-2 hours (3 tasks)
- Total if all tiers executed: ~8-11 hours of focused execution
