"""Pydantic models pin the shape of objects returned by RailsClient.
Today RailsClient returns plain dicts, so callers do `trip.get("ai_mode")`
and silently get None when a field is renamed/removed. With these
models, a field rename surfaces as a Pydantic ValidationError at
parse-time — an audible error, not a silent None."""
from __future__ import annotations

import pytest


def test_trip_schema_accepts_minimal_payload():
    from app.services.rails_schemas import TripSchema
    trip = TripSchema.model_validate({
        "id": 1,
        "name": "X",
        "destination": "Paris",
        "num_days": 5,
        "status": "active",
        "ai_mode": "manual",
        "profile_status": "confirmed",
    })
    assert trip.id == 1
    assert trip.ai_mode == "manual"


def test_trip_schema_rejects_invalid_ai_mode():
    from app.services.rails_schemas import TripSchema
    from pydantic import ValidationError
    with pytest.raises(ValidationError):
        TripSchema.model_validate({
            "id": 1, "name": "X", "destination": "Paris", "num_days": 5,
            "status": "active", "ai_mode": "ai_assist_manual",  # not in enum
            "profile_status": "confirmed",
        })


def test_itinerary_item_schema_normalizes_category():
    from app.services.rails_schemas import ItineraryItemSchema
    from pydantic import ValidationError
    with pytest.raises(ValidationError):
        ItineraryItemSchema.model_validate({
            "id": 1,
            "name": "X",
            "category": "place",  # not in CATEGORY_OPTIONS
            "origin": "extracted_from_video",
        })


def test_itinerary_item_schema_optional_geo():
    from app.services.rails_schemas import ItineraryItemSchema
    item = ItineraryItemSchema.model_validate({
        "id": 1, "name": "X", "category": "attraction",
        "origin": "extracted_from_video",
    })
    assert item.latitude is None
    assert item.longitude is None
