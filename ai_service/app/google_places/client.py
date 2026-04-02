"""
Google Places API client for direct server-side calls.
"""

from __future__ import annotations

import logging

import httpx

from app.config import settings

logger = logging.getLogger(__name__)

BASE_URL = "https://maps.googleapis.com/maps/api/place"


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
        """
        client = await self._get_client()

        params = {
            "query": f"{query} {location}" if location else query,
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
            return results

        except Exception as e:
            logger.error("Google Places search failed: %s", e)
            return []

    async def get_details(self, place_id: str) -> dict | None:
        """
        Get detailed info for a specific place by place_id.
        """
        client = await self._get_client()

        params = {
            "place_id": place_id,
            "fields": (
                "place_id,name,formatted_address,formatted_phone_number,"
                "website,url,rating,user_ratings_total,price_level,"
                "opening_hours,geometry,types,photos,reviews"
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

            return {
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
                "is_open_now": hours.get("open_now"),
            }

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
