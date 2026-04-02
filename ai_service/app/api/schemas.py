from __future__ import annotations

from pydantic import BaseModel


class ProcessLinkRequest(BaseModel):
    link_id: int
    trip_id: int
    url: str
    platform: str
    ai_mode: str = "eco"  # "eco" (Haiku) or "pro" (Sonnet)


class ProcessLinkResponse(BaseModel):
    status: str
    message: str


class LinkStatusResponse(BaseModel):
    link_id: int
    status: str
    extracted_data: dict | None = None
    processing_meta: dict | None = None


class ResumeLinkRequest(BaseModel):
    trip_id: int


class RefineItineraryRequest(BaseModel):
    trip_id: int
    feedback: str
    scope: str = "trip"  # "trip" or "day"
    day_plan_id: int | None = None  # required when scope="day"


class HealthResponse(BaseModel):
    status: str
    service: str


class AnalyzeUrlRequest(BaseModel):
    urls: list[str]

class PlaceInfo(BaseModel):
    name: str
    address: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    rating: float | None = None
    reviews_count: int | None = None
    website: str | None = None
    phone: str | None = None
    google_maps_url: str | None = None
    operating_hours: dict | None = None
    pricing: str | None = None
    photos: list[str] = []
    types: list[str] = []
    description: str | None = None
    source_url: str | None = None

class AnalyzeUrlResponse(BaseModel):
    places: list[PlaceInfo] = []
    destination: str | None = None
    summary: str | None = None
    error: str | None = None
