"""
Google Places API client for direct server-side calls.

In-memory cache layer (added after user feedback that Google Places was ~89%
of generation cost):
  - search(): keyed by (query_lower, location_lower); TTL 7 days. Place names
    + lat/lng are effectively immutable.
  - get_details(): keyed by place_id; TTL 24h. Ratings, hours, pricing move
    slowly — 24h keeps data acceptably fresh.

Quality guardrails:
  - `is_open_now` is NEVER cached — always returned as None on cache hit so
    downstream code can't accidentally serve a 23h-stale "open/closed" badge.
  - Cache is bounded (~5000 entries each) with LRU-ish eviction so memory
    stays predictable on long-running workers.
  - Cache only serves successful responses; empty / error results re-fetch.
  - Cache is in-memory per process — a Render restart rebuilds it. That's
    intentional: if there's ever a transient bad response in prod, a deploy
    flushes it automatically.
"""

from __future__ import annotations

import logging
import time
from collections import OrderedDict

import httpx

from app.config import settings

logger = logging.getLogger(__name__)

BASE_URL = "https://maps.googleapis.com/maps/api/place"

# Cache config — tunable if we ever see memory pressure on Render free tier.
_SEARCH_TTL_S = 7 * 24 * 3600   # 7 days
_DETAILS_TTL_S = 24 * 3600      # 24 hours
_MAX_ENTRIES = 5000


class _TTLCache:
    """Tiny LRU+TTL cache — enough to serve search/details within the same
    worker process. Not multi-worker-aware (that would need Redis); but a
    single Render instance typically handles the whole trip build."""

    def __init__(self, ttl_seconds: int, max_entries: int = _MAX_ENTRIES):
        self._ttl = ttl_seconds
        self._max = max_entries
        self._data: OrderedDict[str, tuple[float, object]] = OrderedDict()
        self.hits = 0
        self.misses = 0

    def get(self, key: str):
        entry = self._data.get(key)
        if entry is None:
            self.misses += 1
            return None
        ts, value = entry
        if time.time() - ts > self._ttl:
            # Expired — drop it
            self._data.pop(key, None)
            self.misses += 1
            return None
        # Move to end (LRU touch)
        self._data.move_to_end(key)
        self.hits += 1
        return value

    def set(self, key: str, value):
        self._data[key] = (time.time(), value)
        self._data.move_to_end(key)
        while len(self._data) > self._max:
            self._data.popitem(last=False)

    def log_rate(self, label: str):
        total = self.hits + self.misses
        if total % 20 == 0 and total > 0:
            rate = self.hits / total * 100
            logger.info(
                "[places-cache:%s] %d hits / %d misses (%.0f%% saved)",
                label, self.hits, self.misses, rate,
            )


_SEARCH_CACHE = _TTLCache(_SEARCH_TTL_S)
_DETAILS_CACHE = _TTLCache(_DETAILS_TTL_S)


def _norm(s: str | None) -> str:
    return (s or "").strip().lower()


