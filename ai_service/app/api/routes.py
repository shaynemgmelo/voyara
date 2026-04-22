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
    extract_profile_and_build,
    refine_itinerary,
    optimize_trip_routing,
    enrich_trip_with_experiences,
)

logger = logging.getLogger(__name__)
router = APIRouter()

# In-memory status tracking (use Redis in production)
processing_status: dict[int, dict] = {}

# Async analyze jobs — key: job_id, value: {status, result, started_at, urls}
analyze_jobs: dict[str, dict[str, Any]] = {}

# Active itinerary builds — key: trip_id, value: {started_at, stage, last_log_at}
# The frontend hits /build-status/{trip_id} to check liveness. If a trip_id
# isn't in this dict, the build either never started, crashed, or already
# finished. In the last case the Rails day_plans will show items.
active_builds: dict[int, dict[str, Any]] = {}

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
    """Phase 2: Build unified itinerary after profile confirmation.

    Deduplicates: if there's already a FRESH active build for this trip
    (< 4 minutes old, which is our TOTAL_BUDGET_S ceiling), we don't
    schedule a second one — the auto-retry on the frontend was racing
    with the original build, letting two workers fight over the same
    items and leaving profile_status inconsistent. A stale entry (>4
    min) is treated as dead (worker probably OOM-killed) and cleared so
    a fresh build can start.
    """
    trip_id = request.trip_id
    existing = active_builds.get(trip_id)
    if existing:
        age = time.time() - existing.get("started_at", 0)
        if age < 240:
            logger.info(
                "[resume] trip=%d already building (stage=%s, %ds old) — "
                "no-op to avoid race",
                trip_id, existing.get("stage", "?"), int(age),
            )
            return ProcessLinkResponse(
                status="already_running",
                message=f"Build already running for trip {trip_id} ({int(age)}s)",
            )
        # Stale entry — worker probably died. Clear so we can restart.
        logger.warning(
            "[resume] trip=%d has STALE active_builds entry (%ds old, "
            "stage=%s). Clearing + restarting.",
            trip_id, int(age), existing.get("stage", "?"),
        )
        active_builds.pop(trip_id, None)

    logger.info("[resume] trip=%d (via link=%d) — scheduling build", trip_id, link_id)
    background_tasks.add_task(_build_itinerary_background, trip_id)

    return ProcessLinkResponse(
        status="accepted",
        message=f"Building itinerary for trip {trip_id}",
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
    """Wrapper around build_trip_itinerary. Two outcomes, nothing in between:

    1. Real build produces real items → done. Any stale build_error cleared.
    2. Build fails or times out → persist `build_error` on the trip's
       profile so the UI shows a clean failure modal with a retry button.

    Previous versions had an "emergency fallback" that regex-scanned
    content and created skeleton items when the real build failed. It
    shipped random disconnected place names and degraded user trust, so
    it was removed. If we can't deliver a real itinerary, we say so.
    """
    import asyncio as _aio
    import time as _t
    from app.services.orchestrator import (
        build_trip_itinerary,
        RailsClient,
    )
    # Pipeline math at 200s:
    #   fetch 2s + re-extract 25s + classify 25s + sonnet 95s + create 40s ≈ 187s
    # 13s of slack for slow Rails round-trips / Google Places lookups.
    # Previous 150s / 180s caps were too tight for 7+ day trips where
    # Sonnet alone needs 50-80s to emit 35+ items.
    TOTAL_BUDGET_S = 200.0
    start = _t.time()
    active_builds[trip_id] = {
        "started_at": start,
        "stage": "starting",
        "last_log_at": start,
    }
    logger.info("[build trip=%d] SCHEDULED, budget=%ds", trip_id, int(TOTAL_BUDGET_S))

    places_created = 0
    build_err: str | None = None

    try:
        result = await _aio.wait_for(
            build_trip_itinerary(trip_id), timeout=TOTAL_BUDGET_S,
        )
        places_created = int(result.get("places_created", 0) or 0)
        if result.get("error") and places_created == 0:
            build_err = str(result["error"])
        logger.info(
            "[build trip=%d] done: %d places in %.1fs (err=%s)",
            trip_id, places_created, _t.time() - start, build_err,
        )
    except _aio.TimeoutError:
        build_err = f"A geração passou do limite de {int(TOTAL_BUDGET_S)}s."
        logger.error("[build trip=%d] TIMED OUT after %ds", trip_id, int(TOTAL_BUDGET_S))
    except Exception as e:
        build_err = f"Erro inesperado: {type(e).__name__}: {str(e)[:200]}"
        logger.exception("[build trip=%d] EXCEPTION", trip_id)

    # No items created + a real error → persist it so the UI unblocks.
    if places_created == 0 and build_err:
        try:
            rails = RailsClient()
            trip = await rails.get_trip(trip_id)
            profile = (trip.get("traveler_profile") or {})
            profile["build_error"] = {
                "message": build_err,
                "at": _t.strftime("%Y-%m-%dT%H:%M:%SZ", _t.gmtime()),
                "budget_exceeded": "limite" in build_err,
            }
            await rails.update_trip(trip_id, {"traveler_profile": profile})
            logger.info(
                "[build trip=%d] Persisted build_error: %s", trip_id, build_err,
            )
        except Exception:
            logger.exception("[build trip=%d] Could not persist build_error", trip_id)

    # Items created → wipe any stale build_error from a previous failed run.
    elif places_created > 0:
        try:
            rails = RailsClient()
            trip = await rails.get_trip(trip_id)
            profile = trip.get("traveler_profile") or {}
            if profile.get("build_error"):
                profile.pop("build_error", None)
                await rails.update_trip(trip_id, {"traveler_profile": profile})
        except Exception:
            pass

    active_builds.pop(trip_id, None)
    logger.info(
        "[build trip=%d] EXIT: items=%d err=%s elapsed=%.1fs",
        trip_id, places_created, build_err, _t.time() - start,
    )


# ──────────────────────────────────────────────
# COMBINED PIPELINE — extract + profile + build in one shot
# Triggered when the user clicks "Generate" on the trip-create form.
# Replaces the old split between /process-link (per-link, fired by Rails
# on link create) and /resume-processing (fired after profile confirm).
# ──────────────────────────────────────────────


@router.post("/extract-and-build/{trip_id}", response_model=ProcessLinkResponse, status_code=202)
async def handle_extract_and_build(trip_id: int, background_tasks: BackgroundTasks):
    """Single entry point for the new flow. Runs extraction → profile →
    build sequentially in one background task. Replaces the old multi-step
    Rails-callback chain so failure handling lives in one place and the
    user only stares at one progress modal.
    """
    existing = active_builds.get(trip_id)
    if existing:
        age = time.time() - existing.get("started_at", 0)
        if age < 350:  # matches the new combined budget below
            logger.info(
                "[extract-and-build] trip=%d already running (stage=%s, %ds old) — no-op",
                trip_id, existing.get("stage", "?"), int(age),
            )
            return ProcessLinkResponse(
                status="already_running",
                message=f"Build already running for trip {trip_id} ({int(age)}s)",
            )
        logger.warning(
            "[extract-and-build] trip=%d STALE entry (%ds) — clearing + restarting",
            trip_id, int(age),
        )
        active_builds.pop(trip_id, None)

    logger.info("[extract-and-build] trip=%d — scheduling combined pipeline", trip_id)
    background_tasks.add_task(_extract_and_build_background, trip_id)
    return ProcessLinkResponse(
        status="accepted",
        message=f"Extracting + building trip {trip_id}",
    )


async def _extract_and_build_background(trip_id: int):
    """Wrapper around extract_profile_and_build with the same defensive
    error-persistence as _build_itinerary_background. Two outcomes:

      1. Real itinerary produced → done. Stale build_error cleared.
      2. Anything fails or times out → persist build_error on the trip's
         profile so the UI shows a clean failure modal with retry.

    Manual mode is treated as success when extraction completes (zero
    items expected — the UI shows the extracted-places panel instead).
    """
    import asyncio as _aio
    import time as _t
    from app.services.orchestrator import RailsClient

    # Worst-case math at 350s budget:
    #   extract 3 fresh links (sequential) ~150s + profile 35s + build 165s
    # Median (cached content): ~90-120s. The cap is the absolute ceiling
    # — anything past it is killed and the failure modal fires.
    TOTAL_BUDGET_S = 350.0
    start = _t.time()
    active_builds[trip_id] = {
        "started_at": start,
        "stage": "starting (combined)",
        "last_log_at": start,
    }
    logger.info(
        "[extract-and-build trip=%d] SCHEDULED, budget=%ds",
        trip_id, int(TOTAL_BUDGET_S),
    )

    places_created = 0
    build_err: str | None = None
    is_manual = False

    try:
        result = await _aio.wait_for(
            extract_profile_and_build(trip_id), timeout=TOTAL_BUDGET_S,
        )
        places_created = int(result.get("places_created", 0) or 0)
        is_manual = result.get("status") == "manual_extracted"
        if result.get("error") and places_created == 0 and not is_manual:
            build_err = str(result["error"])
        logger.info(
            "[extract-and-build trip=%d] done: %d places in %.1fs (manual=%s err=%s)",
            trip_id, places_created, _t.time() - start, is_manual, build_err,
        )
    except _aio.TimeoutError:
        build_err = f"A geração passou do limite de {int(TOTAL_BUDGET_S)}s."
        logger.error(
            "[extract-and-build trip=%d] TIMED OUT after %ds",
            trip_id, int(TOTAL_BUDGET_S),
        )
    except Exception as e:
        build_err = f"Erro inesperado: {type(e).__name__}: {str(e)[:200]}"
        logger.exception("[extract-and-build trip=%d] EXCEPTION", trip_id)

    # Persist build_error if we have neither items nor a manual-mode success.
    if places_created == 0 and not is_manual and build_err:
        try:
            rails = RailsClient()
            trip = await rails.get_trip(trip_id)
            profile = (trip.get("traveler_profile") or {})
            profile["build_error"] = {
                "message": build_err,
                "at": _t.strftime("%Y-%m-%dT%H:%M:%SZ", _t.gmtime()),
                "budget_exceeded": "limite" in build_err,
            }
            await rails.update_trip(trip_id, {"traveler_profile": profile})
            logger.info(
                "[extract-and-build trip=%d] Persisted build_error: %s",
                trip_id, build_err,
            )
        except Exception:
            logger.exception(
                "[extract-and-build trip=%d] Could not persist build_error", trip_id,
            )
    elif places_created > 0 or is_manual:
        # Wipe stale build_error from previous failed runs.
        try:
            rails = RailsClient()
            trip = await rails.get_trip(trip_id)
            profile = trip.get("traveler_profile") or {}
            if profile.get("build_error"):
                profile.pop("build_error", None)
                await rails.update_trip(trip_id, {"traveler_profile": profile})
        except Exception:
            pass

    active_builds.pop(trip_id, None)
    logger.info(
        "[extract-and-build trip=%d] EXIT: items=%d manual=%s err=%s elapsed=%.1fs",
        trip_id, places_created, is_manual, build_err, _t.time() - start,
    )


@router.post("/enrich-experiences/{trip_id}")
async def handle_enrich_experiences(trip_id: int):
    """Add signature destination experiences (tango show, Vespa tour, buggy,
    boat trip, food tour…) to an existing trip. Synchronous — the user is
    waiting and there are at most 4 Haiku calls, total ~10s budget."""
    try:
        result = await enrich_trip_with_experiences(trip_id)
        return result
    except Exception as e:
        logger.exception("[enrich-experiences] Trip %d failed", trip_id)
        return {"error": str(e), "added": 0}


@router.post("/optimize-trip/{trip_id}")
async def handle_optimize_trip(trip_id: int):
    """Re-run the routing optimizer on an EXISTING trip without changing
    what's in it. Reshuffles items within/between days by proximity and
    resets time_slots by position. Used by the "Otimizar rota" button so
    users don't have to regenerate the whole trip to get better routing.

    Returns synchronously (not a background task) because the user is
    waiting and the op is quick (no AI calls, just geo math + PATCHes).
    """
    try:
        result = await optimize_trip_routing(trip_id)
        return result
    except Exception as e:
        logger.exception("[optimize-trip] Trip %d failed", trip_id)
        return {"error": str(e), "changed": 0}


@router.post("/clear-build/{trip_id}")
async def handle_clear_build(trip_id: int):
    """Force-clears any active_builds entry for this trip, no questions
    asked. Used by the "Forçar reiniciar" button on the progress modal
    when the user knows the build is truly wedged (dedup guard can't
    tell for sure — it only knows the entry is younger than 240 s)."""
    existing = active_builds.pop(trip_id, None)
    if existing:
        age = time.time() - existing.get("started_at", time.time())
        logger.warning(
            "[clear-build] trip=%d — user force-cleared active entry "
            "(age=%.0fs, stage=%s)",
            trip_id, age, existing.get("stage", "?"),
        )
        return {
            "cleared": True,
            "was_age_s": round(age, 1),
            "was_stage": existing.get("stage"),
        }
    return {"cleared": False}


@router.get("/build-status/{trip_id}")
async def handle_build_status(trip_id: int):
    """Lets the frontend tell the difference between
      (a) a build is still running (stage + elapsed reported), and
      (b) no build is active for this trip (frontend should retry if
          the trip still has no items).

    Also clears stale entries automatically: anything older than our
    TOTAL_BUDGET_S (240s) is assumed dead (worker probably OOM-killed)
    and removed so the next /resume-processing call can start fresh.
    """
    info = active_builds.get(trip_id)
    if info is None:
        return {"trip_id": trip_id, "active": False}
    elapsed = time.time() - info.get("started_at", time.time())
    if elapsed > 240:
        # Stale — worker died. Clear it so a fresh build can start.
        active_builds.pop(trip_id, None)
        logger.warning(
            "[build-status] trip=%d had STALE active entry (%.0fs) — cleared",
            trip_id, elapsed,
        )
        return {"trip_id": trip_id, "active": False, "was_stale": True}
    return {
        "trip_id": trip_id,
        "active": True,
        "stage": info.get("stage", "running"),
        "elapsed": round(elapsed, 1),
    }


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
