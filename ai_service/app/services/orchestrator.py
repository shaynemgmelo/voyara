"""
Main processing orchestrator — coordinates the full pipeline.

Both eco and pro modes share the same three-phase pipeline:
  Phase 0 (per-link): Extract content only → store → mark "extracted".
  Phase 1 (per-trip): Aggregate all extracted content → Haiku profile + city detection.
  Phase 2 (per-trip): Build unified itinerary after user confirms profile.
    - Eco: ONE structured Sonnet call → JSON → validate → create items.
    - Pro: Agentic Sonnet loop with validate_places + create_batch_items tools.
"""

from __future__ import annotations

import asyncio
import json
import logging
import math
import re

from difflib import SequenceMatcher

import anthropic

from app.ai.agent import TravelAgent
from app.ai.cost_tracker import CostTracker
from app.ai.tool_handlers import ToolHandlers
from app.config import settings
from app.extractors.youtube import YouTubeExtractor
from app.extractors.tiktok import TikTokExtractor
from app.extractors.instagram import InstagramExtractor
from app.extractors.web import WebExtractor
from app.google_places.client import GooglePlacesClient
from app.services.rails_client import RailsClient

logger = logging.getLogger(__name__)

_extractors = [
    YouTubeExtractor(),
    InstagramExtractor(),
    TikTokExtractor(),
    WebExtractor(),
]


async def process_link(
    link_id: int,
    trip_id: int,
    url: str,
    platform: str,
    ai_mode: str = "eco",
    http_client=None,
) -> dict:
    """Phase 0: Extract content from link. Same for both eco and pro modes."""
    return await _extract_link(link_id, trip_id, url, platform, http_client)


# ──────────────────────────────────────────────
# SHARED HELPERS
# ──────────────────────────────────────────────


async def _extract_content(url: str) -> str:
    """Extract text content from URL. Timeout after 30s to avoid hanging."""
    content_text = ""
    for ext in _extractors:
        if ext.can_handle(url):
            try:
                content = await asyncio.wait_for(ext.extract(url), timeout=30)
                parts = [content.title or "", content.description or ""]
                if content.captions:
                    parts.append(" ".join(content.captions[:50]))
                if content.comments:
                    parts.append(" ".join(content.comments[:10]))
                content_text = "\n".join(p for p in parts if p)
            except asyncio.TimeoutError:
                logger.warning("[extract] Extraction timed out for %s", url)
            except Exception as e:
                logger.warning("[extract] Extraction failed: %s", e)
            break

    return content_text


async def analyze_urls(urls: list[str]) -> dict:
    """Analyze URLs and return place info without creating any database records.

    This is the lightweight "Learn more" endpoint — purely stateless.
    """
    import anthropic

    # 1. Extract content from all URLs
    combined_content = ""
    for url in urls[:5]:  # Max 5 URLs
        try:
            content = await _extract_content(url)
            if content:
                combined_content += f"\n--- Content from {url} ---\n{content}\n"
        except Exception as e:
            logger.warning("[analyze-urls] Failed to extract %s: %s", url, e)

    if not combined_content.strip():
        logger.warning("[analyze-urls] No content extracted from URLs: %s", urls)
        return {"places": [], "destination": None, "summary": "Não foi possível extrair conteúdo dos links. Tente com outro link de vídeo."}

    # 2. Use Haiku to extract place names and destination
    client = anthropic.Anthropic(api_key=settings.anthropic_api_key)

    prompt = f"""Analyze this content and identify the MAIN place(s) that are the FOCUS of the content. Also identify the destination city/region.

Content:
{combined_content[:6000]}

Return ONLY a JSON object:
{{"destination": "City, Country", "places": ["Place Name 1", "Place Name 2", ...], "summary": "One sentence about what the content is about"}}

CRITICAL RULES — Read carefully:
1. **IDENTIFY THE FOCUS**: What is this content ABOUT? What is the creator reviewing, recommending, or showcasing?
   - If it's a review of ONE specific place (e.g., a restaurant review, a hotel tour, an attraction visit) → return ONLY that one place.
   - If it's a "Top 10 restaurants in Paris" or a list/guide → return ALL the featured places.
   - If the content mentions other places as COMPARISONS or REFERENCES (e.g., "it's like the Sphere in Vegas but in LA") → do NOT include the comparison. Only include the actual subject.
2. **IF NO PLACE NAME IS VISIBLE**: Sometimes creators don't say the name. Look at:
   - Comments from viewers (they often identify the place)
   - Addresses, neighborhoods, or landmarks visible
   - Description/caption of the post
   - Hashtags or tags
3. Only include real, specific place names (not generic descriptions)
4. Maximum 10 places
5. Summary should describe what the content is about in one sentence"""

    try:
        response = await asyncio.to_thread(
            lambda: client.messages.create(
                model="claude-haiku-4-5-20251001",
                max_tokens=2000,
                messages=[{"role": "user", "content": prompt}],
            )
        )
        raw = response.content[0].text if response.content else "{}"
    except Exception as e:
        logger.error("[analyze-urls] Haiku call failed: %s", e)
        return {"places": [], "destination": None, "summary": "Analysis failed."}

    parsed = _parse_json_response(raw)
    if not isinstance(parsed, dict):
        logger.error("[analyze-urls] Failed to parse Haiku response: %s", raw[:500])
        # Retry once with stricter prompt
        try:
            response = await asyncio.to_thread(
                lambda: client.messages.create(
                    model="claude-haiku-4-5-20251001",
                    max_tokens=2000,
                    messages=[
                        {"role": "user", "content": prompt},
                        {"role": "assistant", "content": "{"},
                    ],
                )
            )
            raw2 = "{" + (response.content[0].text if response.content else "}")
            parsed = _parse_json_response(raw2)
        except Exception as e:
            logger.error("[analyze-urls] Retry failed: %s", e)
        if not isinstance(parsed, dict):
            return {"places": [], "destination": None, "summary": "Could not parse analysis results."}

    destination = parsed.get("destination", "")
    place_names = parsed.get("places", [])
    summary = parsed.get("summary", "")

    if not place_names:
        return {"places": [], "destination": destination, "summary": summary}

    # 3. Enrich each place with Google Places data
    places_client = GooglePlacesClient()
    enriched_places = []

    try:
        for place_name in place_names[:10]:  # Max 10 places
            try:
                # Search for the place
                search_results = await places_client.search(place_name, destination)
                if not search_results:
                    enriched_places.append({"name": place_name, "source_url": urls[0] if urls else None})
                    continue

                # Get details for the top result
                top = search_results[0]
                details = await places_client.get_details(top["place_id"])

                if details:
                    enriched_places.append({
                        "name": details.get("name", place_name),
                        "address": details.get("address"),
                        "latitude": details.get("latitude"),
                        "longitude": details.get("longitude"),
                        "rating": details.get("rating"),
                        "reviews_count": details.get("reviews_count"),
                        "website": details.get("website"),
                        "phone": details.get("phone"),
                        "google_maps_url": details.get("google_maps_url"),
                        "operating_hours": details.get("operating_hours"),
                        "pricing": details.get("pricing"),
                        "photos": details.get("photos", []),
                        "types": details.get("types", []),
                        "source_url": urls[0] if urls else None,
                    })
                else:
                    enriched_places.append({
                        "name": top.get("name", place_name),
                        "address": top.get("address"),
                        "latitude": top.get("latitude"),
                        "longitude": top.get("longitude"),
                        "rating": top.get("rating"),
                        "reviews_count": top.get("user_ratings_total"),
                        "source_url": urls[0] if urls else None,
                    })
            except Exception as e:
                logger.warning("[analyze-urls] Failed to enrich %s: %s", place_name, e)
                enriched_places.append({"name": place_name, "source_url": urls[0] if urls else None})
    finally:
        await places_client.close()

    return {
        "places": enriched_places,
        "destination": destination,
        "summary": summary,
    }


def _parse_json_response(raw: str) -> list | dict | None:
    """Parse JSON from Claude response, handling code fences."""
    clean = raw.strip()
    # Remove opening code fence (```json, ```, etc.)
    if clean.startswith("```"):
        first_newline = clean.find("\n")
        if first_newline != -1:
            clean = clean[first_newline + 1:]
        else:
            clean = clean[3:]
    # Remove closing code fence
    if clean.rstrip().endswith("```"):
        clean = clean.rstrip()[:-3]
    try:
        return json.loads(clean.strip())
    except json.JSONDecodeError:
        pass
    # Fallback: find JSON array or object in the raw response
    for pattern in [r'\[.*\]', r'\{.*\}']:
        match = re.search(pattern, raw, re.DOTALL)
        if match:
            try:
                return json.loads(match.group())
            except json.JSONDecodeError:
                continue
    return None


