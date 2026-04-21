// POSTs to the AI service to re-run geographic routing on an existing
// trip without regenerating anything. Returns {changed, total, summary}.

const AI_URL = process.env.REACT_APP_AI_SERVICE_URL || "http://localhost:8000/api";

export async function optimizeTripRouting(tripId) {
  const resp = await fetch(`${AI_URL}/optimize-trip/${tripId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!resp.ok) throw new Error(`optimize-trip failed: ${resp.status}`);
  return resp.json();
}

/**
 * Adds signature destination experiences (tango show, Vespa tour, boat
 * trip, buggy…) to an existing trip via Haiku. Returns {added, total_suggested, summary}.
 */
export async function enrichTripExperiences(tripId) {
  const resp = await fetch(`${AI_URL}/enrich-experiences/${tripId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(60_000),
  });
  if (!resp.ok) throw new Error(`enrich-experiences failed: ${resp.status}`);
  return resp.json();
}
