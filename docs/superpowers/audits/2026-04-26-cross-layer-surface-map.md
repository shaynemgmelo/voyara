# Cross-Layer Surface Inventory — 2026-04-26

**Audit date:** 2026-04-26  
**Purpose:** Catalog permit lists, model enums, Python ↔ Rails callsites, AI endpoints, and frontend payloads to establish baseline contract tests.

**Context:** Recent trips (41/43/44) surfaced silent 422s and lost-geo bugs at the Python ↔ Rails permit-list boundary. This inventory is the foundation for Tasks 2–3 (contract tests + regression catchers).

---

## 1. Rails Permit Lists + Model Enums

### 1.1 ItineraryItemsController — Create/Update Permit List

**File:** `backend/app/controllers/api/v1/itinerary_items_controller.rb:192`

```ruby
params.require(:itinerary_item).permit(
  :name, :description, :category, :time_slot, :duration_minutes, :position,
  :latitude, :longitude, :address, :google_place_id, :google_rating,
  :google_reviews_count, :pricing_info, :phone, :website, :notes, :source_url,
  :personal_notes, :alternative_group, :source,
  :origin, :source_video_url, :source_video_creator, :extraction_method,
  :priority, :item_status, :best_turn, :region,
  :activity_model, :visit_mode,
  :item_role,
  operating_hours: {}, photos: [], vibe_tags: [], alerts: []
)
```

**Permit List for ItineraryItem (27 scalar fields + 4 complex fields):**

| Field Name | Type | Required? | Notes |
|---|---|---|---|
| name | string | yes | Validated presence=true |
| description | string | no | |
| category | string | no | Must be in CATEGORY_OPTIONS (see enum below) |
| time_slot | string | no | e.g. "manha", "tarde", "noite" |
| duration_minutes | integer | no | |
| position | integer | no | Auto-set to max(:position)+1 if omitted |
| latitude | float | no | |
| longitude | float | no | |
| address | string | no | |
| google_place_id | string | no | |
| google_rating | float | no | **Critical:** Rails expects `google_rating`, NOT `rating` |
| google_reviews_count | integer | no | **Critical:** Rails expects `google_reviews_count`, NOT `reviews_count` |
| pricing_info | string | no | |
| phone | string | no | |
| website | string | no | |
| notes | string | no | |
| source_url | string | no | |
| personal_notes | string | no | |
| alternative_group | string | no | |
| source | string | no | **Legacy:** kept for backward compat; use `origin` instead |
| origin | string | no | Must be in ORIGINS (see enum below) |
| source_video_url | string | no | |
| source_video_creator | string | no | |
| extraction_method | string | no | Must be in EXTRACTION_METHODS (see enum below) |
| priority | string | no | |
| item_status | string | no | Must be in ITEM_STATUSES (see enum below) |
| best_turn | string | no | Must be in BEST_TURNS (see enum below) |
| region | string | no | |
| activity_model | string | no | Must be in ACTIVITY_MODELS (see enum below) |
| visit_mode | string | no | Must be in VISIT_MODES (see enum below) |
| item_role | string | no | Must be in ITEM_ROLES (see enum below) |
| operating_hours | hash | no | Accepts any key-value pairs |
| photos | array | no | Array of strings (URLs) |
| vibe_tags | array | no | Array of strings |
| alerts | array | no | Array of strings |

---

### 1.2 TripsController — Create/Update Permit List

**File:** `backend/app/controllers/api/v1/trips_controller.rb:120`

```ruby
params.require(:trip).permit(:name, :destination, :num_days, :status, :ai_mode, :profile_status, :is_staging, traveler_profile: {})
```

**Permit List for Trip (8 scalar fields + 1 complex field):**

| Field Name | Type | Required? | Notes |
|---|---|---|---|
| name | string | yes | Validated presence=true |
| destination | string | no | |
| num_days | integer | yes | Validated: >0 and <=30 |
| status | string | no | Must be in STATUS_OPTIONS (see enum below) |
| ai_mode | string | no | Must be in AI_MODE_OPTIONS (see enum below) |
| profile_status | string | no | e.g. "pending", "confirmed" |
| is_staging | boolean | no | Test/staging flag |
| traveler_profile | hash | no | Accepts any key-value pairs (e.g. preferences, budget) |