async def _analyze_profile(content_text: str, destination: str, cost: CostTracker) -> dict | None:
    """Lightweight Haiku call to analyze traveler profile + detect cities."""
    prompt = f"""You are a travel psychology expert. Analyze this travel content to understand DEEPLY what kind of traveler this person is.

Don't just list categories — understand the VIBE. Are they the type who wakes up early to catch sunrise at a temple, or the type who sleeps in and finds a perfect brunch spot? Do they want Instagram-worthy views or authentic local experiences? Are they adventurous or prefer comfort?

This content comes from MULTIPLE travel inspiration links the user saved. Analyze ALL of it together to build a unified traveler profile.

Return ONLY a JSON object with BILINGUAL fields (both Portuguese and English):
{{"travel_style": "brief vivid style description in Portuguese (e.g. 'explorador cultural com paixão por gastronomia local')",
"travel_style_en": "same style description in English (e.g. 'cultural explorer with a passion for local gastronomy')",
"interests": ["specific interests in Portuguese — be precise, not generic. 'cafés especiais' not just 'café', 'street art e grafite' not just 'arte'"],
"interests_en": ["same interests in English — matching 1:1 with the Portuguese list"],
"pace": "relaxed|moderate|intense",
"cities_detected": ["City1", "City2"],
"profile_description": "2-3 sentences in PERFECT Brazilian Portuguese (pt-BR) with flawless grammar — proper accents (á, é, ã, õ, ô, ç, à), punctuation, and cedilla. Write as if publishing in a professional travel guide.",
"profile_description_en": "Same 2-3 sentences in English. Equally warm, specific, and insightful.",
"places_mentioned": [{{"name": "Exact Place Name", "source_url": "https://...", "day": null}}],
"day_plans_from_links": [{{"day": 1, "places": ["Place A", "Place B", "Place C"], "source_url": "https://..."}}]}}

IMPORTANT:
- places_mentioned: Extract EVERY specific named place from the content — restaurants, attractions, cafes, parks, markets, hotels, bars, viewpoints, beaches, neighborhoods worth visiting, etc. Map each to its source URL (use the "--- Source: URL ---" headers in the content). Be THOROUGH — if a place is named in the content, it MUST appear here. Generic descriptions like "a nice cafe" or "the beach" don't count — only specifically named places (e.g., "In-N-Out Burger", "Griffith Observatory", "Café de Flore"). This list is critical — it tells the user which itinerary items came from their saved links. If a place is assigned to a specific day in the content, include "day": <number>.
- day_plans_from_links: If the content contains a PRE-PLANNED day-by-day itinerary (e.g., "Day 1: visit X, Y, Z" or "First day: we went to A, B, C"), extract the COMPLETE day structure here. Each entry = one day with its ordered list of place names. This is CRITICAL — when someone shares a complete travel plan, we MUST respect their exact day grouping. If the content is NOT organized by days (just a list of recommendations), leave this as an empty array [].
- cities_detected: List ONLY truly distinct cities/destinations that are far apart and require separate travel days (e.g., "Las Vegas" and "Zion National Park", or "Los Angeles" and "Joshua Tree").
  CRITICAL: Neighborhoods, districts, and nearby areas within the SAME metro area are NOT separate cities. For example: Venice, Santa Monica, Beverly Hills, Hollywood, Malibu are all part of "Los Angeles" — do NOT list them separately. Similarly, Brooklyn and Manhattan are both "New York City". Only list a place as a separate city if it's truly a different destination requiring 1+ hour of travel (like a national park, another city, etc.).
  If ALL content is about ONE city and its neighborhoods, return just ["City Name"].
- interests: Be specific and actionable (these will guide place recommendations).
- Destination context: {destination}

Content from multiple sources:
{content_text[:6000]}"""

    client = anthropic.Anthropic(api_key=settings.anthropic_api_key)

    # Retry up to 2 times on failure
    for attempt in range(2):
        try:
            response = await asyncio.to_thread(
                lambda: client.messages.create(
                    model="claude-haiku-4-5-20251001",
                    max_tokens=2048,
                    messages=[{"role": "user", "content": prompt}],
                )
            )
            cost.record_usage(response.usage)
            raw = response.content[0].text if response.content else "{}"
        except Exception as e:
            logger.warning("[profile] Haiku call failed (attempt %d): %s", attempt + 1, e)
            if attempt == 0:
                await asyncio.sleep(2)
                continue
            return None

        parsed = _parse_json_response(raw)
        if isinstance(parsed, dict):
            # Accept profile even if some fields are missing — fill defaults
            if "profile_description" not in parsed:
                parsed["profile_description"] = f"Viajante interessado em explorar {destination}."
            if "travel_style" not in parsed:
                parsed["travel_style"] = "explorador"
            if "interests" not in parsed:
                parsed["interests"] = []
            if "pace" not in parsed:
                parsed["pace"] = "moderate"
            if "cities_detected" not in parsed:
                parsed["cities_detected"] = [destination] if destination else []
            if "places_mentioned" not in parsed:
                parsed["places_mentioned"] = []
            logger.info("[profile] Profile parsed successfully with %d places mentioned", len(parsed.get("places_mentioned", [])))
            return parsed

        logger.warning("[profile] Failed to parse profile response (attempt %d). Raw: %s", attempt + 1, raw[:300])
        if attempt == 0:
            await asyncio.sleep(2)

    return None


async def _assign_cities_to_days(
    rails: RailsClient, trip_id: int, day_plans: list[dict],
    day_distribution: dict[str, int],
):
    """Assign cities to day_plans based on user-chosen day distribution.

    day_distribution: {"Las Vegas": 3, "Zion National Park": 2, "Beryl": 2}
    """
    if not day_distribution:
        return

    # Build ordered city→days mapping from distribution
    day_index = 0
    for city, num_days in day_distribution.items():
        for _ in range(num_days):
            if day_index < len(day_plans):
                dp = day_plans[day_index]
                try:
                    await rails.update_day_plan(trip_id, dp["id"], {"city": city})
                    dp["city"] = city
                except Exception as e:
                    logger.warning("[cities] Failed to assign city to day %d: %s", dp["day_number"], e)
                day_index += 1


def _normalize_place_name(name: str) -> str:
    """Normalize a place name for fuzzy matching — strip accents, lowercase,
    remove punctuation and common noise words."""
    import unicodedata

    if not name:
        return ""
    # Strip accents
    n = unicodedata.normalize("NFD", name)
    n = "".join(c for c in n if unicodedata.category(c) != "Mn")
    n = n.lower().strip()
    # Remove punctuation and duplicate whitespace
    n = re.sub(r"[^a-z0-9\s]", " ", n)
    n = re.sub(r"\s+", " ", n).strip()
    # Strip trailing city/state noise ("restaurante aprazivel rio de janeiro"
    # still matches "restaurante aprazivel")
    noise_words = {
        "the", "a", "o", "os", "as", "de", "da", "do", "das", "dos",
        "restaurant", "restaurante", "cafe", "bar", "museu", "museum",
        "parque", "park",
    }
    tokens = [t for t in n.split() if t and t not in noise_words]
    return " ".join(tokens) if tokens else n


def _tag_sources_from_links(place_list: list[dict], places_mentioned: list[dict]) -> list[dict]:
    """Programmatically tag source='link' for items matching places_mentioned.

    Claude often ignores the source tagging instruction, so we do it ourselves
    by fuzzy-matching item names against the extracted places list.
    """
    if not places_mentioned:
        # Still ensure every item has a source set
        for item in place_list:
            if item.get("source") not in ("link", "ai", "manual"):
                item["source"] = "ai"
        return place_list

    # Build normalized name variants from places_mentioned
    link_variants: list[tuple[str, str]] = []  # (normalized, original)
    for p in places_mentioned:
        name = (p.get("name") or "").strip()
        if name:
            link_variants.append((_normalize_place_name(name), name))

    if not link_variants:
        return place_list

    tagged_link = 0
    for item in place_list:
        raw = (item.get("name") or "").strip()
        if not raw:
            continue
        item_norm = _normalize_place_name(raw)
        if not item_norm:
            continue

        matched = False
        # 1. Exact normalized match
        for link_norm, orig in link_variants:
            if item_norm == link_norm:
                item["source"] = "link"
                tagged_link += 1
                matched = True
                break

        # 2. Containment (handles "Cristo Redentor Statue" ⊇ "Cristo Redentor")
        if not matched:
            for link_norm, _ in link_variants:
                if not link_norm:
                    continue
                if (
                    link_norm in item_norm
                    or item_norm in link_norm
                    or _token_overlap(link_norm, item_norm) >= 0.7
                ):
                    item["source"] = "link"
                    tagged_link += 1
                    matched = True
                    break

        # 3. Sequence similarity fallback (lowered threshold 0.75→0.68)
        if not matched:
            for link_norm, _ in link_variants:
                ratio = SequenceMatcher(None, item_norm, link_norm).ratio()
                if ratio >= 0.68:
                    item["source"] = "link"
                    tagged_link += 1
                    matched = True
                    break

        if not matched and item.get("source") != "link":
            item["source"] = "ai"

    logger.info(
        "[source-tag] Tagged %d/%d items as 'link' (from %d places_mentioned)",
        tagged_link,
        len(place_list),
        len(link_variants),
    )
    return place_list


def _token_overlap(a: str, b: str) -> float:
    """Jaccard overlap on tokens — catches word-order differences.

    'observatorio griffith' vs 'griffith observatorio' → 1.0
    """
    sa = set(a.split())
    sb = set(b.split())
    if not sa or not sb:
        return 0.0
    return len(sa & sb) / len(sa | sb)


