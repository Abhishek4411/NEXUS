"""
Satellite API router.
Serves TLE data for client-side position computation via satellite.js.
"""

from fastapi import APIRouter, Request, Query
from ..services import celestrak

router = APIRouter()

GROUPS = list(celestrak.SATELLITE_GROUPS.keys())


@router.get("/groups")
async def list_groups():
    """List available satellite groups."""
    return {"groups": GROUPS}


@router.get("/")
async def get_satellites(
    request: Request,
    group: str = Query("active", description="Satellite group"),
):
    """
    Get TLE data for a satellite group.
    Frontend uses satellite.js to compute real-time positions.
    """
    if group not in celestrak.SATELLITE_GROUPS:
        group = "active"
    cache = request.app.state.cache
    satellites = await celestrak.fetch_group(group, cache)
    return {
        "group": group,
        "count": len(satellites),
        "satellites": satellites,
    }


@router.get("/search")
async def search_satellites(
    request: Request,
    q: str = Query(..., description="Search term (name or NORAD ID)"),
    group: str = Query("active", description="Group to search within"),
):
    cache = request.app.state.cache
    satellites = await celestrak.fetch_group(group, cache)
    q_lower = q.lower()
    results = [
        s for s in satellites
        if q_lower in (s.get("name") or "").lower()
        or q_lower == str(s.get("norad_id", ""))
    ]
    return {"query": q, "count": len(results), "satellites": results[:100]}


@router.get("/{norad_id}")
async def get_satellite(request: Request, norad_id: int):
    """Get a specific satellite by NORAD ID."""
    cache = request.app.state.cache
    sat = await celestrak.fetch_satellite_by_norad(norad_id, cache)
    if sat is None:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail=f"Satellite {norad_id} not found")
    return sat