---

### 1.3 Model Enums — ItineraryItem

**File:** `backend/app/models/itinerary_item.rb:2-33`

| Constant | Type | Values |
|---|---|---|
| CATEGORY_OPTIONS | enum | restaurant, attraction, hotel, transport, activity, shopping, cafe, nightlife, other |
| ORIGINS | enum | extracted_from_video, ai_suggested, user_added |
| ITEM_STATUSES | enum | fixed, suggested, editable |
| BEST_TURNS | enum | manha, tarde, noite, flexivel |
| EXTRACTION_METHODS | enum | caption, transcript, on_screen_ocr, manual |
| ACTIVITY_MODELS | enum | direct_place, anchored_experience, guided_excursion, route_cluster, day_trip, transfer |
| VISIT_MODES | enum | self_guided, guided, book_separately, operator_based |
| ITEM_ROLES | enum | landmark, attraction, neighborhood, museum_cultural, beach_island, viewpoint_nature, food_market, nightlife_venue, experience_activity, transport_leg, day_trip_destination |

---

### 1.4 Model Enums — DayPlan

**File:** `backend/app/models/day_plan.rb:5-8`

| Constant | Type | Values |
|---|---|---|
| ORIGINS | enum | from_video, ai_created, user_edited |
| RIGIDITIES | enum | locked, partially_flexible, flexible |
| DAY_TYPES | enum | urban, day_trip, transfer |
| PACES | enum | leve, moderado, acelerado |

---

### 1.5 DayPlansController — Create/Update Permit List

**File:** `backend/app/controllers/api/v1/day_plans_controller.rb:248`

```ruby
params.require(:day_plan).permit(
  :day_number, :date, :notes, :city,
  :origin, :rigidity, :day_type, :primary_region,
  :source_video_url, :source_creator_handle, :estimated_pace,
  pattern_signature: {},
  conflict_alerts: [[:type, :day, :message, :item_id, :severity, :created_at]]
)
```

**Permit List for DayPlan (11 scalar fields + 2 complex fields):**

| Field Name | Type | Required? | Notes |
|---|---|---|---|
| day_number | integer | no | |
| date | string | no | |
| notes | string | no | |
| city | string | no | |
| origin | string | no | Must be in ORIGINS (see enum below) |
| rigidity | string | no | Must be in RIGIDITIES (see enum below) |
| day_type | string | no | Must be in DAY_TYPES (see enum below) |
| primary_region | string | no | |
| source_video_url | string | no | |
| source_creator_handle | string | no | |
| estimated_pace | string | no | Must be in PACES (see enum below) |
| pattern_signature | hash | no | Accepts any key-value pairs |
| conflict_alerts | array of hashes | no | Each hash: type, day, message, item_id, severity, created_at |

---

### 1.6 LinksController — Create/Update Permit Lists

**File:** `backend/app/controllers/api/v1/links_controller.rb:54-59`

Two separate permit lists:

**1.6a — link_params (Create):**

```ruby
params.require(:link).permit(:url)
```

**Permit List for Link Create (1 scalar field):**

| Field Name | Type | Required? | Notes |
|---|---|---|---|
| url | string | yes | |

**1.6b — link_update_params (Update):**

```ruby
params.require(:link).permit(:status, extracted_data: {})
```

**Permit List for Link Update (1 scalar field + 1 complex field):**

| Field Name | Type | Required? | Notes |
|---|---|---|---|
| status | string | no | Must be in STATUS_OPTIONS (see enum below) |
| extracted_data | hash | no | Accepts any key-value pairs |

---

### 1.7 Model Enums — Trip

**File:** `backend/app/models/trip.rb:2-6`

| Constant | Type | Values |
|---|---|---|
| STATUS_OPTIONS | enum | draft, active, completed, archived |
| AI_MODE_OPTIONS | enum | eco, pro, manual |

---

### 1.8 Model Enums — Link

**File:** `backend/app/models/link.rb:2-3`