def _ensure_link_places_present(
    place_list: list[dict],
    places_mentioned: list[dict] | None,
    day_plans: list[dict],
) -> list[dict]:
    """After Claude returns, verify every link-mentioned place is actually in
    the itinerary. If any are missing, inject them on an appropriate day.

    This is the safety net that enforces 'user's link places are mandatory'.
    """
    if not places_mentioned:
        return place_list

    # Names currently present in the itinerary (normalized)
    present = {_normalize_place_name(it.get("name", "")) for it in place_list}

    missing: list[dict] = []
    for p in places_mentioned:
        name = (p.get("name") or "").strip()
        if not name:
            continue
        norm = _normalize_place_name(name)
        if norm and norm not in present and not any(
            norm in pn or pn in norm for pn in present if pn
        ):
            missing.append(p)

    if not missing:
        return place_list

    logger.warning(
        "[link-coverage] Claude dropped %d link place(s): %s",
        len(missing),
        [p.get("name") for p in missing],
    )

    # Distribute missing places: prefer day suggested by extractor, else
    # the least-packed day, capped at 6 items per day.
    num_days = len(day_plans)
    items_per_day: dict[int, int] = {}
    for it in place_list:
        d = it.get("day") or 1
        items_per_day[d] = items_per_day.get(d, 0) + 1

    for p in missing:
        target_day = p.get("day") or None
        if not target_day or target_day < 1 or target_day > num_days:
            # Pick day with fewest items, avoiding days already full
            target_day = min(
                range(1, num_days + 1),
                key=lambda d: items_per_day.get(d, 0),
            )
        if items_per_day.get(target_day, 0) >= 6:
            # Day is full — pick any other under 6
            candidates = [
                d for d in range(1, num_days + 1)
                if items_per_day.get(d, 0) < 6
            ]
            if candidates:
                target_day = min(candidates, key=lambda d: items_per_day.get(d, 0))

        injected = {
            "day": target_day,
            "name": p.get("name"),
            "category": "attraction",
            "time_slot": "15:00",
            "duration_minutes": 90,
            "description": "Lugar mencionado no seu link salvo.",
            "notes": None,
            "vibe_tags": [],
            "alerts": [],
            "alternative_group": None,
            "source": "link",
            "source_url": p.get("source_url"),
        }
        place_list.append(injected)
        items_per_day[target_day] = items_per_day.get(target_day, 0) + 1
        logger.info(
            "[link-coverage] Injected '%s' on day %d", p.get("name"), target_day
        )

    return place_list


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculate distance in km between two lat/lng points using Haversine formula."""
    R = 6371  # Earth's radius in km
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2) ** 2
    return R * 2 * math.asin(math.sqrt(a))


async def _get_destination_coords(destination: str, places_client: GooglePlacesClient) -> tuple[float, float] | None:
    """Get lat/lng for the trip destination using Google Places."""
    if not destination:
        return None
    try:
        results = await places_client.search(destination, destination)
        if results:
            lat = results[0].get("latitude")
            lng = results[0].get("longitude")
            if lat and lng:
                return (float(lat), float(lng))
    except Exception as e:
        logger.warning("[geo] Failed to geocode destination '%s': %s", destination, e)
    return None


async def _validate_and_create_items(
    place_list: list[dict],
    trip: dict,
    day_plans: list[dict],
    rails: RailsClient,
    places: GooglePlacesClient,
    cost: CostTracker,
    trip_id: int,
    source_urls: list[str] | None = None,
) -> dict:
    """Validate places via Google Places, generate alerts, create items in Rails."""
    dp_by_number = {dp["day_number"]: dp["id"] for dp in day_plans}
    destination = trip.get("destination", "")
    source_url = ", ".join(source_urls) if source_urls else ""

    # Get destination center for geographic validation
    # Max distance: 150km for normal cities, 300km for multi-city trips
    dest_coords = await _get_destination_coords(destination, places)
    cities_in_plans = set()
    for dp in day_plans:
        c = dp.get("city")
        if c:
            cities_in_plans.add(c)
    max_distance_km = 300 if len(cities_in_plans) > 1 else 150

    semaphore = asyncio.Semaphore(10)

    async def validate_one(place: dict) -> dict | None:
        name = place.get("name", "")
        if not name:
            return None
        # Use city-specific search if available
        search_city = place.get("city", destination)
        async with semaphore:
            try:
                results = await places.search(f"{name} {search_city}", search_city)
                if not results:
                    return place
                best = results[0]
                place_id = best.get("place_id")

                place["latitude"] = best.get("latitude")
                place["longitude"] = best.get("longitude")
                place["address"] = best.get("address")
                place["google_place_id"] = place_id
                place["google_rating"] = best.get("rating")
                place["google_reviews_count"] = best.get("user_ratings_total")

                if place_id:
                    details = await places.get_details(place_id)
                    if details:
                        place["phone"] = details.get("phone")
                        place["website"] = details.get("website")
                        place["pricing_info"] = details.get("pricing")
                        place["operating_hours"] = details.get("operating_hours")
                        place["google_reviews_count"] = details.get("reviews_count")
                        photos = details.get("photos", [])
                        if photos:
                            place["photos"] = photos[:2]

                return place
            except Exception as e:
                logger.warning("[eco] Validation failed for %s: %s", name, e)
                return place

    validated = await asyncio.gather(*[validate_one(p) for p in place_list])
    validated = [p for p in validated if p is not None]

    # GEOGRAPHIC VALIDATION — reject places too far from destination
    if dest_coords:
        dest_lat, dest_lng = dest_coords
        geo_valid = []
        rejected = []
        for place in validated:
            lat = place.get("latitude")
            lng = place.get("longitude")
            if lat and lng:
                try:
                    dist = _haversine_km(dest_lat, dest_lng, float(lat), float(lng))
                    if dist > max_distance_km:
                        rejected.append((place.get("name"), dist))
                        continue
                except (ValueError, TypeError):
                    pass
            geo_valid.append(place)
        if rejected:
            logger.warning(
                "[geo] REJECTED %d places too far from %s (max %dkm): %s",
                len(rejected), destination, max_distance_km,
                ", ".join(f"{name} ({dist:.0f}km)" for name, dist in rejected),
            )
        validated = geo_valid

    # Generate deterministic alerts from Google Places data (zero AI cost)
    for place in validated:
        alerts = list(place.get("alerts") or [])
        hours = place.get("operating_hours")
        if hours and isinstance(hours, dict):
            closed_days = [d for d, h in hours.items() if "closed" in str(h).lower()]
            for d in closed_days:
                alert = f"Fechado: {d}"
                if alert not in alerts:
                    alerts.append(alert)
        pricing = place.get("pricing_info")
        if pricing in ("$$$$",):
            alert = "Local de alto custo"
            if alert not in alerts:
                alerts.append(alert)
        place["alerts"] = alerts

    # PROXIMITY OPTIMIZATION — reorder items within each day by geographic proximity
    validated = _optimize_day_proximity(validated)

    logger.info("[eco] Validated %d places, creating items", len(validated))

    # Create items in Rails (parallel for speed)
    day_positions: dict[int, int] = {}
    create_tasks = []

    VALID_CATEGORIES = {"restaurant", "attraction", "hotel", "transport", "activity", "shopping", "cafe", "nightlife", "other"}
    CATEGORY_MAP = {"bar": "nightlife", "park": "attraction", "museum": "attraction"}

    for place in validated:
        day_num = place.get("day", 1)
        day_plan_id = dp_by_number.get(day_num, list(dp_by_number.values())[0])

        pos = day_positions.get(day_plan_id, 0)
        day_positions[day_plan_id] = pos + 1

        raw_cat = place.get("category", "attraction")
        category = CATEGORY_MAP.get(raw_cat, raw_cat) if raw_cat not in VALID_CATEGORIES else raw_cat

        item_data = {
            "name": place.get("name", "Unknown"),
            "category": category,
            "time_slot": place.get("time_slot"),
            "duration_minutes": place.get("duration_minutes"),
            "description": place.get("description", ""),
            "notes": place.get("notes"),
            "latitude": place.get("latitude"),
            "longitude": place.get("longitude"),
            "address": place.get("address"),
            "google_place_id": place.get("google_place_id"),
            "google_rating": place.get("google_rating"),
            "google_reviews_count": place.get("google_reviews_count"),
            "operating_hours": place.get("operating_hours"),
            "pricing_info": place.get("pricing_info"),
            "phone": place.get("phone"),
            "website": place.get("website"),
            "photos": place.get("photos"),
            "vibe_tags": place.get("vibe_tags"),
            "alerts": place.get("alerts"),
            "alternative_group": place.get("alternative_group"),
            "position": pos,
            "source": place.get("source", "ai"),
            "source_url": source_url,
        }
        item_data = {k: v for k, v in item_data.items() if v is not None}
        create_tasks.append((trip_id, day_plan_id, item_data, place.get("name")))

    # Run all creates concurrently (batches of 10 to avoid overwhelming Rails)
    created = 0
    for i in range(0, len(create_tasks), 10):
        batch = create_tasks[i:i + 10]

        async def _create_one(t_id, dp_id, data, name):
            try:
                await rails.create_itinerary_item(t_id, dp_id, data)
                return True
            except Exception as e:
                logger.warning("[eco] Failed to create %s: %s", name, e)
                return False

        results = await asyncio.gather(
            *[_create_one(t, d, data, n) for t, d, data, n in batch]
        )
        created += sum(1 for r in results if r)

    cost.log_summary()
    return {
        "places_created": created,
        "summary": f"Created {created} items across {len(day_positions)} days",
        "cost": cost.summary(),
    }


def _build_itinerary_prompt(
    content_text: str,
    trip: dict,
    day_plans: list[dict],
    existing_items: list[str],
    source_urls: list[str] | None = None,
    places_mentioned: list[dict] | None = None,
    day_plans_from_links: list[dict] | None = None,
) -> str:
    """Build the Claude prompt for itinerary generation (Eco mode), with full personalization."""
    num_days = len(day_plans)
    destination = trip.get("destination", "a destination")
    existing_info = f"\nAvoid duplicates: {', '.join(existing_items)}" if existing_items else ""

    # Personalization from traveler profile
    profile = trip.get("traveler_profile") or {}
    profile_section = ""
    if profile.get("travel_style") or profile.get("interests"):
        style = profile.get("travel_style", "")
        interests = ", ".join(profile.get("interests", []))
        pace = profile.get("pace", "moderate")
        description = profile.get("profile_description", "")

        # Category preferences from user selection
        cat_prefs = profile.get("category_preferences") or {}
        cat_rules = ""
        if cat_prefs:
            wanted = [k for k, v in cat_prefs.items() if v]
            unwanted = [k for k, v in cat_prefs.items() if not v]
            if unwanted:
                cat_rules += f"\nCATEGORY PREFERENCES (respect strictly):"
                cat_rules += f"\n- WANTED: {', '.join(wanted)}"
                cat_rules += f"\n- NOT WANTED: {', '.join(unwanted)} — MINIMIZE these categories. Include at most 1 per day and only if essential."
                if "restaurants" in unwanted:
                    cat_rules += "\n- The traveler does NOT want many restaurants. Include at most 1 restaurant/café per day for meals, do NOT fill slots with dining places."
            else:
                cat_rules += f"\n- Focus on: {', '.join(wanted)}"

        profile_section = f"""
TRAVELER PROFILE (personalize recommendations):
- Style: {style}
- Interests: {interests}
- Pace: {pace}
- Description: {description}
Prioritize places matching their interests while still creating a complete trip experience.
{cat_rules}
"""

    # Source URLs for traceability
    sources_info = ""
    if source_urls:
        sources_info = f"\nContent extracted from: {', '.join(source_urls)}"

    # Structured places from user links (extracted in Phase 1)
    places_section = ""
    total_slots = min(num_days * 5, 50)  # 5 items/day, up to 10-day trips at full capacity
    if places_mentioned:
        place_lines = []
        for p in places_mentioned:
            src = p.get("source_url", "link")
            place_lines.append(f"- {p['name']} (from: {src})")

        num_link_places = len(places_mentioned)
        # Link places are the BASE of the itinerary. Reserve at least 20%
        # of slots for AI to add mandatory landmarks + fill gaps with
        # geographically-sensible companions. Only cap link places if
        # they would exceed 80% of total slots (huge vlog with 30+ places).
        max_link_places = max(num_link_places, int(total_slots * 0.8))
        if num_link_places <= int(total_slots * 0.8):
            # Normal case: include ALL link places as the base
            places_section = f"""
