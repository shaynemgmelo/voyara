import { get, post, patch, del } from "./client";

export function getDayPlans(tripId) {
  return get(`/trips/${tripId}/day_plans`);
}

export function createDayPlan(tripId, data) {
  return post(`/trips/${tripId}/day_plans`, { day_plan: data });
}

export function updateDayPlan(tripId, id, data) {
  return patch(`/trips/${tripId}/day_plans/${id}`, { day_plan: data });
}

export function deleteDayPlan(tripId, id) {
  return del(`/trips/${tripId}/day_plans/${id}`);
}

export function getTravelTimes(tripId, dayPlanId) {
  return get(`/trips/${tripId}/day_plans/${dayPlanId}/travel_times`);
}

export function recalculateSchedule(tripId, dayPlanId) {
  return post(`/trips/${tripId}/day_plans/${dayPlanId}/recalculate_schedule`);
}

export function getSmartSuggestions(tripId, dayPlanId) {
  return get(`/trips/${tripId}/day_plans/${dayPlanId}/smart_suggestions`);
}

// Renumber the trip's day_plans according to the given ordered IDs.
// Used by the day-drag-to-reorder UX: the dropped order becomes the new
// day_number sequence (first id → day 1, etc.). Returns the full
// reordered list so the frontend can patch optimistic state.
export function reorderDayPlans(tripId, dayPlanIds) {
  return patch(`/trips/${tripId}/day_plans/reorder`, {
    day_plan_ids: dayPlanIds,
  });
}