| Constant | Type | Values |
|---|---|---|
| PLATFORM_OPTIONS | enum | instagram, youtube, tiktok, blog, other |
| STATUS_OPTIONS | enum | pending, processing, extracted, processed, failed |

---

## 2. Python Functions That POST/PATCH Rails

**File:** `ai_service/app/services/orchestrator.py`

These are the mutation callsites where Python constructs payloads and sends them to Rails:

### 2.1 Summary Table

| Line | Function | Rails Method | Calls | Payload Shape Notes |
|---|---|---|---|---|
| 1891 | `extract_profile_and_build()` | `update_trip()` | 1x | `{"traveler_profile": dict}` |
| 2168 | `manual_assist_organize()` | `create_itinerary_item()` | 1+ | Via `_build_assist_item()` — see below |
| 2204 | `manual_assist_organize()` | `create_itinerary_item()` | 1+ | Via `_build_assist_item()` |
| 2343 | `manual_assist_organize()` | `update_day_plan()` | 1x | `{"city": str}` |
| 4106 | `build_trip_itinerary()` | `create_itinerary_item()` | 1+ | Via item dict |
| 6053 | `process_video_links()` | `update_link()` | 1x | `status="processing"` |
| 6067 | `process_video_links()` | `update_link()` | 1x | `status=?`, `extracted_data=?` |
| 6127 | `process_video_links()` | `update_link()` | 1x | `status="processing"` |
| 6138 | `process_video_links()` | `update_link()` | 1x | `status=?`, `extracted_data=?` |
| 6264 | `analyze_trip()` | `update_trip()` | 1x | `{"traveler_profile": dict}` |
| 6355 | `analyze_trip()` | `update_trip()` | 1x | `{"profile_status": "confirmed"}` |
| 6452 | `analyze_trip()` | `update_trip()` | 1+ | `{key: value, ...}` (multiple updates) |
| 6523 | `analyze_trip()` | `update_trip()` | 1x | `{"profile_status": ?}` |
| 6572 | `analyze_trip()` | `update_trip()` | 1x | Day summary + timing updates |
| 6807 | `enrich_trip_with_experiences()` | `update_trip()` | 1x | `{multiple fields}` |
| 6826 | `enrich_trip_with_experiences()` | `update_trip()` | 1x | `{"profile_status": "confirmed"}` |
| 6932 | `optimize_trip_routing()` | `create_itinerary_item()` | 1+ | Optimized item dict |
| 7121 | `optimize_trip_routing()` | `update_itinerary_item()` | 1+ | Modified item dict |
| 7292 | `optimize_trip_routing()` | `update_link()` | 1x | Link update |
| 7377 | `optimize_trip_routing()` | `update_link()` | 1x | `status="processed"`, `extracted_data=?` |
| 9261 | `suggest_day_trips()` | `update_trip()` | 1x | `{"num_days": int}` (increase) |
| 9328 | `suggest_day_trips()` | `update_day_plan()` | 1x | `{"city": str}`, `{"itinerary": list}` |
| 9340 | `suggest_day_trips()` | `create_itinerary_item()` | 1+ | Day-trip candidate dict |
| 10283 | `build_trip_itinerary()` | `update_trip()` | 1x | Day-by-day schedule data |
| 10324 | `build_trip_itinerary()` | `update_day_plan()` | 1x | `{"itinerary": list}` |
| 10733 | `build_trip_itinerary()` | `update_itinerary_item()` | 1x | Item dict |
| 10788 | `build_trip_itinerary()` | `update_day_plan()` | 1+ | Day plan updates |
| 10959 | `build_trip_itinerary()` | `update_day_plan()` | 1+ | Day plan updates |
| 10991 | `extract_media()` | `update_link()` | 1x | `status="failed"`, `extracted_data={"error": str}` |
| 9825 | `suggest_day_trips()` | `update_day_plan()` | 1+ | Via `_one_patch()` helper — fires parallel PATCHes for rigidity/origin/day_type/city updates |

### 2.2 Critical Callsite: `_build_assist_item()` (line 2225)

**Context:** This function shapes a place (from the extracted pool) into an itinerary_item payload. Trip 41 surfaced field-name mismatches here that caused silent 422s.

