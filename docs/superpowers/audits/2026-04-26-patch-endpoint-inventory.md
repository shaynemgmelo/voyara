# PATCH Endpoint Inventory — 2026-04-26

**Audit date:** 2026-04-26
**Purpose:** Surface every Rails PATCH endpoint, its permit list (especially JSON columns), how the controller writes those columns (REPLACE vs DEEP-MERGE), and what shape the frontend sends — so Tasks 2-3 of the Tier-1 bug-proofing roadmap know exactly which endpoints need the same defenses we shipped for `trips#update` (commit `ad8ee3c`).

**Trip 46 root cause recap:** the frontend cached a stale `traveler_profile` snapshot taken BEFORE the AI service finished geocoding 53 places, then PATCHed the WHOLE profile back. Rails REPLACED the JSON column wholesale, clobbering the freshly-enriched `places_mentioned`. Cards showed "no data", map pins disappeared. The fix landed for the trip endpoint; this inventory generalizes it to every other PATCH-able resource.

---

## Summary

- **Total PATCH endpoints in `Api::V1::*`:** 12
  (7 standard `update` actions + 5 custom member/collection PATCH actions)
- **Endpoints whose permit list contains a JSONB column:** 4
  (`trips#update`, `itinerary_items#update`, `day_plans#update`, `links#update`)
- **Endpoints that DEEP-MERGE that JSON column today:** 1 (`trips#update`)
- **Endpoints that REPLACE that JSON column today:** 3 (`itinerary_items#update`, `day_plans#update`, `links#update`)
- **HIGH risk (controller REPLACES a backend-owned JSON column AND frontend can hit it):** 2
  (`itinerary_items#update`, `day_plans#update`)
- **MEDIUM risk (controller REPLACES a JSON column but only the AI service writes it, so a stale frontend snapshot is unlikely):** 1
  (`links#update` — extracted_data is owned end-to-end by the Python pipeline; the frontend never PATCHes it)
- **LOW risk (no JSON column in permit list):** 8

**Action queue for Tier-1 Task 2-3:**

1. **`itinerary_items#update`** — permit list includes `operating_hours: {}, photos: [], vibe_tags: [], alerts: []`. The frontend calls it with full snapshots in two paths (`ItemForm` create→reuse on edit, plus `GeoReviewModal` writes `{ alerts: cleanAlerts }` after locally filtering). Needs deep-merge for the hash columns and an explicit "the frontend OWNS these keys" doc for the array columns OR a contract similar to `useTripDetail.updateProfile`.
2. **`day_plans#update`** — permit list includes `pattern_signature: {}` (a hash) and `conflict_alerts: [[...]]` (an array of hashes). The frontend has `updateDayPlan` defined in `frontend/src/api/dayPlans.js:11`, but **NO call site exercises it today** (`grep updateDayPlan` only matches the export). Risk is latent: any future feature that PATCHes a `day_plan` will silently clobber `pattern_signature` (set by the AI pipeline) and `conflict_alerts` (set by the conflict-resolution pipeline). Pre-emptively deep-merge.
3. **`links#update`** — permit list includes `extracted_data: {}`. Today only the AI service PATCHes this (Python writes), so the race-window for a stale-frontend clobber is zero. Still worth the cheap fix because the contract is identical and one consistent merge helper across controllers is simpler than 1-of-1 exceptions.

---

## Inventory Table

Legend:
- **REPLACE** = controller calls `update(permit_params)` directly. Rails overwrites the JSON column with whatever the request sent.
- **DEEP-MERGE** = controller explicitly calls `existing.deep_merge(incoming)` before `update`.
- **N/A** = no JSON column in permit list, so REPLACE/DEEP-MERGE doesn't apply.
- **WHOLE** = the frontend sends the entire object/snapshot of the resource (or the entire JSON column).
- **DELTA** = the frontend sends only the fields it just edited.

