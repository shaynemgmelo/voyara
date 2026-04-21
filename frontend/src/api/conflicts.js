import { get, post } from "./client";

// Phase 4/5 — conflict alerts raised by the refine pipeline or landmark
// audit when an edit would have affected an item marked as coming from the
// user's video (origin=extracted_from_video / source=link).
//
// Endpoint contract (rails_api/app/controllers/api/v1/conflicts_controller.rb):
//   GET  /trips/:id/conflicts  -> { conflicts: [...flat list with day_plan_id] }
//   POST /trips/:id/conflicts/resolve
//        body: { day_plan_id, alert_index, resolution, replacement_name? }

export async function fetchConflicts(tripId) {
  const data = await get(`/trips/${tripId}/conflicts`);
  return data?.conflicts || [];
}

export async function resolveConflict(tripId, { dayPlanId, alertIndex, resolution, replacementName }) {
  return post(`/trips/${tripId}/conflicts/resolve`, {
    day_plan_id: dayPlanId,
    alert_index: alertIndex,
    resolution, // "keep" | "replace" | "remove"
    replacement_name: replacementName,
  });
}
