"""Pydantic models for the dict shapes RailsClient returns. Replaces
ad-hoc dict access (`trip.get("ai_mode") or "manual"`) with parsed
typed objects that raise loudly when the shape changes.

Tied to the rails_contract enums — same validation surface. When Rails
adds a new enum value or field, both files must be updated and the
meta-test in test_rails_contract.py catches drift.
"""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

from app.services.rails_contract import (
    ITINERARY_ITEM_CATEGORIES,
    ITINERARY_ITEM_ORIGINS,
)


# Build Literal types from the contract sets so a Rails enum addition
# requires touching exactly one file (rails_contract.py).
_CategoryLiteral = Literal[tuple(sorted(ITINERARY_ITEM_CATEGORIES))]  # type: ignore[valid-type]
_OriginLiteral = Literal[tuple(sorted(ITINERARY_ITEM_ORIGINS))]  # type: ignore[valid-type]
_AiModeLiteral = Literal["eco", "pro", "manual"]


class TripSchema(BaseModel):
    """Mirror of the Rails Trip model + serializer output we actually
    consume in the AI service. NOT a complete mirror — just the fields
    orchestrator.py reads. Adding a new read site means adding the
    field here so the mismatch surfaces as a ValidationError."""
    model_config = ConfigDict(extra="ignore")  # tolerate extra fields

    id: int
    name: str
    destination: Optional[str] = None
    num_days: int
    status: str
    ai_mode: _AiModeLiteral
    profile_status: Optional[str] = None
    is_staging: bool = False
    traveler_profile: dict = Field(default_factory=dict)


class ItineraryItemSchema(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: Optional[int] = None
    name: str
    category: Optional[_CategoryLiteral] = None
    origin: _OriginLiteral
    source_url: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    address: Optional[str] = None
    google_place_id: Optional[str] = None
    google_rating: Optional[float] = None
    google_reviews_count: Optional[int] = None
    duration_minutes: Optional[int] = None
    time_slot: Optional[str] = None
    position: Optional[int] = None