| # | Controller#action | Verb / Path | Permit scalars | Permit JSON / nested hashes | JSON write style | Frontend payload shape | Frontend call site | Risk |
|---|---|---|---|---|---|---|---|---|
| 1 | `trips#update` | `PATCH /api/v1/trips/:id` | `:name, :destination, :num_days, :status, :ai_mode, :profile_status, :is_staging` | `traveler_profile: {}` | **DEEP-MERGE** (since commit `ad8ee3c`, in `trips_controller.rb:38-44`) | DELTA — `useTripDetail.updateAiMode` sends `{ ai_mode }`; `useTripDetail.updateProfile` strips backend-owned keys via `FRONTEND_OWNED` allow-list before PATCH | `frontend/src/hooks/useTripDetail.js:523, 580` via `tripsApi.updateTrip` | **LOW** (already mitigated end-to-end) |
| 2 | `itinerary_items#update` | `PATCH /api/v1/trips/:trip_id/day_plans/:day_plan_id/itinerary_items/:id` | `:name, :description, :category, :time_slot, :duration_minutes, :position, :latitude, :longitude, :address, :google_place_id, :google_rating, :google_reviews_count, :pricing_info, :phone, :website, :notes, :source_url, :personal_notes, :alternative_group, :source, :origin, :source_video_url, :source_video_creator, :extraction_method, :priority, :item_status, :best_turn, :region, :activity_model, :visit_mode, :item_role` | `operating_hours: {}, photos: [], vibe_tags: [], alerts: []` | **REPLACE** (`itinerary_items_controller.rb:36-42` — `@item.update(item_params)` direct) | Mixed: `GeoReviewModal` sends `{ alerts: cleanAlerts }` (WHOLE alerts array, locally filtered); `useTripDetail.reorderItems` and `moveItemBetweenDays` send `{ time_slot }` (DELTA scalar); `TripDetail.handleSwapItem` sends a swap payload (multi-field DELTA); `ItemDetail.onUpdate` sends `{ personal_notes }` (DELTA scalar) | `frontend/src/components/itinerary/GeoReviewModal.js:42`, `frontend/src/hooks/useTripDetail.js:374, 437, 495`, `frontend/src/pages/TripDetail.js:324, 1031, 1053`, `frontend/src/components/itinerary/ItemDetail.js:352` | **HIGH** — `operating_hours`, `photos`, `vibe_tags`, `alerts` are all populated by the AI service / enrichment pipeline. The `GeoReviewModal` flow already PATCHes the WHOLE alerts array; if the AI service appends a new alert during the user's review window, it's lost. Future "edit item" UI that round-trips operating_hours / photos / vibe_tags would clobber AI enrichment the same way Trip 46 did. |
| 3 | `day_plans#update` | `PATCH /api/v1/trips/:trip_id/day_plans/:id` | `:day_number, :date, :notes, :city, :origin, :rigidity, :day_type, :primary_region, :source_video_url, :source_creator_handle, :estimated_pace` | `pattern_signature: {}, conflict_alerts: [[:type, :day, :message, :item_id, :severity, :created_at]]` | **REPLACE** (`day_plans_controller.rb:27-33` — `@day_plan.update(day_plan_params)` direct) | **No frontend call sites exist today.** `updateDayPlan` is exported from `frontend/src/api/dayPlans.js:11` but `grep updateDayPlan` returns only the export. The export exists for future use. | export-only at `frontend/src/api/dayPlans.js:11`; no consumers | **HIGH (latent)** — `pattern_signature` is set by the AI structured-classifier pipeline; `conflict_alerts` is set by the refine + audit pipelines and consumed by `conflicts#resolve`. The instant any feature wires up `updateDayPlan`, we're one PATCH away from the Trip-46 bug class on day_plans. Fix preemptively. |
| 4 | `links#update` | `PATCH /api/v1/trips/:trip_id/links/:id` | `:status` | `extracted_data: {}` | **REPLACE** (`links_controller.rb:24-30` — `@link.update(link_update_params)` direct) | N/A from frontend. Only the AI service writes to this endpoint via `service_request?`-authenticated PATCHes. The frontend `links.js` exposes only `getLinks`, `createLink`, `deleteLink` — **no `updateLink`**. | none from frontend; AI service only | **MEDIUM** — extracted_data is owned end-to-end by the Python pipeline, so two-writer races are theoretically possible (extract worker + reenrich worker) but the frontend has no clobber path. Still worth pinning down so any future "edit link" UI inherits the safe contract. |
| 5 | `flights#update` | `PATCH /api/v1/trips/:trip_id/flights/:id` | `:airline, :flight_number, :confirmation_number, :total_cost, :departure_date, :arrival_date, :departure_airport, :arrival_airport, :seats, :notes, :booked` | none | N/A | WHOLE — `FlightPanel.handleUpdate` passes the full `form` state (every column of the Flight) | `frontend/src/components/logistics/FlightPanel.js:194-198` via `logisticsApi.updateFlight` | **LOW** (no JSON columns; flights table is flat scalars only) |
| 6 | `lodgings#update` | `PATCH /api/v1/trips/:trip_id/lodgings/:id` | `:name, :address, :check_in_date, :check_in_time, :check_out_date, :check_out_time, :confirmation_number, :total_cost, :phone, :website, :email, :notes, :booked, :latitude, :longitude, :google_place_id, :google_rating` | none | N/A | WHOLE — `LodgingPanel.handleUpdate` passes the full `form` state | `frontend/src/components/logistics/LodgingPanel.js:174-178` via `logisticsApi.updateLodging` | **LOW** (no JSON columns) |
| 7 | `transports#update` | `PATCH /api/v1/trips/:trip_id/transports/:id` | `:transport_type, :company, :confirmation_number, :total_cost, :departure_date, :arrival_date, :pickup_location, :dropoff_location, :vehicle_info, :notes, :booked` | none | N/A | WHOLE — `TransportPanel.handleUpdate` passes the full `form` state | `frontend/src/components/logistics/TransportPanel.js:172-176` via `logisticsApi.updateTransport` | **LOW** (no JSON columns) |
| 8 | `trip_notes#update` | `PATCH /api/v1/trips/:trip_id/trip_notes/:id` | `:title, :content, :category` | none | N/A | WHOLE — `NotePanel.handleUpdate` passes the full `form` state | `frontend/src/components/logistics/NotePanel.js:101-105` via `logisticsApi.updateTripNote` | **LOW** (no JSON columns) |
| 9 | `itinerary_items#reorder` | `PATCH /api/v1/trips/:trip_id/day_plans/:day_plan_id/itinerary_items/reorder` | none — reads `params[:item_ids]` directly | none | N/A — only writes `position` per item via `update!(position: index)` inside a transaction | DELTA — sends only `{ item_ids: [...] }` | `frontend/src/api/itineraryItems.js:27-29`, called from `useTripDetail.reorderItems` | **LOW** |
| 10 | `itinerary_items#move` | `PATCH /api/v1/trips/:trip_id/day_plans/:day_plan_id/itinerary_items/:id/move` | none — reads `params[:target_day_plan_id]` and `params[:position]` directly | none | N/A — only writes `day_plan` + `position` via `update!(day_plan:, position:)` | DELTA — sends `{ target_day_plan_id, position }` | `frontend/src/api/itineraryItems.js:31-36`, called from `useTripDetail.moveItemBetweenDays` | **LOW** |
| 11 | `day_plans#reorder` | `PATCH /api/v1/trips/:trip_id/day_plans/reorder` | none — reads `params[:day_plan_ids]` directly | none | N/A — only writes `day_number` per plan via `update_column` inside a transaction | DELTA — sends `{ day_plan_ids: [...] }` | `frontend/src/api/dayPlans.js:35-39`, called from `useTripDetail.reorderDays` | **LOW** |
| 12 | `conflicts#resolve` | `POST /api/v1/trips/:trip_id/conflicts/resolve` (POST, included for completeness because it mutates a JSONB column) | none — reads `params[:day_plan_id], params[:alert_index], params[:resolution], params[:replacement_name]` directly | none in permit list, but it does write `day_plan.conflict_alerts` (a JSONB column) | DEEP-MERGE-equivalent — controller loads `Array(day_plan.conflict_alerts)`, calls `alerts.delete_at(idx)`, then `day_plan.update!(conflict_alerts: alerts)`. Backend computes the new value from the loaded value, so no payload-driven clobber is possible. | DELTA — sends `{ day_plan_id, alert_index, resolution }` | (no central wrapper file found for this; uses the `post` helper directly from feature components — confirmed safe regardless of frontend payload shape) | **LOW** (controller computes the new value from server state, not from the request body) |

