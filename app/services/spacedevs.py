"""
The Space Devs — Launch Library 2 API v2.2.0.
Dev server: https://lldev.thespacedevs.com/2.2.0/ (higher rate limits, no auth needed)
Prod server: https://ll.thespacedevs.com/2.2.0/ (15 req/hr free, more with account)
Covers: SpaceX, ISRO, DRDO, NASA, ESA, Roscosmos, CNSA, and more.
Note: v2.3.0 is not yet available on the dev server.
"""

import logging
import os
import httpx

logger = logging.getLogger("nexus.spacedevs")

# Dev server: no rate limits — ideal for development
LL2_BASE = "https://lldev.thespacedevs.com/2.2.0"
LAUNCH_TTL = 3600  # 1 hour

TOKEN = os.getenv("SPACEDEVS_TOKEN", "")


def _headers():
    if TOKEN:
        return {"Authorization": f"Token {TOKEN}"}
    return {}


async def fetch_upcoming_launches(limit: int = 50, cache=None) -> list[dict]:
    """Fetch upcoming rocket launches worldwide."""
    cache_key = f"launches:upcoming:{limit}"
    if cache:
        cached = await cache.get(cache_key)
        if cached is not None:
            return cached

    url = f"{LL2_BASE}/launch/upcoming/"
    params = {"limit": limit, "mode": "detailed"}
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(url, params=params, headers=_headers())
            resp.raise_for_status()
            data = resp.json()

        launches = []
        for launch in data.get("results", []):
            pad = launch.get("pad", {}) or {}
            pad_location = pad.get("location", {}) or {}
            rocket = launch.get("rocket", {}) or {}
            config = rocket.get("configuration", {}) or {}
            mission = launch.get("mission", {}) or {}
            agency = launch.get("launch_service_provider", {}) or {}

            launches.append({
                "id":           launch.get("id"),
                "name":         launch.get("name"),
                "status":       launch.get("status", {}).get("name"),
                "status_abbrev": launch.get("status", {}).get("abbrev"),
                "net":          launch.get("net"),        # Net launch time (ISO)
                "window_start": launch.get("window_start"),
                "window_end":   launch.get("window_end"),
                "rocket":       config.get("name"),
                "rocket_family": config.get("family"),
                "agency":       agency.get("name"),
                "agency_abbrev": agency.get("abbrev"),
                "agency_country": agency.get("country_code"),
                "mission_name": mission.get("name"),
                "mission_desc": mission.get("description"),
                "mission_orbit": mission.get("orbit", {}).get("name") if mission.get("orbit") else None,
                "pad_name":     pad.get("name"),
                "pad_location_name": pad_location.get("name"),
                "pad_latitude": pad.get("latitude"),
                "pad_longitude": pad.get("longitude"),
                "webcast_live": launch.get("webcast_live", False),
                "video_url":    launch.get("vidURLs", [{}])[0].get("url") if launch.get("vidURLs") else None,
                "image_url":    launch.get("image"),
                "infographic":  launch.get("infographic"),
            })

        logger.info(f"Fetched {len(launches)} upcoming launches")
        if cache:
            await cache.set(cache_key, launches, LAUNCH_TTL)
        return launches

    except httpx.HTTPStatusError as e:
        if e.response.status_code == 429:
            logger.warning("Space Devs rate limit — using cached data")
        else:
            logger.error(f"Space Devs HTTP error: {e}")
        return []
    except Exception as e:
        logger.error(f"Error fetching launches: {e}")
        return []