╔═══════════════════════════════════════════════════════════════╗
║  BASE DO ROTEIRO — LUGARES DOS LINKS DO USUÁRIO               ║
║  ESTES SÃO OBRIGATÓRIOS E DEVEM SER OS PRINCIPAIS DO ROTEIRO  ║
╚═══════════════════════════════════════════════════════════════╝
{chr(10).join(place_lines)}

REGRAS DURAS SOBRE ESTES LUGARES (NÃO NEGOCIÁVEIS):
1. TODOS os {num_link_places} lugares acima DEVEM aparecer no roteiro final.
2. TODOS devem ter "source": "link" — use exatamente o NOME da lista acima.
3. ELES SÃO OS PROTAGONISTAS — distribua-os ao longo dos {num_days} dias de forma geograficamente coerente.
4. O roteiro é CONSTRUÍDO AO REDOR deles. Os lugares adicionais da sua expertise (source: "ai") existem para:
   a) Incluir marcos obrigatórios da cidade que o vídeo não mencionou (landmarks imperdíveis).
   b) Agrupar por proximidade geográfica — se um lugar do link fica no bairro X, complete esse dia com outros lugares do bairro X.
   c) Preencher refeições, viewpoints no pôr-do-sol, cafés — completar os dias sem deslocamento longo.
5. Adicione cerca de {total_slots - num_link_places} lugares seus (source: "ai") para completar {total_slots} vagas totais.
6. Se algum lugar do link não fizer sentido geográfico com os outros, agrupe-o com outros do mesmo bairro (mesmo que você precise adicionar companheiros AI).
"""
        else:
            # Huge vlog — too many places to fit. Cap at 80% but still MANDATORY for chosen ones.
            places_section = f"""
╔═══════════════════════════════════════════════════════════════╗
║  BASE DO ROTEIRO — LUGARES DOS LINKS DO USUÁRIO               ║
╚═══════════════════════════════════════════════════════════════╝
{chr(10).join(place_lines)}

O usuário salvou {num_link_places} lugares dos links dele. O roteiro tem {total_slots} vagas ({num_days} dias × ~5 por dia).
DEVE ESCOLHER os {max_link_places} lugares MAIS ICÔNICOS desta lista e incluí-los obrigatoriamente como "source": "link".
Estes lugares são a BASE do roteiro — os adicionais "source": "ai" existem apenas para agrupar geograficamente e incluir landmarks imperdíveis que o vídeo não mencionou.
Adicione cerca de {total_slots - max_link_places} lugares seus (source: "ai") para completar as vagas.
"""

    # Pre-planned day structure from links (e.g., "Day 1: X, Y, Z" from a travel video)
    preplanned_section = ""
    if day_plans_from_links:
        plan_lines = []
        for dp_link in day_plans_from_links:
            day_num = dp_link.get("day", 0)
            places_list = dp_link.get("places", [])
            src = dp_link.get("source_url", "link")
            if places_list and day_num:
                places_str = ", ".join(places_list)
                plan_lines.append(f"  Day {day_num}: {places_str} (from: {src})")
        if plan_lines:
            preplanned_section = f"""
PRE-PLANNED ITINERARY FROM USER'S LINKS (HIGHEST PRIORITY — DO NOT CHANGE):
The user's link content contains a complete day-by-day plan. You MUST use this EXACT structure:
{chr(10).join(plan_lines)}

RULES FOR PRE-PLANNED DAYS:
1. Keep these places on the EXACT day specified. Do NOT move them to different days.
2. Keep the SAME order within each day.
3. Tag ALL these places as "source": "link".
4. You may ADD your own "source": "ai" recommendations to fill gaps (meals, evening activities) but NEVER remove or replace any pre-planned place.
5. For days NOT covered by the pre-planned structure, create complete days with your own recommendations.
"""

    # Multi-city awareness from day_plans
    city_section = ""
    cities_in_plans = {}
    for dp in day_plans:
        city = dp.get("city")
        if city:
            cities_in_plans.setdefault(city, []).append(dp["day_number"])
    if cities_in_plans:
        city_lines = []
        for city, days in cities_in_plans.items():
            day_str = ", ".join(str(d) for d in days)
            city_lines.append(f"- {city}: Days {day_str}")
        city_section = f"""
CITY ASSIGNMENTS (places MUST match the city assigned to each day):
{chr(10).join(city_lines)}
IMPORTANT: When generating places, search for attractions IN THE CORRECT CITY for each day. Don't put Las Vegas attractions on a Zion day or vice versa. Each city has its own iconic attractions — use them.
"""
        # Override destination for multi-city
        destination = " / ".join(cities_in_plans.keys())

    return f"""You are an expert travel planner building a {num_days}-day itinerary for {destination}.
Think like someone who has visited {destination} 50 times and knows exactly what makes a trip unforgettable.

MINDSET — Think like a real traveler:
1. POSTCARDS FIRST: When a traveler arrives at a destination, they want to SEE the place — the landmarks, \
the views, the spots that define the city. The first days should feel like "I'm really HERE!" with the destination's \
most recognizable attractions and iconic views. This doesn't mean a strict ranking of popularity — it means the \
early days set the tone with the experiences that make the traveler feel connected to where they are. \
Local hidden gems, deep neighborhood exploration, and niche discoveries flow naturally into the middle and later days \
once the traveler has oriented themselves and seen the city's identity.
2. EVERY DAY MUST BE A FULL DAY (10:00 → 19:00): A traveler's day is LONG — they didn't fly across the world to do 2 things and go back to the hotel. \
Each day needs 4-5 activities that FILL the day from morning to evening: \
10:00 morning activity → 12:30 lunch → 14:30 afternoon activity → 16:30 late afternoon activity → 19:00 dinner. \
Two 1-hour attractions alone do NOT make a day. If an attraction takes 1 hour, what does the traveler do for the other 8 hours? \
ALWAYS fill the gaps with nearby walks, cafés, viewpoints, markets, or neighborhoods to explore.
3. EMOTIONAL ARC — ARRIVE → EXPLORE → DISCOVER: \
Early days = the city's identity (iconic landmarks, recognizable views, the spots that define the destination). \
Middle days = deeper exploration (neighborhoods, local food, markets, cultural gems, lesser-known areas). \
Last day = something special and memorable (best viewpoint, farewell dinner, unique experience). \
The trip should feel like a natural progression from "wow, I'm here!" to "I really know this place".
4. REAL-WORLD LOGIC: A traveler's day starts at 10:00 (after hotel breakfast + getting ready), NOT 6am or 9am. Morning = main attractions (less crowded). Lunch = local restaurant nearby (12:30-14:00). Afternoon = explore/shopping. Evening = dinner + viewpoint/nightlife. Last activity ends by 20:00-21:00.
5. GEOGRAPHIC CLUSTERS (CRITICAL — THIS IS THE MOST IMPORTANT RULE):
   - ALL places on the same day MUST be within a reasonable area — walkable or a short drive (max 20-30 min between consecutive stops).
   - NEVER put places on opposite sides of the city on the same day. A traveler CANNOT visit Hollywood in the morning and then Venice Beach at noon and then Pasadena in the afternoon — that's hours of driving.
   - Think in NEIGHBORHOODS: pick a zone of the city for each day and stay there. Morning, lunch, afternoon, dinner — all in the same area.
   - If two places are in the same neighborhood, they MUST be on the same day.
   - If two places are far apart, they MUST be on DIFFERENT days.
   - A real traveler has limited time — wasting 2 hours in traffic between stops ruins the day.
6. FULL-DAY vs SHORT ACTIVITIES: Use your judgment. Theme parks, day trips, long hikes, safaris — these genuinely fill a whole day (set duration_minutes to 360-600). A boat tour, a market visit, a single museum — these take 1-3 hours and need to be paired with other activities to make a complete day.
7. STRATEGIC TIMING (THINK BEFORE PLACING — THIS IS CRITICAL):
   Before assigning a time slot, ASK YOURSELF: "When is the BEST moment to experience this place?"
   - Viewpoints, observation decks, bridges with views, waterfronts, rooftop bars → ALWAYS at SUNSET. \
     The Trocadéro at 10am is just a terrace. The Trocadéro at sunset with the Eiffel Tower glowing is MAGIC. \
     Estimate sunset time for the destination + month and schedule 1-2 hours before.
   - Museums, galleries → morning (10:00-12:00), fewer crowds, fresh energy
   - Markets, bakeries → mid-morning (10:00-11:00), freshest products, most lively
   - Parks, gardens, outdoor walks → afternoon (14:00-16:00), nice weather
   - Nightlife districts, bars → evening (20:00+)
   - Cafés → mid-morning break (11:00) or mid-afternoon break (15:30)
   - Churches, temples → early morning (fewer tourists) or late afternoon (golden light)
   - Beach/waterfront → any time, but sunset is always best for photos
   DO NOT just assign random times. Each place has a PERFECT moment — find it.
8. SMART PAIRING — Think like a local guide. What do experienced travelers do TOGETHER?
   Research what real travelers and travel blogs recommend as combinations:
   - Trocadéro → Eiffel Tower → Seine River Cruise (all in the same area, natural progression)
   - Colosseum → Roman Forum → Palatine Hill (same ticket, same zone, same morning)
   - Central Park → Metropolitan Museum → Upper East Side lunch (all walkable)
   - Shibuya Crossing → Hachiko Statue → Shibuya Sky → dinner in Shibuya (same neighborhood)
   - Viewpoint at sunset → dinner nearby with a view (the PERFECT evening combo)
   - Morning market visit → street food lunch at/near the market → afternoon neighborhood walk
   - Beach morning → seafood lunch by the water → coastal walk → sunset drinks
   THINK: "If I'm already at Place A, what is the OBVIOUS next thing to do nearby?" That's what goes next in the itinerary.

DESTINATION LANDMARKS ARE MANDATORY (THIS IS NON-NEGOTIABLE — READ THIS CAREFULLY):
Every destination has places that are SO iconic that skipping them would make the itinerary feel incomplete and amateur. \
These MUST be included even if the user's video/links don't mention them. A traveler who goes to a city and misses its \
most famous landmarks will blame the itinerary — and they'd be right.

Think: "If someone told me they went to [destination] and DIDN'T visit [landmark], I would say they missed the whole point."

