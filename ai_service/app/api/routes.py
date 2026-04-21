from __future__ import annotations

import asyncio
import logging
import time
import uuid
from typing import Any

from fastapi import APIRouter, BackgroundTasks, HTTPException

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

# Async analyze jobs — key: job_id, value: {status, result, started_at, urls}
analyze_jobs: dict[str, dict[str, Any]] = {}

_JOB_TTL_SECONDS = 60 * 15  # 15 minutes; old jobs get GC'd lazily


def _gc_old_jobs() -> None:
    now = time.time()
    dead = [
        jid for jid, info in analyze_jobs.items()
        if now - info.get("started_at", now) > _JOB_TTL_SECONDS
    ]
    for jid in dead:
        analyze_jobs.pop(jid, None)


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
    """Fast preview — caption/oEmbed only, ≤15s.

    For deep analysis (audio transcription + on-screen OCR) use the
    async endpoint /analyze-url/start.
    """
    logger.info("Received analyze-url request: %d URL(s)", len(request.urls))

    try:
        result = await analyze_urls(request.urls)
        return AnalyzeUrlResponse(**result)
    except Exception as e:
        logger.exception("Failed to analyze URLs")
        return AnalyzeUrlResponse(error=str(e))


@router.post("/analyze-url/start")
async def analyze_url_start(
    request: AnalyzeUrlRequest, background_tasks: BackgroundTasks
):
    """Start a deep analyze job (audio transcription + on-screen OCR).

    Returns immediately with a job_id. Client polls /analyze-url/status/{id}.

    If the SAME set of URLs was analyzed recently AND produced a non-empty
    transcript, we can replay the result instantly. Otherwise we always
    re-run to pick up newly-available API keys (Groq) or refreshed caches.
    """
    _gc_old_jobs()

    # Look for a recent job with matching URLs that included a transcript
    urls_sorted = sorted(request.urls)
    for info in analyze_jobs.values():
        if info.get("status") != "ready":
            continue
        if sorted(info.get("urls", [])) != urls_sorted:
            continue
        result = info.get("result") or {}
        debug = result.get("debug") or {}
        had_transcript = any(
            s.get("has_transcript") for s in debug.values()
        )
        if had_transcript:
            # Replay
            return {"job_id": info.get("job_id", ""), "status": "ready"}
        # Stale no-transcript result — re-run to pick up fresh API key
        break

    job_id = str(uuid.uuid4())
    analyze_jobs[job_id] = {
        "job_id": job_id,
        "status": "pending",
        "stage": "extracting",
        "started_at": time.time(),
        "urls": list(request.urls),
        "result": None,
        "error": None,
    }

    background_tasks.add_task(_run_deep_analyze_job, job_id, list(request.urls))
    logger.info("[analyze-deep] Started job %s for %d URL(s)", job_id, len(request.urls))
    return {"job_id": job_id, "status": "pending"}


@router.get("/analyze-url/status/{job_id}")
async def analyze_url_status(job_id: str):
    """Poll-friendly status endpoint. Returns
    {status: 'pending'|'ready'|'error'|'expired', stage, result, error}.

    Returns 200 with status="expired" (not 404) for missing jobs so that:
      (a) polling clients have a terminal state to stop on, and
      (b) a worker restart that wipes the in-memory job store doesn't leave
          old browser tabs hammering the endpoint in a tight 404 loop.
    """
    info = analyze_jobs.get(job_id)
    if info is None:
        return {
            "job_id": job_id,
            "status": "expired",
            "stage": "unknown",
            "result": None,
            "error": (
                "Job não encontrado — provavelmente o servidor reiniciou. "
                "Reenvie o link para começar uma nova análise."
            ),
            "elapsed": 0,
        }
    return {
        "job_id": job_id,
        "status": info.get("status"),
        "stage": info.get("stage"),
        "result": info.get("result"),
        "error": info.get("error"),
        "elapsed": round(time.time() - info.get("started_at", time.time()), 1),
    }


async def _run_deep_analyze_job(job_id: str, urls: list[str]) -> None:
    """Run full deep extraction for a list of URLs, store result."""
    from app.services.orchestrator import analyze_urls_deep

    info = analyze_jobs.get(job_id)
    if info is None:
        return

    try:
        info["stage"] = "transcribing_and_reading_frames"
        result = await analyze_urls_deep(urls)
        info["result"] = result
        info["status"] = "ready"
        info["stage"] = "done"
        logger.info(
            "[analyze-deep] Job %s done: %d places",
            job_id,
            len(result.get("places", [])),
        )
    except Exception as e:
        logger.exception("[analyze-deep] Job %s failed", job_id)
        info["status"] = "error"
        info["error"] = str(e)


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


@router.post("/generate-itinerary", response_model=ProcessLinkResponse, status_code=202)
async def handle_generate_itinerary(request: dict, background_tasks: BackgroundTasks):
    """Mobile-friendly single-shot: analyze + build itinerary in background.

    Body: {"trip_id": int, "profile": optional dict}
    """
    trip_id = request.get("trip_id")
    if not trip_id:
        return ProcessLinkResponse(status="error", message="trip_id required")

    background_tasks.add_task(_generate_itinerary_background, int(trip_id))
    return ProcessLinkResponse(
        status="accepted",
        message=f"Generating itinerary for trip {trip_id}",
    )


async def _generate_itinerary_background(trip_id: int):
    try:
        analyze_result = await analyze_trip(trip_id)
        logger.info(
            "[generate-itinerary] analyze trip=%d status=%s",
            trip_id,
            analyze_result.get("status", "unknown"),
        )
        # analyze_trip already triggers build when no link content is available,
        # otherwise build is triggered after user confirms profile.
        # For mobile flow we always build immediately.
        build_result = await build_trip_itinerary(trip_id)
        logger.info(
            "[generate-itinerary] build trip=%d places=%d",
            trip_id,
            build_result.get("places_created", 0),
        )
    except Exception:
        logger.exception("[generate-itinerary] Failed for trip %d", trip_id)


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
