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
