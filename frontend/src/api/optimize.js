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