---

## Per-Endpoint Notes

### `trips#update` (Row 1) — already fixed

`backend/app/controllers/api/v1/trips_controller.rb:27-51` already does:

```ruby
permitted = trip_params
if permitted[:traveler_profile].present? && @trip.traveler_profile.present?
  permitted = permitted.to_h
  permitted["traveler_profile"] = @trip.traveler_profile.deep_merge(
    permitted["traveler_profile"].to_h,
  )
end
@trip.update(permitted)
```

And the frontend (`useTripDetail.updateProfile` in `frontend/src/hooks/useTripDetail.js:556-610`) hard-codes the `FRONTEND_OWNED` allow-list:

```js
const FRONTEND_OWNED = new Set([
  "travel_style", "travel_style_en",
  "interests", "interests_en",
  "pace",
  "country_detected", "cities_detected",
  "profile_description", "profile_description_en",
  "main_destination", "needs_destination",
]);
```

This is the template Tier-1 wants to mirror on rows 2-4.

### `itinerary_items#update` (Row 2) — HIGH

Four JSON columns in the permit list, all backend-owned today:

- **`operating_hours`** (hash) — populated by Google Places enrichment in the AI service.
- **`photos`** (array) — populated by Google Places enrichment.
- **`vibe_tags`** (array) — populated by the Haiku tagger in the AI service.
- **`alerts`** (array) — populated by the geo-validator (e.g. `⚠️ ... Xkm ... Dia N`) and by the AI refine/audit pipeline.

