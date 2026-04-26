from __future__ import annotations

import logging
from typing import Any, cast

import httpx

from app.config import settings

logger = logging.getLogger(__name__)


class RailsClient:
    """Async HTTP client for communicating with the Rails API."""

    def __init__(self, client: httpx.AsyncClient | None = None) -> None:
        self._client = client or httpx.AsyncClient(timeout=30.0)
        self.base_url = settings.rails_api_url

    async def get_trip(self, trip_id: int) -> dict[str, Any]:
        """Fetch trip with day_plans and items."""
        resp = await self._request("GET", f"/trips/{trip_id}")
        return cast(dict[str, Any], resp)

    async def get_link(self, trip_id: int, link_id: int) -> dict[str, Any]:
        resp = await self._request("GET", f"/trips/{trip_id}/links/{link_id}")
        return cast(dict[str, Any], resp)

    async def update_link(
        self,
        trip_id: int,
        link_id: int,
        status: str | None = None,
        extracted_data: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """PATCH a link. Both `status` and `extracted_data` are optional —
        callers often want to refresh just the extracted content without
        touching the status flag. Omitted fields don't appear in the body.
        """
        body: dict[str, dict[str, Any]] = {"link": {}}
        if status is not None:
            body["link"]["status"] = status
        if extracted_data is not None:
            body["link"]["extracted_data"] = extracted_data
        if not body["link"]:
            return {}  # nothing to patch
        resp = await self._request(
            "PATCH", f"/trips/{trip_id}/links/{link_id}", json=body
        )
        return cast(dict[str, Any], resp)

    async def get_day_plans(self, trip_id: int) -> list[dict[str, Any]]:
        resp = await self._request("GET", f"/trips/{trip_id}/day_plans")
        return cast(list[dict[str, Any]], resp)

    async def update_trip(
        self, trip_id: int, data: dict[str, Any]
    ) -> dict[str, Any]:
        """Update trip fields (e.g. traveler_profile, profile_status)."""
        resp = await self._request("PATCH", f"/trips/{trip_id}", json={"trip": data})
        return cast(dict[str, Any], resp)

    async def get_links(self, trip_id: int) -> list[dict[str, Any]]:
        """Fetch all links for a trip."""
        resp = await self._request("GET", f"/trips/{trip_id}/links")
        return cast(list[dict[str, Any]], resp)

    async def update_day_plan(
        self, trip_id: int, day_plan_id: int, data: dict[str, Any]
    ) -> dict[str, Any]:
        """Update day plan fields (e.g. city)."""
        resp = await self._request(
            "PATCH",
            f"/trips/{trip_id}/day_plans/{day_plan_id}",
            json={"day_plan": data},
        )
        return cast(dict[str, Any], resp)

    async def create_day_plan(
        self, trip_id: int, data: dict[str, Any]
    ) -> dict[str, Any]:
        """Create a new day_plan. Used by add_day_trip(extend) when the
        user wants to bump trip duration by 1 day for the new day-trip."""
        resp = await self._request(
            "POST",
            f"/trips/{trip_id}/day_plans",
            json={"day_plan": data},
        )
        return cast(dict[str, Any], resp)

    async def create_itinerary_item(
        self, trip_id: int, day_plan_id: int, item_data: dict[str, Any]
    ) -> dict[str, Any]:
        resp = await self._request(
            "POST",
            f"/trips/{trip_id}/day_plans/{day_plan_id}/itinerary_items",
            json={"itinerary_item": item_data},
        )
        return cast(dict[str, Any], resp)

    async def delete_itinerary_item(
        self, trip_id: int, day_plan_id: int, item_id: int
    ) -> dict[str, Any]:
        resp = await self._request(
            "DELETE",
            f"/trips/{trip_id}/day_plans/{day_plan_id}/itinerary_items/{item_id}",
        )
        return cast(dict[str, Any], resp)

    async def update_itinerary_item(
        self,
        trip_id: int,
        day_plan_id: int,
        item_id: int,
        item_data: dict[str, Any],
    ) -> dict[str, Any]:
        """PATCH an existing itinerary item in-place. Used by the refine
        pipeline to preserve IDs + personal_notes instead of delete+create."""
        resp = await self._request(
            "PATCH",
            f"/trips/{trip_id}/day_plans/{day_plan_id}/itinerary_items/{item_id}",
            json={"itinerary_item": item_data},
        )
        return cast(dict[str, Any], resp)

    async def move_itinerary_item(
        self,
        trip_id: int,
        day_plan_id: int,
        item_id: int,
        target_day_plan_id: int,
        position: int,
    ) -> dict[str, Any]:
        """Move an item to a different day_plan via the Rails `move` endpoint.

        Rails route: PATCH /trips/:trip_id/day_plans/:day_plan_id/itinerary_items/:id/move
        Controller: itinerary_items#move — expects `target_day_plan_id` and
        `position` as top-level params (not nested under :itinerary_item).

        Use this instead of sending day_plan_id inside update_itinerary_item,
        which goes through item_params and does NOT permit day_plan_id.
        """
        resp = await self._request(
            "PATCH",
            f"/trips/{trip_id}/day_plans/{day_plan_id}/itinerary_items/{item_id}/move",
            json={"target_day_plan_id": target_day_plan_id, "position": position},
        )
        return cast(dict[str, Any], resp)

    async def _request(
        self,
        method: str,
        path: str,
        json: dict[str, Any] | None = None,
        retries: int = 3,
    ) -> Any:
        # Returns Any because Rails endpoints are not uniform — list endpoints
        # (get_links, get_day_plans) return JSON arrays while singular GET/POST
        # /PATCH return objects. Callers narrow via their own annotations.
        url = f"{self.base_url}{path}"
        last_error: httpx.HTTPError | None = None

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
            except httpx.HTTPStatusError as e:
                last_error = e
                # 4xx = client error; retrying won't help. Log the response
                # body (Rails 422 puts `{"errors": [...]}` here) so we can
                # actually see WHY the validation failed instead of the
                # generic "Client error '422 Unprocessable Content'".
                body_preview = ""
                try:
                    body_preview = e.response.text[:500]
                except Exception:
                    pass
                if 400 <= e.response.status_code < 500:
                    logger.warning(
                        "%s %s → %d %s — giving up (client error). Body: %s",
                        method, path, e.response.status_code,
                        e.response.reason_phrase, body_preview,
                    )
                    raise
                # 5xx — retry with backoff.
                if attempt < retries - 1:
                    import asyncio
                    await asyncio.sleep(2**attempt)
                    logger.warning(
                        "Retrying %s %s (attempt %d): %d — body: %s",
                        method, path, attempt + 2,
                        e.response.status_code, body_preview,
                    )
            except httpx.RequestError as e:
                last_error = e
                if attempt < retries - 1:
                    import asyncio
                    await asyncio.sleep(2**attempt)
                    logger.warning(
                        "Retrying %s %s (attempt %d): %s",
                        method, path, attempt + 2, str(e),
                    )

        assert last_error is not None  # loop above always assigns on failure
        raise last_error