```python
def _build_assist_item(p: dict) -> dict:
    """Shape a places_mentioned entry into the itinerary_item payload
    Rails expects."""
    raw_category = p.get("category") or ""
    return {
        "name": p.get("name") or "",
        "category": _normalize_item_category(raw_category),  # Validates against CATEGORY_OPTIONS
        "source": "link" if p.get("source_url") else "ai",
        "origin": "ai_suggested",  # NOT "ai_assist_manual" — must match ORIGINS enum
        "source_url": p.get("source_url"),
        "address": p.get("address"),
        "latitude": p.get("latitude"),
        "longitude": p.get("longitude"),
        "google_place_id": p.get("google_place_id"),
        "google_rating": p.get("rating"),  # Maps from input `rating` → Rails `google_rating`
        "google_reviews_count": p.get("reviews_count"),  # Maps from input `reviews_count` → Rails `google_reviews_count`
        "duration_minutes": 90,
    }
```

**Key field-mapping rules:**
- Input uses `rating` and `reviews_count`; Rails permit list requires `google_rating` and `google_reviews_count`
- `category` must be normalized via `_normalize_item_category()` to ensure it matches CATEGORY_OPTIONS
- `origin` must be exactly one of the ORIGINS enum values

---

## 3. Mutating AI Endpoints

**File:** `ai_service/app/api/routes.py`

These are the POST/PATCH endpoints that the frontend calls to trigger AI operations. Each can potentially mutate Rails trip data.

| Line | Route | Function | ai_mode Guard? | Mutations |
|---|---|---|---|---|
| 91 | `POST /chat` | `handle_chat()` | No | None (read-only analysis) |
| 115 | `POST /analyze-url` | `handle_analyze_url()` | No | None (queues analysis job) |
| 132 | `POST /analyze-url/start` | `start_analyze_urls()` | No | None (starts background job) |
| 238 | `POST /process-link` | `handle_process_link()` | No | Creates/updates Link via rails_client |
| 280 | `POST /generate-itinerary` | `handle_generate_itinerary()` | No | Via `build_trip_itinerary()` — creates DayPlans + ItineraryItems |
| 327 | `POST /analyze-trip/{trip_id}` | `handle_analyze_trip()` | No | Via `analyze_trip()` — updates Trip profile + creates ItineraryItems |
| 355 | `POST /resume-processing/{link_id}` | `handle_resume_processing()` | No | Via `resume_processing()` — updates Link + ItineraryItems |
| 407 | `POST /add-day-trip` | `handle_add_day_trip()` | **YES** | Via `add_day_trip()` — skipped if `ai_mode == "manual"` |
| 494 | `POST /refine-itinerary` | `handle_refine_itinerary()` | **YES** | Via `refine_itinerary()` — skipped if `ai_mode == "manual"` |
| 524 | `POST /confirm-city-distribution` | `handle_confirm_city_distribution()` | **YES** | Via `confirm_city_distribution()` — skipped if `ai_mode == "manual"` |
| 768 | `POST /extract-and-build/{trip_id}` | `handle_extract_and_build()` | No | Main extraction + build pipeline — creates all ItineraryItems |
| 922 | `POST /enrich-experiences/{trip_id}` | `handle_enrich_experiences()` | **YES** | Via `enrich_trip_with_experiences()` — enriches existing items |
| 935 | `POST /optimize-trip/{trip_id}` | `handle_optimize_trip()` | **YES** | Via `optimize_trip_routing()` — reorders + may add/remove items |
| 956 | `POST /manual-assist/{trip_id}` | `handle_manual_assist()` | **YES** | Via `manual_assist_organize()` — **ONLY** in manual mode |
| 983 | `POST /reenrich-places/{trip_id}` | `handle_reenrich_places()` | No | Re-enriches existing places with editorial data |
| 1011 | `POST /clear-build/{trip_id}` | `handle_clear_build()` | **YES** | Via `clear_trip_build()` — deletes all ItineraryItems |