Examples (apply this logic to ANY destination):
- Paris → Eiffel Tower, Louvre, Arc de Triomphe, Notre-Dame, Champs-Elysees, Montmartre/Sacre-Coeur
- Los Angeles → Hollywood Walk of Fame, Hollywood Sign viewpoint, Santa Monica Pier, Griffith Observatory, Universal Studios or Warner Bros
- Rome → Colosseum, Vatican/St Peter's, Trevi Fountain, Pantheon, Spanish Steps, Roman Forum
- Tokyo → Senso-ji, Shibuya Crossing, Meiji Shrine, Shinjuku, Akihabara, Tokyo Tower/Skytree
- New York → Statue of Liberty, Central Park, Times Square, Brooklyn Bridge, Empire State Building
- London → Big Ben, Tower Bridge, Buckingham Palace, British Museum, London Eye
- Barcelona → Sagrada Familia, Park Guell, La Rambla, Casa Batllo, Gothic Quarter
- Rio → Cristo Redentor, Pao de Acucar, Copacabana, Ipanema, Escadaria Selaron
- Dubai → Burj Khalifa, Dubai Mall, Palm Jumeirah, Dubai Marina, Gold Souk
- Istanbul → Hagia Sophia, Blue Mosque, Grand Bazaar, Topkapi Palace, Basilica Cistern, Galata Tower
- Bangkok → Grand Palace, Wat Pho, Wat Arun, Chatuchak Market, Khao San Road
- Lisbon → Torre de Belém, Mosteiro dos Jerónimos, Praça do Comércio, Alfama, Tram 28, Castelo de São Jorge

For ANY destination not listed above, use your knowledge as an expert traveler to identify the 5-8 places that DEFINE the city. \
These are the places that appear on every postcard, every travel guide, every "top things to do" list. INCLUDE THEM.

IMPORTANT: The link content is INSPIRATION, not the limit. If the video only talks about food, you STILL include the landmarks. \
If the video only shows one neighborhood, you STILL include the must-see attractions from other parts of the city. \
The traveler expects a COMPLETE trip, not a copy of one video.
{existing_info}
{profile_section}
{city_section}
{sources_info}
{places_section}
{preplanned_section}
╔═══════════════════════════════════════════════════════════════╗
║  WORKFLOW FOR THIS ITINERARY (FOLLOW IN ORDER)               ║
╚═══════════════════════════════════════════════════════════════╝
STEP 1 — ANCHOR THE LINK PLACES
   Look at the PLACES FROM USER'S LINKS section. Mentally locate each on a map of {destination}.
   Group them by NEIGHBORHOOD / PROXIMITY. Places in the same area = same day.

STEP 2 — ADD MANDATORY LANDMARKS
   Check the DESTINATION LANDMARKS list above. Any iconic landmark from {destination} that is
   NOT covered by the link places MUST be added. Place it on the day whose neighborhood matches.
   Never skip a top-5 landmark of the city because the video didn't mention it.

STEP 3 — FILL EACH DAY BY PROXIMITY (NOT BY THEME)
   For each day, pick ONE neighborhood/zone. Group all morning/lunch/afternoon/evening activities
   within that zone. Maximum walking/driving between consecutive stops: 20 minutes.
   Do NOT build a "beach day" with beaches from 3 different parts of town. Do NOT build a "food day"
   with restaurants scattered across the city.

STEP 4 — COMPLETE THE DAY (10:00 → 20:00)
   Each day needs 4-5 places filling morning → lunch → afternoon → late afternoon → dinner/viewpoint.
   Sunset viewpoints ALWAYS near the end of the day.

RULES RECAP:
- Every link place MUST appear in the final itinerary (unless there are >80% of slots worth of them).
- Every link place MUST have "source": "link".
- Every AI-added place MUST have "source": "ai".
- Same-day places MUST be in the same neighborhood/zone.
- Top landmarks of {destination} MUST be present even if the video didn't mention them.
- If there is a PRE-PLANNED ITINERARY section above, that structure has ABSOLUTE PRIORITY.

Return ONLY a JSON array with {total_slots} places across ALL {num_days} days (about 5 per day). Each object:
{{"day": <1-{num_days}>, "name": "Exact Place Name", "category": "restaurant|attraction|activity|shopping|cafe|nightlife|other", "time_slot": "10:00", "duration_minutes": 90, "description": "What makes this special + practical tip in Portuguese.", "notes": "Insider tip in Portuguese.", "vibe_tags": ["tag1", "tag2"], "alerts": ["alert text in Portuguese"], "alternative_group": null, "source": "link|ai"}}

PORTUGUESE LANGUAGE RULES (MANDATORY — apply to ALL text fields: description, notes, alerts):
- Write in PERFECT Brazilian Portuguese (pt-BR) with FLAWLESS grammar.
- ALWAYS use proper accents: á, é, í, ó, ú, â, ê, ô, ã, õ, à.
- ALWAYS use cedilla: ç (e.g., "praça", "recomendação", "começa").
- ALWAYS use proper punctuation: commas, periods, exclamation marks.
- Examples of CORRECT writing:
  ✓ "Chegue cedo para evitar filas — a vista do pôr do sol é imperdível."
  ✓ "Recomendação: peça o açaí na barraca à esquerda da entrada."
  ✓ "Praça icônica com arquitetura renascentista e músicos de rua à noite."
  ✗ NEVER write: "Praca iconica com arquitetura renascentista" (missing ç, ô)
  ✗ NEVER write: "Recomendacao: peca o acai" (missing ã, ç, í)
- Treat every text field as if it will be published in a professional travel guide.

SOURCE FIELD RULES:
1) Every place from PLACES FROM USER'S LINKS MUST have "source": "link". Use the EXACT name from that list.
2) Every place YOU add from your own knowledge MUST have "source": "ai".
3) If a place name matches or is clearly the same as one in the PLACES FROM USER'S LINKS list, it is "link" — not "ai".

EXAMPLE OF WHAT NOT TO DO:
❌ A day with only ONE short activity (e.g., a 90-min boat tour alone for the whole day). The traveler has nothing else to do!
✅ Combine that boat tour with a nearby neighborhood walk, a local restaurant, and an evening viewpoint — now it's a FULL day.

FULL-DAY vs SHORT ACTIVITIES — use your judgment:
Some activities genuinely fill a whole day (1-2 items is OK, add a dinner spot):
- Theme parks → duration_minutes: 480-600
- Day trips to another city → duration_minutes: 480-600
- Long hikes or nature excursions → duration_minutes: 360-480
- Safaris, beach/resort days → duration_minutes: 360-480
Short activities (under 3 hours — boat tours, markets, single museums) are NEVER a full day. Always pair with 2-3 other places.

HARD RULES:
- You MUST use ALL days from 1 to {num_days}.
- Normal days: 4-5 places per day. NEVER less than 3 unless the day has a full-day activity (duration_minutes >= 360).
- Day 1 MUST start with an iconic attraction that makes the traveler feel "I'm really here!" The first days should feature the destination's landmarks and recognizable spots. Hidden gems and deep local exploration fit naturally into the middle/later days.
- Include at least 1 restaurant/cafe per day for meals — travelers need to eat!

- Order within each day: morning activity → lunch spot → afternoon activity → evening (dinner/nightlife/viewpoint).
- The LAST day must also feel complete. Don't be lazy with the final day — make it memorable.
- PROXIMITY IS NON-NEGOTIABLE: Every place in a day must be reachable from the previous one by car in under 30 minutes or by walking in under 20 minutes. If you cannot guarantee this, move the place to a different day where it fits geographically. The traveler must be able to realistically complete ALL items in a single day without spending their entire day in traffic.
- vibe_tags: pick 1-3 from: instagramavel, hidden_gem, romantico, comida_de_rua, vida_noturna, familiar, cultural, ao_ar_livre, luxo, economico, historico, cafe_trabalho, vista_panoramica
- alerts: practical warnings in Portuguese like "Fechado nas segundas-feiras", "Reserva recomendada", "Chega cedo para evitar filas". Only add if relevant.
- alternative_group: when 2 similar options exist for the same time slot (e.g., two brunch places), give them the SAME group ID like "day1_morning_cafe". Most items should be null.

BEFORE RETURNING YOUR JSON — SELF-CHECK (MANDATORY):
1. Count: how many of {destination}'s top 5-8 iconic landmarks did you include? If fewer than 5 iconic landmarks → ADD MORE. This is the #1 quality metric.
2. A first-time visitor MUST see ALL the highlights. The user WILL judge the itinerary by whether the famous places are there.
3. Does each day have 4-5 items filling 10:00 → 19:00? If any day has fewer than 4 items, add more nearby places NOW.
4. Is there at least 1 restaurant/café per day? If not, add one.
5. Are viewpoints/rooftops scheduled at sunset? Fix if not.

