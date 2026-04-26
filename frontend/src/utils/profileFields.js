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
 *
 * Note: Rails permits `traveler_profile: {}` (any inner keys), so
 * unknown frontend-owned fields write through silently — this is
 * intentional, lets new editable fields ship without a Rails change.
 * The real risk is the OTHER direction: a backend-owned field that
 * forgets to land in BACKEND_OWNED_PROFILE_FIELDS will round-trip
 * back to clobber the AI service's writes — that's the exact Trip-46
 * bug class. Always add new backend-managed fields to the denylist
 * FIRST, before they ship to prod.
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