**Key observations:**
- **7 endpoints have `ai_mode == "manual"` guards:** add-day-trip, refine-itinerary, confirm-city-distribution, enrich-experiences, optimize-trip, manual-assist, clear-build
- **manual-assist is special:** Only callable when `ai_mode == "manual"`. Synchronous (not background). Uses `manual_assist_organize()` to place extracted items without AI.
- **No endpoint validates trip.status or trip.profile_status** — may want to add guards to prevent mutations on archived/completed trips.

---

## 4. Frontend Callsites — Building ItineraryItem Payloads

**File:** `frontend/src/pages/TripDetail.js`

The frontend constructs itinerary_item payloads in multiple places. Each callsite sends a subset of the Rails permit list.

### 4.1 Extracted Places → Drag-Drop (line 394 — `handleDragEnd`)

**Context:** User drags a place from the ExtractedPlacesPanel onto a day. Resolves the place from `trip.traveler_profile.places_mentioned` to get full enriched data. Called from the `handleDragEnd` callback that processes drop events on the day cells.

**Payload:**
```javascript
{
  name: place.name,
  category: VALID_CATS.has(rawCat) ? rawCat : "attraction",  // Validates against CATEGORY_OPTIONS
  source: "link",
  origin: "extracted_from_video",
  source_url: place.source_url || null,
  latitude: place.latitude ?? null,
  longitude: place.longitude ?? null,  // CRITICAL: Trip 44 bug was missing this
  address: place.address ?? null,
  google_place_id: place.google_place_id ?? null,
  google_rating: place.rating ?? null,  // Maps from place.rating → itinerary_item.google_rating
  google_reviews_count: place.reviews_count ?? null,  // Maps from place.reviews_count
  photos: Array.isArray(place.photos) ? place.photos : (place.photo_url ? [place.photo_url] : []),
  phone: place.phone ?? null,
  website: place.website ?? null,
  operating_hours: place.operating_hours ?? {},
  pricing_info: place.pricing ?? null,
}
```

**Field set:** name, category, source, origin, source_url, latitude, longitude, address, google_place_id, google_rating, google_reviews_count, photos, phone, website, operating_hours, pricing_info (16 fields)

---

### 4.2 Place Detail Modal → Add to Day (line 261 — `handleAddPlaceToDay`)

**Context:** User opens a place card from the extracted panel and clicks "Add to Day X" button in the modal. Called from the detail drawer's action button. Same payload structure as 4.1.

**Payload:** Identical to 4.1 above.

**Field set:** Same 16 fields as 4.1.

---

### 4.3 Add Item Form (line 41-46 — ItemForm.js payload construction)

**File:** `frontend/src/components/itinerary/ItemForm.js:41-46`

**Context:** User fills in the manual form to add a new item. The form constructs a payload by parsing form fields and coercing types.

```javascript
const data = {
  ...form,
  duration_minutes: form.duration_minutes ? parseInt(form.duration_minutes) : null,
  latitude: form.latitude ? parseFloat(form.latitude) : null,
  longitude: form.longitude ? parseFloat(form.longitude) : null,
};
```

**Field set:** Depends on the form structure, but at minimum: name, category, duration_minutes, latitude, longitude. The `...form` spread includes all form field names.

**Context:** User clicks "Add Item" form button and fills in fields manually. The form invokes `handleAddItem()` which calls `addItem(dayPlanId, data)`.

**Payload shape:** Depends on the form component, but likely includes:
- name (required)
- category (from dropdown)
- latitude, longitude (optional, from map picker)
- address, phone, website (optional text fields)

*Note: Frontend does not show the full permit list in the form; exact shape depends on form component.*

---

### 4.4 Nearby Suggestions → Add One (line 1078)

**Context:** User clicks "Add" on a nearby place suggestion (from `/itinerary_items/{id}/nearby_suggestions` endpoint).

**Payload:** Built from the API response and merged with existing item data:
```javascript
{
  ...existing item fields,
  // Overridden or added:
  name: suggestion.name,
  latitude: suggestion.latitude,
  longitude: suggestion.longitude,
  google_place_id: suggestion.place_id,
  google_rating: suggestion.rating,
  address: suggestion.address,
  photos: suggestion.photo ? [suggestion.photo] : [],
  // ... other fields unchanged
}
```

---

### 4.5 Smart Suggestions Modal (line 1107)