Raw content from user's links (reference material — places are already listed above in PLACES FROM USER'S LINKS):
{content_text[:8000]}"""


def _optimize_day_proximity(place_list: list[dict]) -> list[dict]:
    """Reorder items within each day by geographic proximity (nearest-neighbor),
    and swap outliers between days if a place fits better geographically in another day.

    This ensures each day's itinerary is walkable/drivable without zigzagging.
    Max acceptable distance between consecutive items: 15km (~20 min drive).
    """
    if not place_list:
        return place_list

    # Group by day
    by_day: dict[int, list[dict]] = {}
    for p in place_list:
        d = p.get("day", 1)
        by_day.setdefault(d, []).append(p)

    # Step 1: Swap outliers between days
    # For each item, check if it's far from its day's centroid but close to another day's centroid
    MAX_SWAP_DISTANCE = 15  # km — if an item is >15km from its day centroid, consider swapping

    def _centroid(items):
        lats = [float(i["latitude"]) for i in items if i.get("latitude")]
        lngs = [float(i["longitude"]) for i in items if i.get("longitude")]
        if not lats:
            return None
        return (sum(lats) / len(lats), sum(lngs) / len(lngs))

    centroids = {}
    for d, items in by_day.items():
        c = _centroid(items)
        if c:
            centroids[d] = c

    swaps_made = 0
    for d in list(by_day.keys()):
        if d not in centroids:
            continue
        items = by_day[d]
        i = 0
        while i < len(items):
            item = items[i]
            lat = item.get("latitude")
            lng = item.get("longitude")
            if not lat or not lng:
                i += 1
                continue

            # NEVER move link-sourced items — they come from the user's planned itinerary
            if item.get("source") == "link":
                i += 1
                continue

            dist_to_own = _haversine_km(centroids[d][0], centroids[d][1], float(lat), float(lng))

            if dist_to_own > MAX_SWAP_DISTANCE:
                # Check if closer to another day
                best_day = d
                best_dist = dist_to_own
                for other_d, other_c in centroids.items():
                    if other_d == d:
                        continue
                    dist_other = _haversine_km(other_c[0], other_c[1], float(lat), float(lng))
                    if dist_other < best_dist and len(by_day.get(other_d, [])) < 6:
                        best_day = other_d
                        best_dist = dist_other

                if best_day != d:
                    moved = items.pop(i)
                    moved["day"] = best_day
                    by_day.setdefault(best_day, []).append(moved)
                    swaps_made += 1
                    logger.info(
                        "[proximity] Moved '%s' from day %d to day %d (%.1fkm → %.1fkm from centroid)",
                        moved.get("name"), d, best_day, dist_to_own, best_dist,
                    )
                    continue  # don't increment i — list shifted
            i += 1

    if swaps_made:
        logger.info("[proximity] Swapped %d items between days for better geographic clustering", swaps_made)

    # Step 2: Reorder items within each day using nearest-neighbor algorithm
    for d, items in by_day.items():
        geo_items = [i for i in items if i.get("latitude") and i.get("longitude")]
        if len(geo_items) < 2:
            continue

        # Start with the first item (usually the morning attraction)
        ordered = [geo_items[0]]
        remaining = geo_items[1:]

        while remaining:
            last = ordered[-1]
            last_lat = float(last["latitude"])
            last_lng = float(last["longitude"])

            # Find nearest unvisited
            nearest_idx = 0
            nearest_dist = float("inf")
            for idx, candidate in enumerate(remaining):
                dist = _haversine_km(
                    last_lat, last_lng,
                    float(candidate["latitude"]), float(candidate["longitude"]),
                )
                if dist < nearest_dist:
                    nearest_dist = dist
                    nearest_idx = idx

            ordered.append(remaining.pop(nearest_idx))

        # Add back items without coordinates at the end
        non_geo = [i for i in items if not i.get("latitude") or not i.get("longitude")]
        by_day[d] = ordered + non_geo

    # Rebuild flat list
    result = []
    for d in sorted(by_day.keys()):
        result.extend(by_day[d])

    return result


def _day_has_full_day_activity(items: list[dict]) -> bool:
    """Check if a day contains a full-day activity (theme park, day trip, etc.)."""
    return any(
        (item.get("duration_minutes") or 0) >= 360
        for item in items
    )


def _rebalance_days(place_list: list[dict], num_days: int) -> list[dict]:
    """Ensure every day has at least 4 places, unless it has a full-day activity."""
    if not place_list or num_days < 1:
        return place_list

    # Count items per day
    by_day: dict[int, list[dict]] = {}
    for p in place_list:
        d = p.get("day", 1)
        if d < 1 or d > num_days:
            d = 1
            p["day"] = d
        by_day.setdefault(d, []).append(p)

    # Find thin days, but SKIP days with full-day activities (theme parks, day trips, etc.)
    empty_days = [d for d in range(1, num_days + 1) if d not in by_day or len(by_day[d]) == 0]
    thin_days = [
        d for d in range(1, num_days + 1)
        if d in by_day and 0 < len(by_day[d]) < 4
        and not _day_has_full_day_activity(by_day[d])
    ]

    if not empty_days and not thin_days:
        return place_list  # Already balanced

    logger.warning(
        "[rebalance] Unbalanced itinerary detected: empty_days=%s thin_days=%s",
        empty_days, thin_days,
    )

    # Find days with excess items (>4) to steal from
    for problem_day in empty_days + thin_days:
        needed = 4 - len(by_day.get(problem_day, []))
        if needed <= 0:
            continue

        # Sort donor days by count (most items first)
        donors = sorted(
            [(d, items) for d, items in by_day.items() if len(items) > 4],
            key=lambda x: -len(x[1]),
        )

        for donor_day, donor_items in donors:
            if needed <= 0:
                break
            # Move items from end of donor day (lowest priority) to the thin day
            # NEVER move link-sourced items — they come from the user's planned itinerary
            while len(donor_items) > 4 and needed > 0:
                # Find the last AI-sourced item to move (preserve link items)
                move_idx = None
                for idx in range(len(donor_items) - 1, -1, -1):
                    if donor_items[idx].get("source") != "link":
                        move_idx = idx
                        break
                if move_idx is None:
                    break  # All remaining items are from links — don't move them
                moved = donor_items.pop(move_idx)
                moved["day"] = problem_day
                by_day.setdefault(problem_day, []).append(moved)
                needed -= 1

    # Rebuild flat list
    result = []
    for d in range(1, num_days + 1):
        result.extend(by_day.get(d, []))

    logger.info("[rebalance] After rebalancing: %s", {d: len(items) for d, items in by_day.items()})
    return result


async def _audit_landmark_coverage(
    place_list: list[dict],
    destination: str,
    num_days: int,
    cost: CostTracker,
) -> list[dict]:
    """Ask Haiku to identify missing top landmarks and return them as additional items.

    This is a lightweight safety net — a short, focused prompt that catches
    any iconic landmarks the main generation + verification steps missed.
    """
    if not place_list or not destination:
        return place_list

    place_names = [p.get("name", "") for p in place_list if p.get("name")]
    names_str = ", ".join(place_names)

    prompt = f"""You are a travel expert. Given this itinerary for {destination} with these places:
{names_str}

List the top iconic landmarks of {destination} that are MISSING from this itinerary.
These are places SO famous that a first-time visitor MUST see them — they appear on every postcard and travel guide.

If the itinerary already covers the main landmarks well, return an empty JSON array: []

If landmarks are missing, return a JSON array with up to 5 missing landmark objects:
[{{"day": <best_day_1_to_{num_days}>, "name": "Exact Place Name", "category": "attraction", "time_slot": "15:00", "duration_minutes": 90, "description": "Why this is unmissable (in Brazilian Portuguese with proper accents).", "notes": "Practical tip (in Brazilian Portuguese).", "vibe_tags": ["cultural", "instagramavel"], "alerts": [], "source": "ai"}}]

