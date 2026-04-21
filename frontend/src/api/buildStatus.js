// Asks the AI service whether a build is currently active for this trip.
// Returns { active, stage, elapsed } — or { active: false } if no worker is
// processing this trip right now (meaning: never started, already finished,
// or the worker died silently).
//
// This goes DIRECTLY to the AI service (not Rails) because only the AI
// service knows which background tasks are running.

const AI_URL = process.env.REACT_APP_AI_SERVICE_URL || "http://localhost:8000/api";

export async function fetchBuildStatus(tripId) {
  try {
    const resp = await fetch(`${AI_URL}/build-status/${tripId}`, {
      // 10s timeout — if the AI service is spinning up on free tier it may
      // take a moment. We don't wait longer than that.
      signal: AbortSignal.timeout(10_000),
    });
    if (!resp.ok) return { active: false };
    return await resp.json();
  } catch {
    return { active: false };
  }
}