**Context:** User opens the "Smart Suggestions" modal (e.g., "Places for you") and clicks "Add" on one.

**Payload:** Constructed by the PlaceSuggestions component (not fully visible in TripDetail.js). Likely similar to 4.1 (extracted places).

---

## Summary of Callsites

**Python ↔ Rails callsites (including new additions):**
- **Total:** 28 callsites (1 new: orchestrator.py:9825 in suggest_day_trips)

**Frontend payload callsites:**

| Location | Function | Endpoint Called | Field Count | Notes |
|---|---|---|---|---|
| TripDetail.js:394 (`handleDragEnd`) | Drag-drop from extracted panel | createItem() | 16 | Extracts place from trip.traveler_profile.places_mentioned |
| TripDetail.js:261 (`handleAddPlaceToDay`) | Place detail modal → Add to Day | createItem() | 16 | Modal action button dispatch |
| ItemForm.js:41-46 (payload construction) | Manual form add | createItem() | Variable | Parses + coerces form fields (duration_minutes, latitude, longitude) |
| TripDetail.js:1078 (nearby add) | Nearby suggestions | createItem() | 16+ | From nearby_suggestions API |
| TripDetail.js:1107 (smart suggest) | Smart suggestions modal | createItem() | 16+ | From smart suggestions component |
| useTripDetail.js:361 (addItem hook) | Generic wrapper | itemsApi.createItem() | Passthrough | Delegates to API layer |

---

## Key Findings

### Field-Name Mismatches (Trip 41/44 context)

1. **Python → Rails mapping:**
   - Input: `rating`, `reviews_count` (from Google Places API)
   - Rails requires: `google_rating`, `google_reviews_count`
   - **Risk:** If Python sends `rating` directly, Rails silently rejects with 422 (not in permit list)

2. **Category normalization:**
   - Google/frontend may emit "place" or invalid values
   - Rails CATEGORY_OPTIONS: restaurant, attraction, hotel, transport, activity, shopping, cafe, nightlife, other
   - **Risk:** Invalid category → 422 silent rejection

3. **Origin enum mismatches:**
   - AI service uses "ai_suggested"
   - Frontend uses "extracted_from_video" and "user_added"
   - **Risk:** Typos like "ai_assist_manual" → 422 silent rejection

4. **Geo propagation:**
   - Trip 44: Drag-drop handler failed to include latitude/longitude from `places_mentioned`
   - Fix: Pull full enriched place by globalIndex match (line 370–390)

### Missing Validations

- No frontend validation of category against CATEGORY_OPTIONS before send
- No frontend validation of origin against ORIGINS enum
- No Rails endpoint checks ai_mode before allowing refine/optimize/add-day-trip

### Async mutation calls without guards

- Multiple endpoints (POST /process-link, /generate-itinerary, /analyze-trip) don't check ai_mode
- **Implication:** Even in manual mode, extraction and profile analysis run; only the *build* step is skipped

---

## Files Audited

- `backend/app/controllers/api/v1/itinerary_items_controller.rb`
- `backend/app/controllers/api/v1/trips_controller.rb`
- `backend/app/controllers/api/v1/day_plans_controller.rb` (NEW — Gap 1)
- `backend/app/controllers/api/v1/links_controller.rb` (NEW — Gap 1)
- `backend/app/models/itinerary_item.rb`
- `backend/app/models/day_plan.rb`
- `backend/app/models/trip.rb`
- `backend/app/models/link.rb`
- `ai_service/app/services/orchestrator.py`
- `ai_service/app/api/routes.py`
- `frontend/src/pages/TripDetail.js`
- `frontend/src/components/itinerary/ItemForm.js` (NEW — Gap 3)
- `frontend/src/hooks/useTripDetail.js`
- `frontend/src/api/itineraryItems.js`

---

## Next Steps (Tasks 2–3)

This inventory will be used to:

1. **Task 2:** Write contract tests (Python payload validation vs. Rails permit lists)
2. **Task 3:** Add regression catchers (e.g., test that category normalization works, origin validation, geo propagation)
3. **Task 4+:** Harden mutation endpoints with ai_mode guards and input validation