RULES:
- Only include places that are genuinely iconic and unmissable for {destination}.
- Assign each to the day (1-{num_days}) with the fewest items or best geographic fit.
- Write description and notes in PERFECT Brazilian Portuguese with accents (á, é, ã, ç, etc.).
- Return ONLY the JSON array, nothing else."""

    client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
    try:
        response = await asyncio.to_thread(
            lambda: client.messages.create(
                model="claude-haiku-4-5-20251001",
                max_tokens=4000,
                messages=[{"role": "user", "content": prompt}],
            )
        )
        cost.record_usage(response.usage)
        raw = response.content[0].text if response.content else "[]"
    except Exception as e:
        logger.warning("[audit] Landmark audit call failed, skipping: %s", e)
        return place_list

    parsed = _parse_json_response(raw)
    if not isinstance(parsed, list):
        logger.info("[audit] Landmark audit returned non-list, skipping")
        return place_list

    if len(parsed) == 0:
        logger.info("[audit] Landmark audit: coverage is adequate, no additions needed")
        return place_list

    # Cap at 5 additions
    additions = parsed[:5]

    # Validate additions have required fields
    valid_additions = []
    for item in additions:
        if isinstance(item, dict) and item.get("name") and item.get("day"):
            # Ensure day is within range
            day = item.get("day", 1)
            if day < 1 or day > num_days:
                item["day"] = 1
            # Ensure source is set
            item["source"] = "ai"
            valid_additions.append(item)

    if valid_additions:
        added_names = [a["name"] for a in valid_additions]
        logger.info("[audit] Adding %d missing landmarks: %s", len(valid_additions), added_names)
        place_list.extend(valid_additions)
    else:
        logger.info("[audit] No valid landmark additions")

    return place_list


async def _call_claude_for_itinerary(
    prompt: str, cost: CostTracker, expected_items: int = 0,
) -> list[dict] | None:
    """Call Claude Sonnet to generate the itinerary place list (Eco mode).

    Uses Sonnet for better instruction-following (fills all days, 4-5 items each).
    If the first attempt returns too few items (<60% of expected), retries once
    with an emphatic reminder.
    """
    client = anthropic.Anthropic(api_key=settings.anthropic_api_key)

    for attempt in range(2):
        try:
            messages = [{"role": "user", "content": prompt}]
            if attempt == 1:
                messages.append({"role": "assistant", "content": "["})
                messages[0]["content"] += (
                    "\n\nCRITICAL REMINDER: You MUST generate at least "
                    f"{expected_items} places across ALL days. "
                    "Every day needs 4-5 items. Do NOT cut short."
                )

            response = await asyncio.to_thread(
                lambda: client.messages.create(
                    model="claude-sonnet-4-20250514",
                    max_tokens=16000,
                    messages=messages,
                )
            )
            cost.record_usage(response.usage)
            raw = response.content[0].text if response.content else "[]"
        except Exception as e:
            logger.error("[eco] Claude itinerary call failed (attempt %d): %s", attempt + 1, e)
            if attempt == 0:
                continue
            return None

        parsed = _parse_json_response(raw)
        if isinstance(parsed, list):
            if expected_items > 0 and len(parsed) < expected_items * 0.6 and attempt == 0:
                logger.warning(
                    "[eco] Only %d items generated (expected %d), retrying...",
                    len(parsed), expected_items,
                )
                continue
            return parsed
        logger.error("[eco] Failed to parse Claude response as list. Raw (first 500 chars): %s", raw[:500])
        if attempt == 0:
            continue

    return None


# ──────────────────────────────────────────────
# PHASE 0: Extract content (shared by eco + pro)
# ──────────────────────────────────────────────


async def _extract_link(
    link_id: int, trip_id: int, url: str, platform: str, http_client=None,
) -> dict:
    """Phase 0: Extract content from this link only. No AI calls.

    Same for both eco and pro modes. The link is marked as 'extracted' when done.
    The Rails backend detects when ALL links are extracted and triggers Phase 1.
    """
    rails = RailsClient(client=http_client)
    cost = CostTracker(link_id=link_id)

    try:
        await rails.update_link(trip_id, link_id, status="processing")
    except Exception as e:
        logger.error("Failed to mark link %d as processing: %s", link_id, e)

    # Extract content from URL
    logger.info("[eco] Phase 0: Extracting content from %s", url)
    content_text = await _extract_content(url)

    if not content_text.strip():
        await _mark_failed(rails, trip_id, link_id, "No content extracted")
        return {"error": "No content", "places_created": 0}

    # Store extracted content and mark as "extracted"
    try:
        await rails.update_link(
            trip_id, link_id, status="extracted",
            extracted_data={"content_text": content_text[:8000]},
        )
    except Exception as e:
        logger.warning("Failed to store content for link %d: %s", link_id, e)
        await _mark_failed(rails, trip_id, link_id, f"Failed to store content: {e}")
        return {"error": str(e), "places_created": 0}

    logger.info("[eco] Phase 0 complete for link %d — content stored (%d chars)", link_id, len(content_text))
    return {"status": "extracted", "places_created": 0}


async def analyze_trip(trip_id: int, http_client=None) -> dict:
    """Phase 1: Aggregate ALL extracted content → ONE Haiku call for profile + cities.

    Called by Rails when all links are extracted, or manually via API.
    """
    rails = RailsClient(client=http_client)
    cost = CostTracker(link_id=0)

    try:
        trip = await rails.get_trip(trip_id)
    except Exception as e:
        logger.error("[analyze] Failed to fetch trip %d: %s", trip_id, e)
        return {"error": str(e)}

    destination = trip.get("destination", "")

    # Fetch all links and aggregate their content
    try:
        links = trip.get("links", [])
        if not links:
            # Try fetching links separately
            links = await rails.get_links(trip_id)
    except Exception as e:
        logger.error("[analyze] Failed to fetch links: %s", e)
        return {"error": str(e)}

    # Collect content from all extracted links
    content_parts = []
    for link in links:
        extracted = link.get("extracted_data") or {}
        ct = extracted.get("content_text", "")
        if ct:
            url = link.get("url", "unknown")
            content_parts.append(f"--- Source: {url} ---\n{ct}")

    if not content_parts:
        logger.warning("[analyze] No extracted content found for trip %d", trip_id)
        return {"error": "No extracted content"}

    combined_content = "\n\n".join(content_parts)
    logger.info("[analyze] Phase 1: Analyzing profile from %d sources (%d chars total)",
                len(content_parts), len(combined_content))

    # ONE Haiku call with all content combined
    profile = await _analyze_profile(combined_content, destination, cost)

    if profile:
        try:
            await rails.update_trip(trip_id, {
                "traveler_profile": profile,
                "profile_status": "suggested",
            })
        except Exception as e:
            logger.warning("[analyze] Failed to save profile: %s", e)
            return {"error": str(e)}

        logger.info("[analyze] Phase 1 complete — profile suggested, cities: %s",
                    profile.get("cities_detected", []))
        return {
            "status": "suggested",
            "profile": profile,
            "cost": cost.summary(),
        }
    else:
        # Profile analysis failed — auto-confirm with empty profile and build itinerary directly.
        # The AI can still build a good itinerary from extracted content alone.
        logger.warning("[analyze] Profile analysis failed for trip %d — auto-confirming and building itinerary", trip_id)
        try:
            await rails.update_trip(trip_id, {"profile_status": "confirmed"})
        except Exception:
            pass
        # Trigger itinerary generation immediately (don't leave user stuck)
        try:
            result = await build_trip_itinerary(trip_id, http_client)
            return {"status": "confirmed", "profile": None, "cost": cost.summary(), **result}
        except Exception as e:
            logger.error("[analyze] Auto-build failed for trip %d: %s", trip_id, e)
            return {"status": "confirmed", "profile": None, "cost": cost.summary()}


async def build_trip_itinerary(trip_id: int, http_client=None) -> dict:
    """Phase 2: Build ONE unified itinerary from all link content + confirmed profile.

    Called after user confirms profile (and optionally sets day distribution).
    """
    rails = RailsClient(client=http_client)
    places = GooglePlacesClient(http_client=http_client)
    cost = CostTracker(link_id=0)

    try:
        trip = await rails.get_trip(trip_id)
        day_plans_raw = await rails.get_day_plans(trip_id)
    except Exception as e:
        logger.error("[build] Failed to fetch trip %d: %s", trip_id, e)
        return {"error": str(e), "places_created": 0}

    day_plans = []
    existing_items = []
    for dp in day_plans_raw:
        day_plans.append({
            "id": dp["id"],
            "day_number": dp["day_number"],
            "date": dp.get("date"),
            "city": dp.get("city"),
        })
        for item in dp.get("itinerary_items", []):
            existing_items.append(item.get("name", ""))

    if not day_plans:
        return {"error": "No day plans", "places_created": 0}

    # Apply day distribution if provided (stored in traveler_profile.day_distribution)
    profile = trip.get("traveler_profile") or {}
    day_distribution = profile.get("day_distribution")
    if day_distribution and isinstance(day_distribution, dict):
        await _assign_cities_to_days(rails, trip_id, day_plans, day_distribution)
        # Refresh day_plans after city assignment
        day_plans_raw = await rails.get_day_plans(trip_id)
        day_plans = []
        for dp in day_plans_raw:
            day_plans.append({
                "id": dp["id"],
                "day_number": dp["day_number"],
                "date": dp.get("date"),
                "city": dp.get("city"),
            })

    # Aggregate content from ALL links
    links = trip.get("links", [])
    if not links:
        try:
            links = await rails.get_links(trip_id)
        except Exception:
            links = []

    content_parts = []
    source_urls = []
    for link in links:
        extracted = link.get("extracted_data") or {}
        ct = extracted.get("content_text", "")
        if ct:
            url = link.get("url", "")
            content_parts.append(f"--- Source: {url} ---\n{ct}")
            source_urls.append(url)

    combined_content = "\n\n".join(content_parts) if content_parts else ""

    if not combined_content:
        return {"error": "No content available", "places_created": 0}

    logger.info("[build] Phase 2: Building unified itinerary (%d sources, %d chars, %d days, mode=%s)",
                len(content_parts), len(combined_content), len(day_plans), trip.get("ai_mode", "eco"))

    ai_mode = trip.get("ai_mode", "eco")

    if ai_mode == "pro":
        # Pro mode: agentic loop with tools (validate_places, create_batch_items)
        result = await _build_itinerary_pro(
            trip, day_plans, existing_items, combined_content, source_urls,
            rails, places, cost, trip_id,
        )
    else:
        # Eco mode: ONE structured Sonnet call
        result = await _build_itinerary_eco(
            trip, day_plans, existing_items, combined_content, source_urls,
            links, rails, places, cost, trip_id,
        )

    if "error" in result and result.get("places_created", 0) == 0:
        # Log failure but do NOT overwrite extracted_data (preserves content_text for retries)
        logger.error("[build] Itinerary generation failed for trip %d: %s", trip_id, result["error"])
        return result

    # Mark all extracted/processing links as processed (preserve content_text!)
    for link in links:
        link_status = link.get("status", "")
        if link_status in ("extracted", "processing"):
            try:
                # Merge result into existing extracted_data to preserve content_text
                existing_data = link.get("extracted_data") or {}
                merged_data = {**existing_data, **result}
                await rails.update_link(trip_id, link["id"], status="processed",
                                        extracted_data=merged_data)
            except Exception as e:
                logger.warning("Failed to mark link %d as processed: %s", link["id"], e)

    logger.info("[build] Trip %d done: %d places, ~$%.4f",
                trip_id, result["places_created"], cost.total_cost)
    return result


# ──────────────────────────────────────────────
# RESUME: Called after user confirms profile
# (now triggers unified itinerary build for whole trip)
# ──────────────────────────────────────────────


async def resume_processing(
    link_id: int, trip_id: int, http_client=None,
) -> dict:
    """Phase 2 entry point — called after user confirms profile.

    Now builds ONE unified itinerary for the entire trip, not per-link.
    link_id is kept for API compatibility but the build is trip-wide.
    """
    return await build_trip_itinerary(trip_id, http_client)


# ──────────────────────────────────────────────
# PHASE 2 — ECO: Structured Sonnet output
# ──────────────────────────────────────────────


async def _verify_and_optimize_itinerary(
    place_list: list[dict],
    trip: dict,
    day_plans: list[dict],
    cost: CostTracker,
) -> list[dict]:
    """Post-generation verification: optimize timing, grouping, and pacing via Haiku."""
    if not place_list:
        return place_list

    from app.ai.prompts import build_verification_prompt

    destination = trip.get("destination", "")
    profile = trip.get("traveler_profile") or {}

    prompt = build_verification_prompt(place_list, destination, day_plans, profile)

    client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
    try:
        response = await asyncio.to_thread(
            lambda: client.messages.create(
                model="claude-haiku-4-5-20251001",
                max_tokens=16000,
                messages=[{"role": "user", "content": prompt}],
            )
        )
        cost.record_usage(response.usage)
        raw = response.content[0].text if response.content else "[]"
    except Exception as e:
        logger.warning("[verify] Verification call failed, using original: %s", e)
        return place_list

    parsed = _parse_json_response(raw)
    if isinstance(parsed, list) and len(parsed) >= len(place_list) * 0.8 and len(parsed) <= len(place_list) + 8:
        logger.info("[verify] Verification optimized %d → %d items", len(place_list), len(parsed))
        return parsed

    logger.warning("[verify] Verification returned invalid result (%s items vs %d original), using original",
                   len(parsed) if isinstance(parsed, list) else "non-list", len(place_list))
    return place_list


async def _build_itinerary_eco(
    trip: dict,
    day_plans: list[dict],
    existing_items: list[str],
    combined_content: str,
    source_urls: list[str],
    links: list[dict],
    rails: RailsClient,
    places: GooglePlacesClient,
    cost: CostTracker,
    trip_id: int,
) -> dict:
    """Eco Phase 2: ONE structured Sonnet call → JSON place list → verify → validate + create."""
    profile = trip.get("traveler_profile") or {}
    places_mentioned = profile.get("places_mentioned", [])
    day_plans_from_links = profile.get("day_plans_from_links", [])
    prompt = _build_itinerary_prompt(
        combined_content, trip, day_plans, existing_items,
        source_urls, places_mentioned, day_plans_from_links,
    )
    expected_items = len(day_plans) * 5
    place_list = await _call_claude_for_itinerary(prompt, cost, expected_items=expected_items)

    if not place_list:
        return {"error": "Itinerary generation failed", "places_created": 0}

    logger.info("[eco] Claude generated %d places (expected %d)", len(place_list), expected_items)

    # Force-tag sources programmatically (Claude often ignores the instruction)
    place_list = _tag_sources_from_links(place_list, places_mentioned)

    # Safety net: inject any link places Claude dropped
    place_list = _ensure_link_places_present(place_list, places_mentioned, day_plans)

    place_list = _rebalance_days(place_list, len(day_plans))

    # Verification step: optimize timing, proximity grouping, and landmark injection
    place_list = await _verify_and_optimize_itinerary(place_list, trip, day_plans, cost)

    # Safety net: focused landmark audit catches any remaining gaps
    destination = trip.get("destination", "a destination")
    place_list = await _audit_landmark_coverage(place_list, destination, len(day_plans), cost)

    return await _validate_and_create_items(
        place_list, trip, day_plans, rails, places, cost, trip_id, source_urls,
    )


# ──────────────────────────────────────────────
# PHASE 2 — PRO: Agentic loop with tools
# ──────────────────────────────────────────────


async def _build_itinerary_pro(
    trip: dict,
    day_plans: list[dict],
    existing_items: list[str],
    combined_content: str,
    source_urls: list[str],
    rails: RailsClient,
    places: GooglePlacesClient,
    cost: CostTracker,
    trip_id: int,
) -> dict:
    """Pro Phase 2: Agentic Sonnet loop with validate_places + create_batch tools.

    Uses the TravelAgent with a unified prompt that includes:
    - All aggregated content from extracted links
    - Confirmed traveler profile (style, pace, interests)
    - City day distribution (which days → which city)
    """
    from app.ai.prompts import build_unified_prompt

    profile = trip.get("traveler_profile") or {}
    places_mentioned = profile.get("places_mentioned", [])
    day_plans_from_links = profile.get("day_plans_from_links", [])
    destination = trip.get("destination", "")

    # Get destination coordinates for geographic validation
    dest_coords = await _get_destination_coords(destination, places)
    cities_in_plans = set()
    for dp in day_plans:
        c = dp.get("city")
        if c:
            cities_in_plans.add(c)
    max_dist = 300 if len(cities_in_plans) > 1 else 150

    handlers = ToolHandlers(
        rails_client=rails,
        places_client=places,
        places_mentioned=places_mentioned,
        destination=destination,
        destination_coords=dest_coords,
        max_distance_km=max_dist,
    )
    agent = TravelAgent(
        tool_handlers=handlers,
        cost_tracker=cost,
        model="claude-sonnet-4-20250514",
        max_turns=15,
    )

    try:
        result = await agent.build_itinerary(
            trip_id=trip_id,
            trip_name=trip.get("name", ""),
            trip_destination=trip.get("destination"),
            day_plans=day_plans,
            existing_items=existing_items,
            combined_content=combined_content,
            profile=profile,
            source_urls=source_urls,
            places_mentioned=places_mentioned,
            day_plans_from_links=day_plans_from_links,
        )
    except Exception as e:
        logger.error("[pro] Agent itinerary build failed: %s", e)
        return {"error": str(e), "places_created": 0}

    return result


# ──────────────────────────────────────────────
# REFINE ITINERARY — User Feedback
# ──────────────────────────────────────────────


async def refine_itinerary(
    trip_id: int,
    feedback: str,
    scope: str = "trip",
    day_plan_id: int | None = None,
    http_client=None,
) -> dict:
    """Refine existing itinerary based on user feedback.

    scope="trip": regenerate all days based on feedback
    scope="day": regenerate only the specified day_plan_id
    """
    rails = RailsClient(client=http_client)
    places = GooglePlacesClient(http_client=http_client)
    cost = CostTracker(link_id=0)

    try:
        trip = await rails.get_trip(trip_id)
        day_plans_raw = await rails.get_day_plans(trip_id)
    except Exception as e:
        logger.error("[refine] Failed to fetch trip %d: %s", trip_id, e)
        return {"error": str(e), "places_created": 0}

    # Build day plan info with existing items
    day_plans = []
    for dp in day_plans_raw:
        day_plans.append({
            "id": dp["id"],
            "day_number": dp["day_number"],
            "date": dp.get("date"),
            "city": dp.get("city"),
            "itinerary_items": dp.get("itinerary_items", []),
        })

    # Get original link content for context
    links = trip.get("links", [])
    if not links:
        try:
            links = await rails.get_links(trip_id)
        except Exception:
            links = []

    content_parts = []
    source_urls = []
    for link in links:
        extracted = link.get("extracted_data") or {}
        ct = extracted.get("content_text", "")
        if ct:
            url = link.get("url", "")
            content_parts.append(f"--- Source: {url} ---\n{ct}")
            source_urls.append(url)
    combined_content = "\n\n".join(content_parts) if content_parts else ""

    profile = trip.get("traveler_profile") or {}
    places_mentioned = profile.get("places_mentioned", [])
    destination = trip.get("destination", "a destination")

    # Determine which days to refine
    if scope == "day" and day_plan_id:
        target_days = [dp for dp in day_plans if dp["id"] == day_plan_id]
        keep_days = [dp for dp in day_plans if dp["id"] != day_plan_id]
    else:
        target_days = day_plans
        keep_days = []

    if not target_days:
        return {"error": "No matching day plan found", "places_created": 0}

    # Build context of what to keep (for day-level, show other days as context)
    keep_context = ""
    if keep_days:
        keep_lines = []
        for dp in keep_days:
            items = dp.get("itinerary_items", [])
            item_names = [f"  - {it.get('name', '?')} ({it.get('category', '?')}, {it.get('time_slot', '?')})" for it in items]
            keep_lines.append(f"Day {dp['day_number']} (KEEP — do not change):\n" + "\n".join(item_names))
        keep_context = "\n".join(keep_lines)

    # Build context of current items in target days
    current_items_text = ""
    current_lines = []
    for dp in target_days:
        items = dp.get("itinerary_items", [])
        item_names = [f"  - {it.get('name', '?')} ({it.get('category', '?')}, {it.get('time_slot', '?')}, source: {it.get('source', 'ai')})" for it in items]
        current_lines.append(f"Day {dp['day_number']} (REFINE based on feedback):\n" + "\n".join(item_names))
    current_items_text = "\n".join(current_lines)

    # Places from links section
    places_section = ""
    if places_mentioned:
        place_lines = [f"- {p['name']}" for p in places_mentioned]
        places_section = f"""
