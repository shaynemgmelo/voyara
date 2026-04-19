from __future__ import annotations

import asyncio
import logging

from fastapi import APIRouter, BackgroundTasks

from app.api.schemas import (
    AnalyzeUrlRequest,
    AnalyzeUrlResponse,
    ChatRequest,
    ChatResponse,
    HealthResponse,
    LinkStatusResponse,
    ProcessLinkRequest,
    ProcessLinkResponse,
    RefineItineraryRequest,
    ResumeLinkRequest,
)
from app.services.chat_service import chat_reply
from app.services.orchestrator import (
    analyze_urls,
    process_link,
    resume_processing,
    analyze_trip,
    build_trip_itinerary,
    refine_itinerary,
)

logger = logging.getLogger(__name__)
router = APIRouter()

# In-memory status tracking (use Redis in production)
processing_status: dict[int, dict] = {}


@router.get("/health", response_model=HealthResponse)
async def health():
    return HealthResponse(status="ok", service="Mapass AI Service")


@router.post("/chat", response_model=ChatResponse)
async def handle_chat(request: ChatRequest):
    """Conversational assistant — optionally grounded on a trip."""
    logger.info(
        "Chat request: trip_id=%s msg_len=%d history=%d",
        request.trip_id,
        len(request.message),
        len(request.history),
    )
    try:
        reply = await chat_reply(
            message=request.message,
            history=request.history,
            trip_id=request.trip_id,
        )
        return ChatResponse(reply=reply)
    except Exception as e:
        logger.exception("Chat failed")
        return ChatResponse(
            reply="Tive um problema agora. Tenta de novo em instantes?",
            error=str(e),
        )


@router.post("/analyze-url", response_model=AnalyzeUrlResponse)
async def handle_analyze_url(request: AnalyzeUrlRequest):
    """Analyze URLs and return place info without creating database records.

    This is the lightweight 'Learn more' endpoint — purely stateless.
    Synchronous because it typically takes 5-10 seconds.
    """
    logger.info("Received analyze-url request: %d URL(s)", len(request.urls))

    try:
        result = await analyze_urls(request.urls)
        return AnalyzeUrlResponse(**result)
    except Exception as e:
        logger.exception("Failed to analyze URLs")
        return AnalyzeUrlResponse(error=str(e))


@router.post("/process-link", response_model=ProcessLinkResponse, status_code=202)
async def handle_process_link(
    request: ProcessLinkRequest, background_tasks: BackgroundTasks
):
    logger.info(
        "Received link for processing: link_id=%d url=%s", request.link_id, request.url
    )

    processing_status[request.link_id] = {
        "status": "queued",
        "url": request.url,
    }

    background_tasks.add_task(
        _process_link_background,
        request.link_id,
        request.trip_id,
        request.url,
        request.platform,
        request.ai_mode,
    )

    return ProcessLinkResponse(
        status="accepted",
        message=f"Link {request.link_id} queued for processing",
    )


@router.get("/status/{link_id}", response_model=LinkStatusResponse)
async def get_status(link_id: int):
    status = processing_status.get(link_id)
    if not status:
        return LinkStatusResponse(link_id=link_id, status="unknown")

    return LinkStatusResponse(
        link_id=link_id,
        status=status.get("status", "unknown"),
        extracted_data=status.get("extracted_data"),
        processing_meta=status.get("processing_meta"),
    )


@router.post("/analyze-trip/{trip_id}", response_model=ProcessLinkResponse, status_code=202)
async def handle_analyze_trip(
    trip_id: int, background_tasks: BackgroundTasks
):
    """Phase 1: Aggregate all extracted content and analyze traveler profile.

    Called by Rails when all links are extracted, or manually.
    """
    logger.info("Received analyze-trip request for trip_id=%d", trip_id)

    background_tasks.add_task(_analyze_trip_background, trip_id)

    return ProcessLinkResponse(
        status="accepted",
        message=f"Analyzing trip {trip_id} profile",
    )


@router.post("/resume-processing/{link_id}", response_model=ProcessLinkResponse, status_code=202)
async def handle_resume_processing(
    link_id: int, request: ResumeLinkRequest, background_tasks: BackgroundTasks
):
    """Phase 2: Build unified itinerary after profile confirmation."""
    logger.info("Resuming processing for trip_id=%d (via link_id=%d)", request.trip_id, link_id)

    background_tasks.add_task(
        _build_itinerary_background, request.trip_id
    )

    return ProcessLinkResponse(
        status="accepted",
        message=f"Building itinerary for trip {request.trip_id}",
    )


@router.post("/refine-itinerary", response_model=ProcessLinkResponse, status_code=202)
async def handle_refine_itinerary(
    request: RefineItineraryRequest, background_tasks: BackgroundTasks
):
    """Refine existing itinerary based on user feedback (trip-level or day-level)."""
    logger.info(
        "Refine request: trip_id=%d scope=%s feedback='%s'",
        request.trip_id, request.scope, request.feedback[:80],
    )

    background_tasks.add_task(
        _refine_itinerary_background,
        request.trip_id,
        request.feedback,
        request.scope,
        request.day_plan_id,
    )

    return ProcessLinkResponse(
        status="accepted",
        message=f"Refining itinerary for trip {request.trip_id}",
    )


async def _refine_itinerary_background(
    trip_id: int, feedback: str, scope: str, day_plan_id: int | None
):
    try:
        result = await refine_itinerary(trip_id, feedback, scope, day_plan_id)
        logger.info(
            "[refine] Trip %d: %d places created",
            trip_id, result.get("places_created", 0),
        )
    except Exception as e:
        logger.exception("Failed to refine itinerary for trip %d", trip_id)


async def _analyze_trip_background(trip_id: int):
    try:
        result = await analyze_trip(trip_id)
        logger.info("[analyze-trip] Trip %d: %s", trip_id, result.get("status", "unknown"))
    except Exception as e:
        logger.exception("Failed to analyze trip %d", trip_id)


async def _build_itinerary_background(trip_id: int):
    try:
        result = await build_trip_itinerary(trip_id)
        logger.info("[build-itinerary] Trip %d: %d places created",
                    trip_id, result.get("places_created", 0))
    except Exception as e:
        logger.exception("Failed to build itinerary for trip %d", trip_id)


async def _process_link_background(
    link_id: int, trip_id: int, url: str, platform: str, ai_mode: str = "eco"
):
    processing_status[link_id]["status"] = "processing"

    try:
        result = await process_link(link_id, trip_id, url, platform, ai_mode=ai_mode)
        processing_status[link_id] = {
            "status": "completed",
            "extracted_data": {
                "places_created": result.get("places_created", 0),
                "summary": result.get("summary", ""),
            },
            "processing_meta": result.get("cost", {}),
        }
    except Exception as e:
        logger.exception("Failed to process link %d", link_id)
        processing_status[link_id] = {
            "status": "failed",
            "error": str(e),
        }
