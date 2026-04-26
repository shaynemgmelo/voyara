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