async def fetch_past_launches(limit: int = 100, cache=None) -> list[dict]:
    """Fetch recent past launches."""
    cache_key = f"launches:past:{limit}"
    if cache:
        cached = await cache.get(cache_key)
        if cached is not None:
            return cached

    url = f"{LL2_BASE}/launch/previous/"
    params = {"limit": limit, "mode": "detailed"}
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(url, params=params, headers=_headers())
            resp.raise_for_status()
            data = resp.json()

        launches = []
        for launch in data.get("results", []):
            pad = launch.get("pad", {}) or {}
            pad_location = pad.get("location", {}) or {}
            rocket = launch.get("rocket", {}) or {}
            config = rocket.get("configuration", {}) or {}
            agency = launch.get("launch_service_provider", {}) or {}

            launches.append({
                "id":           launch.get("id"),
                "name":         launch.get("name"),
                "status":       launch.get("status", {}).get("name"),
                "net":          launch.get("net"),
                "rocket":       config.get("name"),
                "agency":       agency.get("name"),
                "agency_country": agency.get("country_code"),
                "pad_name":     pad.get("name"),
                "pad_latitude": pad.get("latitude"),
                "pad_longitude": pad.get("longitude"),
                "image_url":    launch.get("image"),
            })

        logger.info(f"Fetched {len(launches)} past launches")
        if cache:
            await cache.set(cache_key, launches, LAUNCH_TTL)
        return launches

    except Exception as e:
        logger.error(f"Error fetching past launches: {e}")
        return []


async def fetch_launch_pads(cache=None) -> list[dict]:
    """Fetch all known launch pads worldwide."""
    cache_key = "launches:pads"
    if cache:
        cached = await cache.get(cache_key)
        if cached is not None:
            return cached

    url = f"{LL2_BASE}/pad/"
    params = {"limit": 200}
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(url, params=params, headers=_headers())
            resp.raise_for_status()
            data = resp.json()

        pads = []
        for pad in data.get("results", []):
            location = pad.get("location", {}) or {}
            if pad.get("latitude") and pad.get("longitude"):
                pads.append({
                    "id":        pad.get("id"),
                    "name":      pad.get("name"),
                    "location":  location.get("name"),
                    "country":   location.get("country_code"),
                    "latitude":  float(pad.get("latitude", 0)),
                    "longitude": float(pad.get("longitude", 0)),
                    "status":    pad.get("status", {}).get("name") if pad.get("status") else None,
                    "agency_id": pad.get("agency_id"),
                    "orbital_inclination": pad.get("orbital_inclination"),
                    "map_url":   pad.get("map_url"),
                    "wiki_url":  pad.get("wiki_url"),
                    "info_url":  pad.get("info_url"),
                })

        logger.info(f"Fetched {len(pads)} launch pads")
        if cache:
            await cache.set(cache_key, pads, LAUNCH_TTL * 24)  # 24hr cache for pads
        return pads

    except Exception as e:
        logger.error(f"Error fetching launch pads: {e}")
        return []


async def fetch_iss_position(cache=None) -> dict | None:
    """
    Fetch current ISS position from Open Notify (free, no auth).
    http://api.open-notify.org/iss-now.json
    """
    cache_key = "iss:position"
    if cache:
        cached = await cache.get(cache_key)
        if cached is not None:
            return cached

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get("http://api.open-notify.org/iss-now.json")
            resp.raise_for_status()
            data = resp.json()

        result = {
            "latitude":  float(data["iss_position"]["latitude"]),
            "longitude": float(data["iss_position"]["longitude"]),
            "timestamp": data["timestamp"],
        }
        if cache:
            await cache.set(cache_key, result, 5)  # 5s cache for ISS
        return result
    except Exception as e:
        logger.error(f"Error fetching ISS position: {e}")
        return None


async def fetch_iss_crew(cache=None) -> list[dict]:
    """Fetch current ISS crew from Open Notify."""
    cache_key = "iss:crew"
    if cache:
        cached = await cache.get(cache_key)
        if cached is not None:
            return cached

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get("http://api.open-notify.org/astros.json")
            resp.raise_for_status()
            data = resp.json()

        crew = [p for p in data.get("people", []) if p.get("craft") == "ISS"]
        if cache:
            await cache.set(cache_key, crew, 3600)
        return crew
    except Exception as e:
        logger.error(f"Error fetching ISS crew: {e}")
        return []
