from __future__ import annotations

import logging
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

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


@asynccontextmanager
async def lifespan(app: FastAPI):
    global http_client
    http_client = httpx.AsyncClient(timeout=30.0)
    logger.info("AI service started on port %s", settings.port)
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
import os
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
