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