Frontend currently PATCHes only DELTA scalar fields in three of four call sites (`time_slot`, `personal_notes`, swap data). The dangerous one is `GeoReviewModal.js:42`:

```js
await updateItem(trip.id, dp.id, item.id, { alerts: cleanAlerts });
```

`cleanAlerts` is the locally-filtered alerts array. If the AI service has appended a new alert between the user opening the modal and clicking "Manter mesmo assim", that new alert is lost. Today the modal opens and closes fast enough that this window is small, but the contract is unsafe.

**Recommended Tier-2 fix:** mirror the trip pattern. Either (a) have the controller deep-merge the four JSON columns, or (b) introduce a dedicated `PATCH /alerts/:index/dismiss` action that subtracts a single alert by index server-side (the conflicts pattern).

### `day_plans#update` (Row 3) — HIGH (latent)

The `pattern_signature` column is set during the structured-classifier pass (AI service writes via `service_request`); the `conflict_alerts` array is mutated by the refine pipeline and by `conflicts#resolve`. The permit list happily accepts both, and the controller does a vanilla `update`.

**The only thing keeping this safe today is that no frontend feature calls `updateDayPlan`.** That is luck, not design. Fix preemptively before someone wires up day-level rigidity / day_type / notes editing.

### `links#update` (Row 4) — MEDIUM

`extracted_data` carries the full extracted result (places_mentioned, video_metadata, etc.). The frontend has no `updateLink` export and no PATCH call site. The Python pipeline is the only writer. Still REPLACE-style, so two parallel Python writers (e.g. a re-extract worker racing the original extract) could clobber each other. Lower priority than rows 2-3 but worth normalizing.

### Logistics endpoints (Rows 5-8) — LOW

`flights`, `lodgings`, `transports`, `trip_notes` have no JSONB columns in their schemas, so REPLACE behavior is fine. Each panel does send the WHOLE form back on edit, which means a parallel writer would lose unsent fields — but there is no parallel writer for these tables today (the AI service does not write to them), so the practical risk is zero. Flag only as informational.

### Reorder / move endpoints (Rows 9-11) — LOW

These operate on dedicated scalar fields (`position`, `day_number`, `day_plan`) that are only meaningful when reordered as a set, computed transactionally on the server from the request's id-list. No JSON-column footgun.

### `conflicts#resolve` (Row 12) — LOW

POST, not PATCH, but it does write to a JSONB column (`day_plan.conflict_alerts`). Listed for completeness because it could superficially look risky. It is in fact the correct pattern: the controller loads `Array(day_plan.conflict_alerts)`, deletes the alert at the index given by the client, and writes back the trimmed array. The new value is computed from server state, not from a client-supplied payload, so a stale client view cannot clobber a freshly-appended alert; worst case it deletes the wrong index, which is bounded user-visible damage, not silent data loss.

---

## What this audit tells Tasks 2-3

- **Task 2 (extend deep-merge)** must hit `itinerary_items#update`, `day_plans#update`, and `links#update`. Pattern: load existing JSON column, deep-merge incoming, assign back, then call `update`.
- **Task 3 (frontend allow-lists / contracts)** must add a `FRONTEND_OWNED` allow-list for itinerary items (the only frontend with multiple PATCH call sites against a JSON-column-bearing endpoint). For day_plans there is nothing to gate today — but the deep-merge in the controller will keep us safe when something arrives.
- **No surprises** beyond the latent risk on `day_plans#update`. The grep commands surfaced exactly what we expected.
