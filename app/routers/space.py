"""
Space/astronomy router — planets, near-earth objects, space weather.
Uses NASA APIs (free with API key or demo key).
NASA API: https://api.nasa.gov/ — demo key DEMO_KEY works for low usage.
"""

import logging
import os
import httpx
from fastapi import APIRouter, Request, Query

router = APIRouter()
logger = logging.getLogger("nexus.space")

NASA_KEY = os.getenv("NASA_API_KEY", "DEMO_KEY")
NASA_BASE = "https://api.nasa.gov"

# Solar system bodies with orbital elements (approximate positions)
# Real positions computed via NASA Horizons or approximate formulas
BODIES = {
    "mercury": {"color": "#b5b5b5", "radius": 2439.7, "texture": "mercury"},
    "venus":   {"color": "#f5deb3", "radius": 6051.8, "texture": "venus"},
    "earth":   {"color": "#1e90ff", "radius": 6371.0, "texture": "earth"},
    "mars":    {"color": "#cd5c5c", "radius": 3389.5, "texture": "mars"},
    "jupiter": {"color": "#d2a679", "radius": 71492,  "texture": "jupiter"},
    "saturn":  {"color": "#e4d191", "radius": 60268,  "texture": "saturn"},
    "uranus":  {"color": "#7de8e8", "radius": 25559,  "texture": "uranus"},
    "neptune": {"color": "#3f54ba", "radius": 24764,  "texture": "neptune"},
}

# Known nearest black holes / notable space objects
NOTABLE_OBJECTS = [
    {
        "id": "gaia_bh1",
        "name": "Gaia BH1",
        "type": "stellar_black_hole",
        "description": "Closest known black hole to Earth (~1,560 light-years in Ophiuchus)",
        "distance_ly": 1560,
        "mass_solar": 9.6,
        "ra": 262.175,   # Right ascension degrees
        "dec": -0.808,   # Declination degrees
        "constellation": "Ophiuchus",
    },
    {
        "id": "gaia_bh2",
        "name": "Gaia BH2",
        "type": "stellar_black_hole",
        "description": "Second-closest known black hole (~3,800 light-years in Centaurus)",
        "distance_ly": 3800,
        "mass_solar": 8.9,
        "ra": 210.0,
        "dec": -59.0,
        "constellation": "Centaurus",
    },
    {
        "id": "sgr_a_star",
        "name": "Sagittarius A*",
        "type": "supermassive_black_hole",
        "description": "Supermassive black hole at Milky Way center (~26,000 light-years)",
        "distance_ly": 26000,
        "mass_solar": 4000000,
        "ra": 266.4168,
        "dec": -29.0078,
        "constellation": "Sagittarius",
    },
    {
        "id": "m87_star",
        "name": "M87*",
        "type": "supermassive_black_hole",
        "description": "First black hole ever imaged (Event Horizon Telescope, 2019). ~53.5M light-years",
        "distance_ly": 53500000,
        "mass_solar": 6500000000,
        "ra": 187.7059,
        "dec": 12.3911,
        "constellation": "Virgo",
    },
]


@router.get("/bodies")
async def get_solar_bodies():
    """List solar system bodies with properties."""
    return {"bodies": BODIES}


@router.get("/black-holes")
async def get_black_holes():
    """Return known black holes and notable space objects."""
    return {"count": len(NOTABLE_OBJECTS), "objects": NOTABLE_OBJECTS}


@router.get("/neo")
async def get_near_earth_objects(request: Request):
    """
    Get near-Earth objects (asteroids) from NASA NeoWs API.
    Uses DEMO_KEY — free, low rate limit.
    """
    cache = request.app.state.cache
    cache_key = "neo:today"
    cached = await cache.get(cache_key)
    if cached:
        return cached

    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.get(
                f"{NASA_BASE}/neo/rest/v1/feed/today",
                params={"api_key": NASA_KEY},
            )
            resp.raise_for_status()
            data = resp.json()

        neos = []
        for date_neos in data.get("near_earth_objects", {}).values():
            for neo in date_neos:
                approach = neo.get("close_approach_data", [{}])[0]
                estimated_diameter = neo.get("estimated_diameter", {}).get("meters", {})
                neos.append({
                    "id":          neo.get("id"),
                    "name":        neo.get("name"),
                    "hazardous":   neo.get("is_potentially_hazardous_asteroid", False),
                    "diameter_min_m": estimated_diameter.get("estimated_diameter_min"),
                    "diameter_max_m": estimated_diameter.get("estimated_diameter_max"),
                    "close_approach_date": approach.get("close_approach_date"),
                    "miss_distance_km": float(approach.get("miss_distance", {}).get("kilometers", 0)),
                    "relative_velocity_kmh": float(approach.get("relative_velocity", {}).get("kilometers_per_hour", 0)),
                    "orbiting_body": approach.get("orbiting_body"),
                    "nasa_url":    neo.get("nasa_jpl_url"),
                })

        result = {"count": len(neos), "neos": sorted(neos, key=lambda n: n["miss_distance_km"])}
        await cache.set(cache_key, result, 3600)
        return result

    except Exception as e:
        logger.error(f"Error fetching NEOs: {e}")
        return {"count": 0, "neos": [], "error": str(e)}


@router.get("/apod")
async def get_apod(request: Request):
    """NASA Astronomy Picture of the Day."""
    cache = request.app.state.cache
    cache_key = "nasa:apod"
    cached = await cache.get(cache_key)
    if cached:
        return cached

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(
                f"{NASA_BASE}/planetary/apod",
                params={"api_key": NASA_KEY},
            )
            resp.raise_for_status()
            data = resp.json()
        result = {
            "title": data.get("title"),
            "date":  data.get("date"),
            "explanation": data.get("explanation"),
            "url":   data.get("url"),
            "hdurl": data.get("hdurl"),
            "media_type": data.get("media_type"),
        }
        await cache.set(cache_key, result, 3600 * 6)
        return result
    except Exception as e:
        logger.error(f"APOD error: {e}")
        return {"error": str(e)}


@router.get("/space-weather")
async def get_space_weather(request: Request):
    """NOAA space weather alerts (free, no auth)."""
    cache = request.app.state.cache
    cache_key = "space:weather"
    cached = await cache.get(cache_key)
    if cached:
        return cached

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get("https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json")
            resp.raise_for_status()
            kp_data = resp.json()

        # kp_data is list of [time_tag, kp, kp_fraction, noisy]
        latest_kp = kp_data[-1] if kp_data else None
        result = {
            "kp_index":   latest_kp[1] if latest_kp else None,
            "timestamp":  latest_kp[0] if latest_kp else None,
            "history":    kp_data[-24:] if kp_data else [],  # last 24 readings
            "source":     "NOAA SWPC",
        }
        await cache.set(cache_key, result, 900)  # 15 min cache
        return result
    except Exception as e:
        logger.error(f"Space weather error: {e}")
        return {"error": str(e)}
