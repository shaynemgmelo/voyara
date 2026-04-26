import { get, post, patch, del } from "./client";

export function getTrips(status) {
  const query = status ? `?status=${status}` : "";
  return get(`/trips${query}`);
}

export function getTrip(id) {
  return get(`/trips/${id}`);
}

export function createTrip(data) {
  return post("/trips", { trip: data });
}

export function updateTrip(id, data) {
  return patch(`/trips/${id}`, { trip: data });
}

export function deleteTrip(id) {
  return del(`/trips/${id}`);
}

export function shareTrip(id) {
  return post(`/trips/${id}/share`);
}

// Triggers the combined extract → profile → build pipeline on the AI
// service via Rails. Replaces the old multi-step flow (per-link extract
// callback + analyze-trip + resume-processing).
//
// Optionally accepts an array of `links` (URLs). Rails persists them as
// Link records via insert_all (bypassing the after_create_commit callback
// so they don't race the new pipeline) before kicking off extraction.
// Pass links here instead of looping createLink() — that loop would fire
// the legacy extraction trigger for each link in parallel.
export function triggerBuild(tripId, links = []) {
  return post(`/trips/${tripId}/build`, { links });
}

export function unshareTrip(id) {
  return del(`/trips/${id}/unshare`);
}

// Public shared trip (no auth)
export async function getSharedTrip(token) {
  const API_URL = process.env.REACT_APP_API_URL || "http://localhost:3000/api/v1";
  const resp = await fetch(`${API_URL}/shared/${token}`);
  if (!resp.ok) throw new Error("Not found");
  return resp.json();
}

const AI_URL = process.env.REACT_APP_AI_SERVICE_URL || "http://localhost:8000/api";

export async function refineItinerary(tripId, feedback, scope = "trip", dayPlanId = null) {
  const body = { trip_id: tripId, feedback, scope };
  if (dayPlanId) body.day_plan_id = dayPlanId;
  const resp = await fetch(`${AI_URL}/refine-itinerary`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return resp.json();
}

// Programmatic day-trip add — replaces the refine path. mode="replace"
// clears items on target_day_number and inserts the day-trip; mode=
// "extend" bumps trip.num_days +1 and creates a new day. Backend uses
// Haiku + Google Places only (no Sonnet refine), so it's fast and
// won't trigger the "regenerate the whole trip" cascade.
export async function addDayTrip(tripId, destination, options = {}) {
  const { country = "", mode = "extend", targetDayNumber, forceDeleteLocked = false } = options;
  const body = { trip_id: tripId, destination, country, mode };
  if (mode === "replace") body.target_day_number = targetDayNumber;
  if (forceDeleteLocked) body.force_delete_locked = true;
  // 90s ceiling — Haiku ~10s + 4 parallel Google Places ~5s + Rails
  // CRUD ~2s = ~20s typical, but we leave headroom for slow networks.
  // Without this the fetch would hang indefinitely if something on
  // the backend stalls.
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 90_000);
  let resp;
  try {
    resp = await fetch(`${AI_URL}/add-day-trip`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(timeoutId);
    if (e.name === "AbortError") {
      const err = new Error("Tempo esgotado (90s). Tente de novo em alguns segundos.");
      err.status = 504;
      throw err;
    }
    throw e;
  }
  clearTimeout(timeoutId);
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const err = new Error(data?.detail?.message || data?.detail?.error || "add-day-trip failed");
    err.status = resp.status;
    err.data = data?.detail || data;
    throw err;
  }
  return data;
}

// Live day-trip suggestions for the AddDayTripModal. Backend hits Tavily
// + extracts city names via Haiku, caches per (city, country) for 24h.
// On any failure, returns {suggestions: [], source: "unavailable"} —
// the modal falls back to its curated list.
export async function fetchDayTripSuggestions(city, country = "") {
  const params = new URLSearchParams({ city });
  if (country) params.set("country", country);
  const resp = await fetch(`${AI_URL}/day-trip-suggestions?${params}`);
  if (!resp.ok) return { suggestions: [], source: "unavailable" };
  return resp.json();
}

// Manual-mode "Assistência IA" — the user has placed some items by hand
// and wants the AI to fill the rest. Calls the dedicated manual-assist
// endpoint that respects user-placed items (never moves/deletes them),
// completes populated days with same-source video items, and fills empty
// days with the leftover pool clustered by proximity. Sync — small op.
export async function manualAssist(tripId) {
  const resp = await fetch(`${AI_URL}/manual-assist/${tripId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  return resp.json();
}

// Backfills editorial_summary + top_reviews + opening hours on trips
// whose places were enriched BEFORE those fields were added to the
// schema. Cheap (Google Places details cached 24h), idempotent, and
// safe to call on every trip-page mount — the endpoint short-circuits
// when no place is missing the new fields. Returns
// {backfilled: number, total_places: number} on success, or
// {skipped: "all_current"|"no_places"|"trip_not_found"} when nothing
// to do.
export async function reenrichTripPlaces(tripId) {
  const resp = await fetch(`${AI_URL}/reenrich-places/${tripId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  return resp.json();
}

// User-confirmed multi-base distribution. Resumes the paused extract-and-build
// pipeline on the AI service — backend sets city_distribution.status="confirmed"
// and re-enters extract_profile_and_build, which now skips the pause and runs
// Tavily research + build with only the selected cities.
export async function confirmCityDistribution(tripId, selectedCities, dayDistribution) {
  const resp = await fetch(`${AI_URL}/confirm-city-distribution`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      trip_id: tripId,
      selected_cities: selectedCities,
      day_distribution: dayDistribution,
    }),
  });
  return resp.json();
}
