import { get, post } from "./client";

export function searchPlaces(query, location) {
  return post("/google_places/search", { query, location });
}

export function getPlaceDetails(placeId) {
  return get(`/google_places/details?place_id=${placeId}`);
}

export function autocomplete(input, types) {
  let url = `/google_places/autocomplete?input=${encodeURIComponent(input)}`;
  if (types) url += `&types=${encodeURIComponent(types)}`;
  return get(url);
}