class GooglePlacesClient:
    """Async client for Google Places API."""

    def __init__(self, http_client: httpx.AsyncClient | None = None):
        self._client = http_client
        self._owns_client = http_client is None

    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(timeout=10.0)
        return self._client

    async def close(self):
        if self._owns_client and self._client:
            await self._client.aclose()
            self._client = None

    async def search(self, query: str, location: str | None = None) -> list[dict]:
        """
        Search for places using the Text Search API.
        Returns a list of place results with basic info.

        Cached: (query, location) -> result list, TTL 7 days. The cache is
        bypassed on empty / error responses so a transient failure doesn't
        get pinned for a week.
        """
        cache_key = f"{_norm(query)}|{_norm(location)}"
        cached = _SEARCH_CACHE.get(cache_key)
        if cached is not None:
            _SEARCH_CACHE.log_rate("search")
            return cached

        client = await self._get_client()

        # Only append `location` to the query when it's not ALREADY a
        # substring — the caller often passes a query like "Wat Pho Bangkok,
        # Thailand" and a location "Bangkok, Thailand", which would
        # duplicate the city. Case-insensitive check.
        if location and location.lower() not in query.lower():
            final_query = f"{query} {location}"
        else:
            final_query = query
        params = {
            "query": final_query,
            "key": settings.google_places_api_key,
        }

        try:
            resp = await client.get(f"{BASE_URL}/textsearch/json", params=params)
            resp.raise_for_status()
            data = resp.json()

            if data.get("status") not in ("OK", "ZERO_RESULTS"):
                logger.warning("Places search error: %s", data.get("status"))
                return []

            results = []
            for place in data.get("results", [])[:5]:
                results.append(
                    {
                        "place_id": place.get("place_id"),
                        "name": place.get("name"),
                        "address": place.get("formatted_address"),
                        "latitude": place.get("geometry", {})
                        .get("location", {})
                        .get("lat"),
                        "longitude": place.get("geometry", {})
                        .get("location", {})
                        .get("lng"),
                        "rating": place.get("rating"),
                        "user_ratings_total": place.get("user_ratings_total"),
                        "price_level": place.get("price_level"),
                        "types": place.get("types", []),
                        "business_status": place.get("business_status"),
                    }
                )
            # Only cache non-empty results — empty may be a transient API blip.
            if results:
                _SEARCH_CACHE.set(cache_key, results)
            _SEARCH_CACHE.log_rate("search")
            return results

        except Exception as e:
            logger.error("Google Places search failed: %s", e)
            return []

    async def get_details(self, place_id: str) -> dict | None:
        """
        Get detailed info for a specific place by place_id.

        Cached by place_id with 24h TTL. `is_open_now` is stripped from the
        cached copy and reported as None — ratings + hours tolerate 24h
        staleness, but a stale "open now" flag would mislead the user.
        """
        cached = _DETAILS_CACHE.get(place_id)
        if cached is not None:
            _DETAILS_CACHE.log_rate("details")
            # Serve a fresh copy with the volatile flag blanked.
            out = dict(cached)
            out["is_open_now"] = None
            return out

        client = await self._get_client()

        params = {
            "place_id": place_id,
            "fields": (
                "place_id,name,formatted_address,formatted_phone_number,"
                "website,url,rating,user_ratings_total,price_level,"
                "opening_hours,geometry,types,photos,reviews,"
                # editorial_summary = a short Google-curated description
                # of the place (e.g. "Iconic 19th-century cathedral known
                # for..."). When present, it's the single best blurb to
                # show on the detail card — beats raw reviews for at-a-
                # glance "what is this place?" framing.
                "editorial_summary"
            ),
            "key": settings.google_places_api_key,
        }

        try:
            resp = await client.get(f"{BASE_URL}/details/json", params=params)
            resp.raise_for_status()
            data = resp.json()

            if data.get("status") != "OK":
                logger.warning("Place details error: %s", data.get("status"))
                return None

            result = data.get("result", {})
            geo = result.get("geometry", {}).get("location", {})
            hours = result.get("opening_hours", {})

            # Build operating hours dict
            operating_hours = {}
            if hours.get("weekday_text"):
                for line in hours["weekday_text"]:
                    parts = line.split(": ", 1)
                    if len(parts) == 2:
                        operating_hours[parts[0]] = parts[1]

            # Map price level to symbols
            price_map = {0: "Free", 1: "$", 2: "$$", 3: "$$$", 4: "$$$$"}
            pricing = price_map.get(result.get("price_level"), None)

            # Extract photo references (first 3)
            photos = []
            for photo in result.get("photos", [])[:3]:
                ref = photo.get("photo_reference")
                if ref:
                    photos.append(
                        f"https://maps.googleapis.com/maps/api/place/photo"
                        f"?maxwidth=400&photo_reference={ref}"
                        f"&key={settings.google_places_api_key}"
                    )

            # Top 3 reviews — text + author + rating + relative time. We
            # cap at 3 so the cached payload stays small and the modal
            # doesn't drown the user in a wall of opinions.
            top_reviews = []
            for r in (result.get("reviews") or [])[:3]:
                text = (r.get("text") or "").strip()
                if not text:
                    continue
                top_reviews.append({
                    "author": r.get("author_name") or "",
                    "rating": r.get("rating"),
                    "relative_time": r.get("relative_time_description") or "",
                    "text": text[:400],  # clamp long ones for storage hygiene
                })

            # editorial_summary may come back as either a string or as
            # {"overview": "...", "language": "en"}. Normalize to a string.
            es_raw = result.get("editorial_summary")
            if isinstance(es_raw, dict):
                editorial_summary = (es_raw.get("overview") or "").strip()
            elif isinstance(es_raw, str):
                editorial_summary = es_raw.strip()
            else:
                editorial_summary = ""

            details = {
                "place_id": result.get("place_id"),
                "name": result.get("name"),
                "address": result.get("formatted_address"),
                "latitude": geo.get("lat"),
                "longitude": geo.get("lng"),
                "phone": result.get("formatted_phone_number"),
                "website": result.get("website"),
                "google_maps_url": result.get("url"),
                "rating": result.get("rating"),
                "reviews_count": result.get("user_ratings_total"),
                "price_level": result.get("price_level"),
                "pricing": pricing,
                "operating_hours": operating_hours,
                "types": result.get("types", []),
                "photos": photos,
                "editorial_summary": editorial_summary,
                "top_reviews": top_reviews,
                "is_open_now": hours.get("open_now"),
            }
            # Cache the stable fields. is_open_now stays on the returned
            # object (fresh call) but will be None on subsequent cache hits.
            _DETAILS_CACHE.set(place_id, details)
            _DETAILS_CACHE.log_rate("details")
            return details

        except Exception as e:
            logger.error("Google Places details failed for %s: %s", place_id, e)
            return None

    async def autocomplete(self, query: str, location: str | None = None) -> list[dict]:
        """
        Get place autocomplete suggestions.
        """
        client = await self._get_client()

        params = {
            "input": query,
            "key": settings.google_places_api_key,
        }
        if location:
            params["input"] = f"{query} {location}"

        try:
            resp = await client.get(
                f"{BASE_URL}/autocomplete/json", params=params
            )
            resp.raise_for_status()
            data = resp.json()

            return [
                {
                    "place_id": p.get("place_id"),
                    "description": p.get("description"),
                    "main_text": p.get("structured_formatting", {}).get("main_text"),
                }
                for p in data.get("predictions", [])[:5]
            ]

        except Exception as e:
            logger.error("Google Places autocomplete failed: %s", e)
            return []
