"""Single source of truth for Rails-side contracts that the Python
orchestrator must respect when posting payloads.

Why this exists: trip 41 spent a night silently 422'ing every
ai-assist insert because the Python side sent `origin="ai_assist_manual"`
(not in Rails ORIGINS) and `category="place"` (not in CATEGORY_OPTIONS).
Mirroring those constants here + asserting in tests means the same
class of bug surfaces as a unit test failure, not a silent prod 422.

The constants are kept in sync via test_rails_contract.py — that suite
re-reads the Rails source files on every CI run and asserts the sets
match. Adding a new value on the Rails side without updating here
fails the build.
"""
from __future__ import annotations

# Rails: ItineraryItem::CATEGORY_OPTIONS
ITINERARY_ITEM_CATEGORIES: set[str] = {
    "restaurant", "attraction", "hotel", "transport", "activity",
    "shopping", "cafe", "nightlife", "other",
}

# Rails: ItineraryItem::ORIGINS
ITINERARY_ITEM_ORIGINS: set[str] = {
    "extracted_from_video", "ai_suggested", "user_added",
}

# Rails: DayPlan::ORIGINS
DAY_PLAN_ORIGINS: set[str] = {"from_video", "ai_created", "user_edited"}

# Rails: itinerary_items_controller.rb item_params permit list. Anything
# outside this set will trigger "Unpermitted parameters" warnings AND
# get silently dropped from the payload before validation runs.
ITINERARY_ITEM_PERMITTED_FIELDS: set[str] = {
    "name", "description", "category", "time_slot", "duration_minutes",
    "position", "latitude", "longitude", "address", "google_place_id",
    "google_rating", "google_reviews_count", "pricing_info", "phone",
    "website", "notes", "source_url", "personal_notes",
    "alternative_group", "source", "origin", "source_video_url",
    "source_video_creator", "extraction_method", "priority",
    "item_status", "best_turn", "region", "activity_model",
    "visit_mode", "item_role", "operating_hours", "photos", "vibe_tags",
    "alerts",
}


def assert_itinerary_item_payload(payload: dict) -> None:
    """Raise AssertionError if `payload` violates any Rails contract:
    unknown field, invalid enum value, missing required field. Used by
    tests + can be called defensively in development.
    """
    if not isinstance(payload, dict):
        raise AssertionError(f"payload must be a dict, got {type(payload)}")
    extras = set(payload.keys()) - ITINERARY_ITEM_PERMITTED_FIELDS
    if extras:
        raise AssertionError(
            f"itinerary_item payload contains fields not in Rails permit list: {sorted(extras)}"
        )
    cat = payload.get("category")
    if cat is not None and cat not in ITINERARY_ITEM_CATEGORIES:
        raise AssertionError(
            f"itinerary_item.category={cat!r} not in {sorted(ITINERARY_ITEM_CATEGORIES)}"
        )
    origin = payload.get("origin")
    if origin is not None and origin not in ITINERARY_ITEM_ORIGINS:
        raise AssertionError(
            f"itinerary_item.origin={origin!r} not in {sorted(ITINERARY_ITEM_ORIGINS)}"
        )


# Rails: trips_controller.rb trip_params permit list. Extends
# ITINERARY_ITEM_PERMITTED_FIELDS protection to the parent Trip
# resource — every PATCH /trips/:id payload the AI service builds
# (e.g. update_trip with traveler_profile) must comply.
TRIP_PERMITTED_FIELDS: set[str] = {
    "ai_mode", "destination", "is_staging", "name", "num_days",
    "profile_status", "status", "traveler_profile",
}

# Rails: day_plans_controller.rb day_plan_params permit list.
DAY_PLAN_PERMITTED_FIELDS: set[str] = {
    "city", "conflict_alerts", "date", "day_number", "day_type",
    "estimated_pace", "notes", "origin", "pattern_signature",
    "primary_region", "rigidity", "source_creator_handle",
    "source_video_url",
}

# Rails: links_controller.rb link_update_params permit list. The OTHER
# permit list (link_params, just :url) is for the create action and not
# something the AI service ever touches.
LINK_UPDATE_PERMITTED_FIELDS: set[str] = {"extracted_data", "status"}


def assert_trip_payload(payload: dict) -> None:
    """Same defensive check as assert_itinerary_item_payload but for
    Trip-level updates. Catches frontend or AI-service code that tries
    to PATCH a field outside the Trip permit list."""
    if not isinstance(payload, dict):
        raise AssertionError(f"payload must be a dict, got {type(payload)}")
    extras = set(payload.keys()) - TRIP_PERMITTED_FIELDS
    if extras:
        raise AssertionError(
            f"trip payload contains fields not in Rails permit list: {sorted(extras)}"
        )


def assert_day_plan_payload(payload: dict) -> None:
    if not isinstance(payload, dict):
        raise AssertionError(f"payload must be a dict, got {type(payload)}")
    extras = set(payload.keys()) - DAY_PLAN_PERMITTED_FIELDS
    if extras:
        raise AssertionError(
            f"day_plan payload contains fields not in Rails permit list: {sorted(extras)}"
        )
