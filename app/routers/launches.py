"""
Rocket launch API router — The Space Devs.
Covers SpaceX, ISRO, DRDO, NASA, ESA, Roscosmos, CNSA, etc.
"""

from fastapi import APIRouter, Request, Query
from ..services import spacedevs

router = APIRouter()


@router.get("/upcoming")
async def get_upcoming(request: Request, limit: int = Query(50, le=100)):
    """Get upcoming rocket launches worldwide."""
    cache = request.app.state.cache
    launches = await spacedevs.fetch_upcoming_launches(limit, cache)
    return {"count": len(launches), "launches": launches}


@router.get("/past")
async def get_past(request: Request, limit: int = Query(100, le=200)):
    """Get past rocket launches."""
    cache = request.app.state.cache
    launches = await spacedevs.fetch_past_launches(limit, cache)
    return {"count": len(launches), "launches": launches}


@router.get("/pads")
async def get_pads(request: Request):
    """Get all launch pads with coordinates."""
    cache = request.app.state.cache
    pads = await spacedevs.fetch_launch_pads(cache)
    return {"count": len(pads), "pads": pads}


@router.get("/iss")
async def get_iss(request: Request):
    """Get current ISS position."""
    cache = request.app.state.cache
    pos = await spacedevs.fetch_iss_position(cache)
    crew = await spacedevs.fetch_iss_crew(cache)
    return {"position": pos, "crew": crew, "crew_count": len(crew)}
