"""
Seismic/earthquake API router — USGS.
"""

from fastapi import APIRouter, Request, Query
from ..services import usgs

router = APIRouter()

VALID_PERIODS = ["hour", "day", "week", "month"]


@router.get("/")
async def get_earthquakes(
    request: Request,
    min_magnitude: float = Query(2.5, ge=0, le=10),
    period: str = Query("day", description="hour|day|week|month"),
):
    """Get recent earthquakes globally."""
    if period not in VALID_PERIODS:
        period = "day"
    cache = request.app.state.cache
    quakes = await usgs.fetch_earthquakes(min_magnitude, period, cache)
    return {"count": len(quakes), "period": period, "min_magnitude": min_magnitude, "earthquakes": quakes}


@router.get("/significant")
async def get_significant(request: Request):
    """Get significant earthquakes (mag 4.5+) from the past week."""
    cache = request.app.state.cache
    quakes = await usgs.fetch_earthquakes(4.5, "week", cache)
    return {"count": len(quakes), "earthquakes": quakes}
