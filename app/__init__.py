"""
NEXUS App Factory
Initializes FastAPI with all routers, middleware, cache, and scheduler.
"""

import logging
import os
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .services.cache import CacheService
from .scheduler import start_scheduler, stop_scheduler
from .routers import satellites, flights, seismic, launches, space, ws

logger = logging.getLogger("nexus")


class _ISTFormatter(logging.Formatter):
    """Log formatter that displays timestamps in IST (UTC+5:30)."""
    _IST_OFFSET = 19800  # seconds

    def formatTime(self, record, datefmt=None):
        ist = time.gmtime(record.created + self._IST_OFFSET)
        if datefmt:
            return time.strftime(datefmt, ist)
        return time.strftime('%Y-%m-%d %H:%M:%S', ist) + ' IST'


_LOG_FORMAT = "%(asctime)s [%(levelname)s] %(name)s: %(message)s"
_ist_formatter = _ISTFormatter(_LOG_FORMAT)

# Configure logging with IST timestamps
_stream_handler = logging.StreamHandler()
_stream_handler.setFormatter(_ist_formatter)

_file_handler = logging.FileHandler("logs/nexus.log", encoding="utf-8")
_file_handler.setFormatter(_ist_formatter)

logging.basicConfig(
    level=logging.INFO,
    format=_LOG_FORMAT,
    handlers=[_stream_handler, _file_handler],
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan: startup and shutdown events."""
    logger.info("🚀 NEXUS starting up...")

    # Init SQLite cache
    cache = CacheService()
    await cache.init()
    app.state.cache = cache
    logger.info("✅ Cache initialized")

    # Start background scheduler (data fetchers)
    scheduler = await start_scheduler(cache)
    app.state.scheduler = scheduler
    logger.info("✅ Background data scheduler started")

    yield

    # Shutdown
    logger.info("🛑 NEXUS shutting down...")
    await stop_scheduler(scheduler)
    await cache.close()
    logger.info("✅ Shutdown complete")


def create_app() -> FastAPI:
    app = FastAPI(
        title="NEXUS — Global Intelligence Platform",
        description=(
            "Real-time geospatial intelligence: satellites, flights, "
            "seismic, launches, maritime, and space data fused on a 3D globe."
        ),
        version="1.0.0",
        lifespan=lifespan,
        docs_url="/api/docs",
        redoc_url="/api/redoc",
    )

    # CORS – allow all for local dev
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # API routers
    app.include_router(satellites.router, prefix="/api/satellites", tags=["Satellites"])
    app.include_router(flights.router, prefix="/api/flights", tags=["Flights"])
    app.include_router(seismic.router, prefix="/api/seismic", tags=["Seismic"])
    app.include_router(launches.router, prefix="/api/launches", tags=["Launches"])
    app.include_router(space.router, prefix="/api/space", tags=["Space"])
    app.include_router(ws.router, tags=["WebSocket"])

    # Serve frontend as static files
    static_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "static")
    app.mount("/", StaticFiles(directory=static_dir, html=True), name="static")

    return app
