"""
Flight tracking API router.
Sources: OpenSky Network (primary) + ADS-B.fi (broader coverage, incl. some military)
"""

from fastapi import APIRouter, Request, Query
from ..services import opensky, adsbfi, gpsjam

router = APIRouter()


@router.get("/")
async def get_flights(
    request: Request,
    source: str = Query("opensky", description="opensky | adsbfi"),
):
    """
    Get all current global flights.
    source=opensky: OpenSky Network (well-structured, rate-limited)
    source=adsbfi:  ADS-B.fi (broader coverage, community-run, free)
    """
    cache = request.app.state.cache
    if source == "adsbfi":
        flights = await adsbfi.fetch_all_aircraft(cache)
    else:
        flights = await opensky.fetch_all_flights(cache)
    return {"count": len(flights), "source": source, "flights": flights}


@router.get("/bbox")
async def get_flights_in_bbox(
    request: Request,
    lat_min: float = Query(-90),
    lat_max: float = Query(90),
    lon_min: float = Query(-180),
    lon_max: float = Query(180),
    source: str = Query("opensky"),
):
    """Get flights within a geographic bounding box."""
    cache = request.app.state.cache
    flights = await opensky.fetch_flights_in_bbox(lat_min, lat_max, lon_min, lon_max, cache)
    return {"count": len(flights), "flights": flights}


@router.get("/gpsjam")
async def get_gpsjam(request: Request):
    """GPS jamming/interference overlay from GPSJam.org."""
    cache = request.app.state.cache
    cells = await gpsjam.fetch_jamming_data(cache=cache)
    return {
        "count": len(cells),
        "source": "gpsjam.org",
        "description": "H3 hexagonal cells with GPS interference > 5%",
        "cells": cells,
    }
