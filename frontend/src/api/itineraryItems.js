import { get, post, patch, del } from "./client";

function basePath(tripId, dayPlanId) {
  return `/trips/${tripId}/day_plans/${dayPlanId}/itinerary_items`;
}

export function getItems(tripId, dayPlanId) {
  return get(basePath(tripId, dayPlanId));
}

export function getItem(tripId, dayPlanId, id) {
  return get(`${basePath(tripId, dayPlanId)}/${id}`);
}

export function createItem(tripId, dayPlanId, data) {
  return post(basePath(tripId, dayPlanId), { itinerary_item: data });
}

export function updateItem(tripId, dayPlanId, id, data) {
  return patch(`${basePath(tripId, dayPlanId)}/${id}`, { itinerary_item: data });
}

export function deleteItem(tripId, dayPlanId, id) {
  return del(`${basePath(tripId, dayPlanId)}/${id}`);
}

export function reorderItems(tripId, dayPlanId, itemIds) {
  return patch(`${basePath(tripId, dayPlanId)}/reorder`, { item_ids: itemIds });
}

export function moveItem(tripId, dayPlanId, id, targetDayPlanId, position) {
  return patch(`${basePath(tripId, dayPlanId)}/${id}/move`, {
    target_day_plan_id: targetDayPlanId,
    position,
  });
}

export function getNearbySuggestions(tripId, dayPlanId, id) {
  return get(`${basePath(tripId, dayPlanId)}/${id}/nearby_suggestions`);
}

export function getSuggestSwap(tripId, dayPlanId, id) {
  return get(`${basePath(tripId, dayPlanId)}/${id}/suggest_swap`);
}
