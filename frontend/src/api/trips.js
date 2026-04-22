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
