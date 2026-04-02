"""
Tool handler dispatch — routes tool calls from Claude to actual implementations.

Optimized with batch operations to minimize Claude API turns.
"""

from __future__ import annotations

import asyncio
import json
import logging
import tempfile
from pathlib import Path

from app.extractors.instagram import InstagramExtractor
from app.extractors.tiktok import TikTokExtractor
from app.extractors.web import WebExtractor
from app.extractors.youtube import YouTubeExtractor
from app.google_places.client import GooglePlacesClient
from app.services.rails_client import RailsClient

logger = logging.getLogger(__name__)

# Platform extractor registry
_extractors = [
    YouTubeExtractor(),
    InstagramExtractor(),
    TikTokExtractor(),
    WebExtractor(),  # catch-all, must be last
]


class ToolHandlers:
    """Dispatch tool calls to their implementations."""

    def __init__(
        self,
        rails_client: RailsClient,
        places_client: GooglePlacesClient,
        http_client=None,
        places_mentioned: list[dict] | None = None,
        destination: str = "",
        destination_coords: tuple[float, float] | None = None,
        max_distance_km: int = 150,
    ):
        self.rails = rails_client
        self.places = places_client
        self._http_client = http_client
        self.places_mentioned = places_mentioned or []
        self.destination = destination
        self.destination_coords = destination_coords
        self.max_distance_km = max_distance_km

    async def dispatch(self, tool_name: str, tool_input: dict) -> str:
        """Execute a tool call and return the result as a string."""
        handler = getattr(self, f"handle_{tool_name}", None)
        if handler is None:
            return json.dumps({"error": f"Unknown tool: {tool_name}"})

        try:
            result = await handler(tool_input)
            return result if isinstance(result, str) else json.dumps(result)
        except Exception as e:
            logger.error("Tool %s failed: %s", tool_name, e, exc_info=True)
            return json.dumps({"error": f"Tool {tool_name} failed: {str(e)}"})

    # ──────────────────────────────────────────────
    # Content extraction tools
    # ──────────────────────────────────────────────

    async def handle_fetch_url_content(self, input: dict) -> str:
        """Extract content from a URL using the appropriate platform extractor."""
        url = input["url"]

        for extractor in _extractors:
            if extractor.can_handle(url):
                logger.info("Using %s for %s", extractor.__class__.__name__, url)
                content = await extractor.extract(url)
                return json.dumps(content.model_dump(), default=str)

        return json.dumps({"error": "No extractor found for URL"})

    async def handle_transcribe_audio(self, input: dict) -> str:
        """Download video audio and transcribe it with Whisper."""
        url = input["url"]

        yt = YouTubeExtractor()
        audio_path = await yt.download_audio(url)

        if not audio_path:
            return json.dumps(
                {"error": "Failed to download audio", "transcript": ""}
            )

        try:
            from app.transcription.whisper_service import transcribe_audio

            transcript = await transcribe_audio(audio_path)
            return json.dumps(
                {
                    "transcript": transcript,
                    "length": len(transcript),
                    "success": bool(transcript),
                }
            )
        finally:
            try:
                p = Path(audio_path)
                p.unlink(missing_ok=True)
                if p.parent != Path(tempfile.gettempdir()):
                    import shutil

                    shutil.rmtree(p.parent, ignore_errors=True)
            except Exception:
                pass

    async def handle_analyze_video_frames(self, input: dict) -> str:
        """Extract frames from video and analyze with Claude Vision."""
        try:
            from app.vision.frame_analyzer import analyze_frames

            url = input["url"]
            num_frames = input.get("num_frames", 5)
            results = await analyze_frames(url, num_frames=min(num_frames, 8))
            return json.dumps(results)
        except ImportError:
            return json.dumps(
                {"error": "Vision module not available", "descriptions": []}
            )
        except Exception as e:
            return json.dumps({"error": str(e), "descriptions": []})

    # ──────────────────────────────────────────────
    # Batch Google Places validation
    # ──────────────────────────────────────────────

    async def handle_validate_places(self, input: dict) -> str:
        """Search and get details for multiple places at once."""
        places_queries = input["places"]
        results = []

        async def _validate_one(query_data: dict) -> dict:
            query = query_data["query"]
            location = query_data.get("location")
            try:
                # Search
                search_results = await self.places.search(query, location)
                if not search_results:
                    return {"query": query, "found": False, "error": "No results"}

                best = search_results[0]
                place_id = best.get("place_id")

                # Get details
                if place_id:
                    details = await self.places.get_details(place_id)
                    if details:
                        details["found"] = True
                        details["query"] = query
                        return details

                # Fallback to search result data
                return {
                    "query": query,
                    "found": True,
                    "place_id": best.get("place_id"),
                    "name": best.get("name"),
                    "address": best.get("address"),
                    "latitude": best.get("latitude"),
                    "longitude": best.get("longitude"),
                    "rating": best.get("rating"),
                    "reviews_count": best.get("user_ratings_total"),
                }
            except Exception as e:
                return {"query": query, "found": False, "error": str(e)}

        # Run all validations concurrently (max 10 at a time)
        semaphore = asyncio.Semaphore(5)

        async def _throttled(q):
            async with semaphore:
                return await _validate_one(q)

        results = await asyncio.gather(
            *[_throttled(q) for q in places_queries],
            return_exceptions=True,
        )

        # Handle exceptions
        validated = []
        for i, r in enumerate(results):
            if isinstance(r, Exception):
                validated.append(
                    {"query": places_queries[i]["query"], "found": False, "error": str(r)}
                )
            else:
                validated.append(r)

        found_count = sum(1 for v in validated if v.get("found"))
        logger.info(
            "Validated %d/%d places via Google Places",
            found_count, len(places_queries),
        )

        return json.dumps(
            {
                "validated": validated,
                "found": found_count,
                "total": len(places_queries),
            }
        )

    # ──────────────────────────────────────────────
    # Batch itinerary creation
    # ──────────────────────────────────────────────

    async def handle_create_batch_itinerary_items(self, input: dict) -> str:
        """Create multiple itinerary items at once."""
        import math
        from difflib import SequenceMatcher

        def _haversine_km(lat1, lon1, lat2, lon2):
            R = 6371
            dlat = math.radians(lat2 - lat1)
            dlon = math.radians(lon2 - lon1)
            a = math.sin(dlat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2) ** 2
            return R * 2 * math.asin(math.sqrt(a))

        trip_id = input["trip_id"]
        items = input["items"]

        # Build link name index for source tagging
        link_names = [p.get("name", "").strip().lower() for p in self.places_mentioned if p.get("name")]

        created = 0
        errors = []
        skipped_geo = 0

        # Track position per day_plan_id for sequential numbering
        day_positions: dict[int, int] = {}

        for i, item_data in enumerate(items):
            day_plan_id = item_data.pop("day_plan_id")
            item_data.pop("trip_id", None)

            # GEOGRAPHIC VALIDATION — reject places too far from destination
            if self.destination_coords:
                lat = item_data.get("latitude")
                lng = item_data.get("longitude")
                if lat and lng:
                    try:
                        dist = _haversine_km(
                            self.destination_coords[0], self.destination_coords[1],
                            float(lat), float(lng),
                        )
                        if dist > self.max_distance_km:
                            logger.warning(
                                "[geo] REJECTED '%s' — %.0fkm from %s (max %dkm)",
                                item_data.get("name"), dist, self.destination, self.max_distance_km,
                            )
                            skipped_geo += 1
                            continue
                    except (ValueError, TypeError):
                        pass

            # Force-tag source based on places_mentioned match
            if link_names:
                item_name = (item_data.get("name") or "").strip().lower()
                matched = False
                for ln in link_names:
                    if ln in item_name or item_name in ln:
                        matched = True
                        break
                    if SequenceMatcher(None, item_name, ln).ratio() >= 0.75:
                        matched = True
                        break
                item_data["source"] = "link" if matched else "ai"

            # Auto-assign sequential position within each day
            pos = day_positions.get(day_plan_id, 0)
            day_positions[day_plan_id] = pos + 1

            # Clean None values and add position
            clean_data = {k: v for k, v in item_data.items() if v is not None}
            clean_data["position"] = pos

            try:
                result = await self.rails.create_itinerary_item(
                    trip_id, day_plan_id, clean_data
                )
                created += 1
            except Exception as e:
                errors.append(f"Item '{item_data.get('name', i)}': {str(e)}")

        logger.info(
            "Batch created %d/%d itinerary items (trip %d)",
            created, len(items), trip_id,
        )

        return json.dumps(
            {
                "success": created > 0,
                "created": created,
                "total": len(items),
                "errors": errors[:5] if errors else [],
                "message": f"Created {created}/{len(items)} items",
            }
        )

    # ──────────────────────────────────────────────
    # Link status update
    # ──────────────────────────────────────────────

    async def handle_update_link_status(self, input: dict) -> str:
        """Update link status in Rails."""
        trip_id = input["trip_id"]
        link_id = input["link_id"]
        status = input["status"]
        extracted_data = input.get("extracted_data")

        try:
            result = await self.rails.update_link(
                trip_id, link_id, status, extracted_data
            )
            return json.dumps(
                {
                    "success": True,
                    "message": f"Link {link_id} status updated to '{status}'",
                }
            )
        except Exception as e:
            return json.dumps(
                {
                    "success": False,
                    "error": str(e),
                    "message": f"Failed to update link {link_id}",
                }
            )
