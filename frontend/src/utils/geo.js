// Haversine distance in kilometers between two lat/lng points.
// Mirrors _haversine_km in ai_service/app/services/orchestrator.py so the
// frontend uses the same definition when deciding "same cluster" vs.
// "needs a transport segment".
export function haversineKm(lat1, lon1, lat2, lon2) {
  const a1 = parseFloat(lat1);
  const o1 = parseFloat(lon1);
  const a2 = parseFloat(lat2);
  const o2 = parseFloat(lon2);
  if ([a1, o1, a2, o2].some((v) => Number.isNaN(v))) return 0;

  const R = 6371; // Earth radius in km
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(a2 - a1);
  const dLon = toRad(o2 - o1);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a1)) * Math.cos(toRad(a2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Threshold above which two consecutive points are treated as a transport
// segment (flight/train/bus), not a walking/driving route. 80 km is a
// pragmatic cutoff — bigger than any reasonable intra-city trip, smaller
// than any reasonable inter-city hop.
export const INTERCITY_GAP_KM = 80;

// Split an ordered list of geo-points into contiguous sub-paths where
// every consecutive pair is within `gapKm`. Gaps above the threshold
// become transport segments (returned separately, so the caller can
// draw a dashed line + plane icon instead of a solid polyline).
//
// Returns: { segments: Array<Array<{lat, lng, item}>>, transports:
// Array<{from, to, distanceKm}> }
export function splitByGap(items, gapKm = INTERCITY_GAP_KM) {
  const segments = [];
  const transports = [];
  let current = [];

  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const lat = parseFloat(it.latitude);
    const lng = parseFloat(it.longitude);
    if (Number.isNaN(lat) || Number.isNaN(lng)) continue;
    const point = { lat, lng, item: it };

    if (current.length === 0) {
      current.push(point);
      continue;
    }
    const prev = current[current.length - 1];
    const dist = haversineKm(prev.lat, prev.lng, lat, lng);
    if (dist > gapKm) {
      segments.push(current);
      transports.push({ from: prev, to: point, distanceKm: dist });
      current = [point];
    } else {
      current.push(point);
    }
  }
  if (current.length > 0) segments.push(current);
  return { segments, transports };
}
