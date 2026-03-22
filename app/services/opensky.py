"""
OpenSky Network service — real-time flight tracking.
Free API, anonymous access allows ~100 req/hour.
Docs: https://opensky-network.org/apidoc/
"""

import logging
import os
import httpx

logger = logging.getLogger("nexus.opensky")

OPENSKY_BASE = "https://opensky-network.org/api"
FLIGHT_TTL = 120  # seconds — 2 min cache keeps us under 30 req/hr (< 100/hr anon limit)

# Optional credentials for higher rate limits
USERNAME = os.getenv("OPENSKY_USERNAME", "")
PASSWORD = os.getenv("OPENSKY_PASSWORD", "")


def _auth():
    if USERNAME and PASSWORD:
        return (USERNAME, PASSWORD)
    return None


async def fetch_all_flights(cache=None) -> list[dict]:
    """
    Fetch all current flights globally.
    Returns list of flight state vectors.
    """
    cache_key = "flights:global"
    if cache:
        cached = await cache.get(cache_key)
        if cached is not None:
            return cached

    url = f"{OPENSKY_BASE}/states/all"
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.get(url, auth=_auth())
            resp.raise_for_status()
            data = resp.json()

        states = data.get("states", []) or []
        flights = []
        for s in states:
            if s[5] is None or s[6] is None:
                continue  # skip if no position
            flights.append({
                "icao24":     s[0],
                "callsign":   (s[1] or "").strip(),
                "origin_country": s[2],
                "time_position": s[3],
                "last_contact": s[4],
                "longitude":  s[5],
                "latitude":   s[6],
                "baro_altitude": s[7],   # meters
                "on_ground":  s[8],
                "velocity":   s[9],      # m/s
                "true_track": s[10],     # degrees from north
                "vertical_rate": s[11], # m/s
                "geo_altitude": s[13],  # meters
                "squawk":     s[14],
                "position_source": s[16] if len(s) > 16 else None,
            })

        logger.info(f"Fetched {len(flights)} flights")
        if cache:
            await cache.set(cache_key, flights, FLIGHT_TTL)
        return flights

    except httpx.HTTPStatusError as e:
        if e.response.status_code == 429:
            logger.warning("OpenSky rate limit hit — using cached data")
        else:
            logger.error(f"OpenSky HTTP error: {e}")
        return []
    except Exception as e:
        logger.error(f"Error fetching flights: {e}")
        return []


async def fetch_flights_in_bbox(
    lat_min: float, lat_max: float, lon_min: float, lon_max: float, cache=None
) -> list[dict]:
    """Fetch flights within a bounding box."""
    cache_key = f"flights:bbox:{lat_min}:{lat_max}:{lon_min}:{lon_max}"
    if cache:
        cached = await cache.get(cache_key)
        if cached is not None:
            return cached

    url = f"{OPENSKY_BASE}/states/all"
    params = {"lamin": lat_min, "lamax": lat_max, "lomin": lon_min, "lomax": lon_max}
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.get(url, params=params, auth=_auth())
            resp.raise_for_status()
            data = resp.json()

        states = data.get("states", []) or []
        flights = []
        for s in states:
            if s[5] is None or s[6] is None:
                continue
            flights.append({
                "icao24": s[0],
                "callsign": (s[1] or "").strip(),
                "longitude": s[5],
                "latitude":  s[6],
                "baro_altitude": s[7],
                "on_ground": s[8],
                "velocity":  s[9],
                "true_track": s[10],
                "origin_country": s[2],
            })

        if cache:
            await cache.set(cache_key, flights, FLIGHT_TTL)
        return flights
    except Exception as e:
        logger.error(f"Error fetching flights in bbox: {e}")
        return []
