from __future__ import annotations

import logging

import httpx

from app.config import settings

logger = logging.getLogger(__name__)


class RailsClient:
    """Async HTTP client for communicating with the Rails API."""

    def __init__(self, client: httpx.AsyncClient | None = None):
        self._client = client or httpx.AsyncClient(timeout=30.0)
        self.base_url = settings.rails_api_url

    async def get_trip(self, trip_id: int) -> dict:
        """Fetch trip with day_plans and items."""
        resp = await self._request("GET", f"/trips/{trip_id}")
        return resp

    async def get_link(self, trip_id: int, link_id: int) -> dict:
        resp = await self._request("GET", f"/trips/{trip_id}/links/{link_id}")
        return resp

    async def update_link(
        self,
        trip_id: int,
        link_id: int,
        status: str,
        extracted_data: dict | None = None,
    ) -> dict:
        body: dict = {"link": {"status": status}}
        if extracted_data is not None:
            body["link"]["extracted_data"] = extracted_data
        resp = await self._request(
            "PATCH", f"/trips/{trip_id}/links/{link_id}", json=body
        )
        return resp

    async def get_day_plans(self, trip_id: int) -> list[dict]:
        resp = await self._request("GET", f"/trips/{trip_id}/day_plans")
        return resp

    async def update_trip(self, trip_id: int, data: dict) -> dict:
        """Update trip fields (e.g. traveler_profile, profile_status)."""
        return await self._request("PATCH", f"/trips/{trip_id}", json={"trip": data})

    async def get_links(self, trip_id: int) -> list[dict]:
        """Fetch all links for a trip."""
        resp = await self._request("GET", f"/trips/{trip_id}/links")
        return resp

    async def update_day_plan(
        self, trip_id: int, day_plan_id: int, data: dict
    ) -> dict:
        """Update day plan fields (e.g. city)."""
        return await self._request(
            "PATCH",
            f"/trips/{trip_id}/day_plans/{day_plan_id}",
            json={"day_plan": data},
        )

    async def create_itinerary_item(
        self, trip_id: int, day_plan_id: int, item_data: dict
    ) -> dict:
        resp = await self._request(
            "POST",
            f"/trips/{trip_id}/day_plans/{day_plan_id}/itinerary_items",
            json={"itinerary_item": item_data},
        )
        return resp

    async def delete_itinerary_item(
        self, trip_id: int, day_plan_id: int, item_id: int
    ) -> dict:
        return await self._request(
            "DELETE",
            f"/trips/{trip_id}/day_plans/{day_plan_id}/itinerary_items/{item_id}",
        )

    async def update_itinerary_item(
        self, trip_id: int, day_plan_id: int, item_id: int, item_data: dict
    ) -> dict:
        """PATCH an existing itinerary item in-place. Used by the refine
        pipeline to preserve IDs + personal_notes instead of delete+create."""
        return await self._request(
            "PATCH",
            f"/trips/{trip_id}/day_plans/{day_plan_id}/itinerary_items/{item_id}",
            json={"itinerary_item": item_data},
        )

    async def _request(
        self,
        method: str,
        path: str,
        json: dict | None = None,
        retries: int = 3,
    ) -> dict:
        url = f"{self.base_url}{path}"
        last_error = None

        for attempt in range(retries):
            try:
                service_key = getattr(settings, "service_api_key", "") or ""
                resp = await self._client.request(
                    method,
                    url,
                    json=json,
                    headers={
                        "Content-Type": "application/json",
                        "X-Service-Key": service_key,
                    },
                )
                resp.raise_for_status()
                if resp.status_code == 204:
                    return {}
                return resp.json()
            except (httpx.HTTPStatusError, httpx.RequestError) as e:
                last_error = e
                if attempt < retries - 1:
                    import asyncio

                    await asyncio.sleep(2**attempt)
                    logger.warning(
                        "Retrying %s %s (attempt %d): %s",
                        method,
                        path,
                        attempt + 2,
                        str(e),
                    )

        raise last_error  # type: ignore