PLACES FROM USER'S LINKS (preserve these when possible — tag as source: "link"):
{chr(10).join(place_lines)}
"""

    num_target_days = len(target_days)
    total_items_needed = num_target_days * 5

    # Build the refine prompt
    prompt = f"""You are an expert travel planner. The user already has an itinerary for {destination} but wants changes based on their feedback.

USER'S FEEDBACK:
"{feedback}"

CURRENT ITINERARY (items to REFINE):
{current_items_text}

{"DAYS TO KEEP UNCHANGED (for context only):" + chr(10) + keep_context if keep_context else ""}

TRAVELER PROFILE:
- Style: {profile.get('travel_style', '')}
- Interests: {', '.join(profile.get('interests', []))}
- Pace: {profile.get('pace', 'moderate')}
{places_section}

INSTRUCTIONS:
1. Read the user's feedback carefully. They may like some items and dislike others.
2. KEEP items the user explicitly says they like or that align with their feedback.
3. REPLACE items that don't match their feedback with better alternatives.
4. If the user gives general feedback (e.g., "more restaurants", "less museums"), apply it intelligently across the affected days.
5. Maintain 4-5 items per day, geographic clustering, and time flow (morning → lunch → afternoon → evening).
6. **LINK CONTENT HAS PRIORITY**: Places from the user's links (source: "link") must be KEPT and must STAY on their assigned day. Their day assignment comes from the user's pre-planned itinerary from video/link content. NEVER remove or move link-sourced places to a different day unless the user EXPLICITLY asks for it. Only replace AI-sourced places when making changes.

Return ONLY a JSON array with replacement items for the affected days. Each object:
{{"day": <day_number>, "name": "Exact Place Name", "category": "restaurant|attraction|activity|shopping|cafe|nightlife|other", "time_slot": "09:00", "duration_minutes": 90, "description": "Why this is great + practical tip in Portuguese.", "notes": "Insider tip in Portuguese.", "vibe_tags": ["tag1", "tag2"], "alerts": ["alert if relevant"], "source": "link|ai"}}

Generate approximately {total_items_needed} items across {num_target_days} day(s).
Day numbers to use: {', '.join(str(dp['day_number']) for dp in target_days)}.

PORTUGUESE GRAMMAR (MANDATORY): ALL text fields (description, notes, alerts) MUST use PERFECT Brazilian Portuguese (pt-BR) with proper accents (á, é, í, ó, ú, â, ê, ô, ã, õ, à), cedilla (ç), and punctuation. NEVER omit accents.

{"Original link content (for reference):" + chr(10) + combined_content[:4000] if combined_content else ""}"""

    # Call Claude
    place_list = await _call_claude_for_itinerary(prompt, cost, expected_items=total_items_needed)

    if not place_list:
        return {"error": "Refine generation failed", "places_created": 0}

    logger.info("[refine] Claude generated %d replacement places", len(place_list))

    # Force-tag sources programmatically
    place_list = _tag_sources_from_links(place_list, places_mentioned)
    place_list = _ensure_link_places_present(place_list, places_mentioned, target_days)

    # Delete existing items in target days
    deleted = 0
    for dp in target_days:
        for item in dp.get("itinerary_items", []):
            try:
                await rails.delete_itinerary_item(trip_id, dp["id"], item["id"])
                deleted += 1
            except Exception as e:
                logger.warning("[refine] Failed to delete item %s: %s", item.get("name"), e)

    logger.info("[refine] Deleted %d existing items in target days", deleted)

    # Create new items (reuse existing validation + creation logic)
    result = await _validate_and_create_items(
        place_list, trip, day_plans, rails, places, cost, trip_id, source_urls,
    )

    return result


# ──────────────────────────────────────────────

async def _mark_failed(rails: RailsClient, trip_id: int, link_id: int, error_message: str):
    try:
        await rails.update_link(trip_id, link_id, status="failed", extracted_data={"error": error_message})
    except Exception as e:
        logger.error("Failed to mark link %d as failed: %s", link_id, e)
