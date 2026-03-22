"""
WebSocket router — real-time push for flights and ISS.

Flights strategy:
  The scheduler warms the cache every 120s (respecting OpenSky 100/hr limit).
  The WS handler only READS from cache — never makes direct API calls.
  This prevents rate limit exhaustion from multiple concurrent WebSocket clients.

  Source priority: opensky cache → adsbfi cache → empty (with warning toast)
"""

import asyncio
import logging
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from ..websocket import manager
from ..services import spacedevs

router = APIRouter()
logger = logging.getLogger("nexus.ws")


@router.websocket("/ws/flights")
async def ws_flights(websocket: WebSocket):
    """
    Push cached flight data every 15 seconds.
    Data is refreshed by the background scheduler (every 120s).
    No direct API calls are made from the WebSocket handler.
    """
    await manager.connect(websocket, "flights")
    cache = websocket.app.state.cache
    try:
        while True:
            # Read from cache only — scheduler is responsible for refreshing
            flights = await cache.get("flights:global")
            source = "opensky"
            if not flights:
                flights = await cache.get("adsbfi:global")
                source = "adsbfi" if flights else None
            if not flights:
                # Stale fallback — show last known data even if cache expired
                flights = await cache.get_stale("flights:global") or await cache.get_stale("adsbfi:global") or []
                source = "cached" if flights else "none"

            await websocket.send_json({
                "type": "flights",
                "count": len(flights),
                "source": source,
                "stale": source == "cached",
                "data": flights,
            })
            await asyncio.sleep(15)
    except WebSocketDisconnect:
        manager.disconnect(websocket, "flights")
    except Exception as e:
        logger.error(f"WS flights error: {e}")
        manager.disconnect(websocket, "flights")


@router.websocket("/ws/iss")
async def ws_iss(websocket: WebSocket):
    """Push ISS position every 5 seconds."""
    await manager.connect(websocket, "iss")
    cache = websocket.app.state.cache
    try:
        while True:
            pos = await spacedevs.fetch_iss_position(cache)
            if pos:
                await websocket.send_json({"type": "iss", "data": pos})
            await asyncio.sleep(5)
    except WebSocketDisconnect:
        manager.disconnect(websocket, "iss")
    except Exception as e:
        logger.error(f"WS ISS error: {e}")
        manager.disconnect(websocket, "iss")


@router.get("/api/health")
async def health():
    return {
        "status": "operational",
        "version": "1.2.0",
        "app": "NEXUS - Global Intelligence Platform",
        "ws_channels": {ch: len(conns) for ch, conns in manager.active.items()},
    }


@router.get("/api/config")
async def get_config():
    """Return non-sensitive config values to frontend (e.g. Cesium token)."""
    import os
    from dotenv import load_dotenv
    load_dotenv()
    return {
        "cesium_ion_token": os.getenv("CESIUM_ION_TOKEN", ""),
    }
