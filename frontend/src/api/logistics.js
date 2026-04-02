import { get, post, patch, del } from "./client";

// Flights
export const getFlights = (tripId) => get(`/trips/${tripId}/flights`);
export const createFlight = (tripId, data) => post(`/trips/${tripId}/flights`, { flight: data });
export const updateFlight = (tripId, id, data) => patch(`/trips/${tripId}/flights/${id}`, { flight: data });
export const deleteFlight = (tripId, id) => del(`/trips/${tripId}/flights/${id}`);

// Lodgings
export const getLodgings = (tripId) => get(`/trips/${tripId}/lodgings`);
export const createLodging = (tripId, data) => post(`/trips/${tripId}/lodgings`, { lodging: data });
export const updateLodging = (tripId, id, data) => patch(`/trips/${tripId}/lodgings/${id}`, { lodging: data });
export const deleteLodging = (tripId, id) => del(`/trips/${tripId}/lodgings/${id}`);

// Transports
export const getTransports = (tripId) => get(`/trips/${tripId}/transports`);
export const createTransport = (tripId, data) => post(`/trips/${tripId}/transports`, { transport: data });
export const updateTransport = (tripId, id, data) => patch(`/trips/${tripId}/transports/${id}`, { transport: data });
export const deleteTransport = (tripId, id) => del(`/trips/${tripId}/transports/${id}`);

// Trip Notes
export const getTripNotes = (tripId) => get(`/trips/${tripId}/trip_notes`);
export const createTripNote = (tripId, data) => post(`/trips/${tripId}/trip_notes`, { trip_note: data });
export const updateTripNote = (tripId, id, data) => patch(`/trips/${tripId}/trip_notes/${id}`, { trip_note: data });
export const deleteTripNote = (tripId, id) => del(`/trips/${tripId}/trip_notes/${id}`);
