import { get, post, del } from "./client";

const AI_URL = process.env.REACT_APP_AI_SERVICE_URL || "http://localhost:8000/api";

export function getLinks(tripId) {
  return get(`/trips/${tripId}/links`);
}

export function createLink(tripId, url) {
  return post(`/trips/${tripId}/links`, { link: { url } });
}

export function deleteLink(tripId, id) {
  return del(`/trips/${tripId}/links/${id}`);
}

export async function analyzeTrip(tripId) {
  const resp = await fetch(`${AI_URL}/analyze-trip/${tripId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  return resp.json();
}

export async function resumeProcessing(linkId, tripId) {
  const resp = await fetch(`${AI_URL}/resume-processing/${linkId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ trip_id: tripId }),
  });
  return resp.json();
}
