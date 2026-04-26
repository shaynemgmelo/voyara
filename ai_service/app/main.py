from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager

import httpx
import sentry_sdk
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sentry_sdk.integrations.fastapi import FastApiIntegration

# Initialise Sentry BEFORE FastAPI() and route imports so startup errors,
# import-time crashes, and middleware exceptions are all captured. No-op
# when SENTRY_DSN is unset (local dev, CI, etc.).
if dsn := os.environ.get("SENTRY_DSN"):
    sentry_sdk.init(
        dsn=dsn,
        integrations=[FastApiIntegration()],
        traces_sample_rate=0.1,
        environment=os.environ.get("RENDER_SERVICE_NAME", "local"),
        release=os.environ.get("RENDER_GIT_COMMIT", "dev")[:7],
        send_default_pii=False,
    )

from app.api.routes import router
from app.api.whatsapp_routes import router as whatsapp_router
from app.config import settings

logging.basicConfig(level=settings.log_level)
logger = logging.getLogger(__name__)

# Shared async HTTP client
http_client: httpx.AsyncClient | None = None


def get_http_client() -> httpx.AsyncClient:
    assert http_client is not None
    return http_client


def _check_yt_dlp_freshness() -> None:
    """Log a WARN if the installed yt-dlp is older than 30 days.

    TikTok / Instagram change their video URL signing constantly and yt-dlp
    patches within hours. An old yt-dlp silently degrades extraction to
    caption-only (looks like a TikTok block to users but is just our lib
    being stale). We surface this on startup so Render logs make the
    staleness obvious before users report problems.
    """
    try:
        import yt_dlp
        import datetime as _dt
        version = yt_dlp.version.__version__  # format "2025.09.26" or similar
        parts = version.split(".")
        if len(parts) >= 3:
            try:
                ver_date = _dt.date(int(parts[0]), int(parts[1]), int(parts[2][:2]))
                age_days = (_dt.date.today() - ver_date).days
                if age_days > 30:
                    logger.warning(
                        "[startup] yt-dlp is %d days old (v%s). TikTok/IG "
                        "extraction may be degraded. Redeploy to refresh.",
                        age_days, version,
                    )
                else:
                    logger.info("[startup] yt-dlp v%s (%d days old) — fresh",
                                version, age_days)
            except ValueError:
                logger.info("[startup] yt-dlp v%s", version)
        else:
            logger.info("[startup] yt-dlp v%s", version)
    except Exception as e:
        logger.warning("[startup] Could not check yt-dlp version: %s", e)


@asynccontextmanager
async def lifespan(app: FastAPI):
    global http_client
    http_client = httpx.AsyncClient(timeout=30.0)
    logger.info("AI service started on port %s", settings.port)
    logger.info(
        "WhatsApp config: token_len=%d phone_id='%s'",
        len(settings.whatsapp_access_token),
        settings.whatsapp_phone_number_id,
    )
    _check_yt_dlp_freshness()
    yield
    await http_client.aclose()
    logger.info("AI service shut down")


app = FastAPI(
    title="Mapass AI Service",
    version="0.1.0",
    lifespan=lifespan,
)

cors_origins = [
    "http://localhost:3000",
    "http://localhost:3001",
    "http://localhost:3002",
]
# Add production origins from env
extra_origins = os.environ.get("CORS_ORIGINS", "")
if extra_origins:
    cors_origins.extend([o.strip() for o in extra_origins.split(",") if o.strip()])

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router, prefix="/api")
app.include_router(whatsapp_router, prefix="/api/whatsapp")
