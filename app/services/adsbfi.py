"""
Flight data fallback service — tries multiple free community ADS-B sources.
Used when OpenSky is rate-limited.

Sources tried in order:
  1. ADS-B.fi     — https://api.adsb.fi/v1/aircraft (community, EU)
  2. ADSB.lol     — https://api.adsb.lol/v2/aircraft (community)
  3. Airplanes.live — https://api.airplanes.live/v2/aircraft (community, US-heavy)

All are free, no authentication required.
"""

import logging
import httpx

logger = logging.getLogger("nexus.adsbfi")

FLIGHT_TTL = 120  # seconds (match OpenSky TTL)

# Candidate URLs in priority order — each is tried until one returns data
_SOURCES = [
    ("adsbfi",   "https://api.adsb.fi/v1/aircraft"),
    ("adsbfi_v2","https://api.adsb.fi/v2/aircraft"),
    ("adsblol",  "https://api.adsb.lol/v2/aircraft"),
    ("airplanes","https://api.airplanes.live/v2/aircraft"),
]


def _normalize(ac: dict, source: str) -> dict | None:
    """
    Normalize ADS-B aircraft record to NEXUS flight format.
    Returns None if the aircraft has no position.
    """
    lat = ac.get("lat") or ac.get("latitude")
    lon = ac.get("lon") or ac.get("longitude") or ac.get("lng")
    if lat is None or lon is None:
        return None

    alt_baro = ac.get("alt_baro") or ac.get("altitude") or 0
    alt_geom = ac.get("alt_geom") or alt_baro or 0

    return {
        "icao24":        (ac.get("hex") or ac.get("icao24") or "").lower(),
        "callsign":      (ac.get("flight") or ac.get("callsign") or "").strip(),
        "longitude":     float(lon),
        "latitude":      float(lat),
        "baro_altitude": (float(alt_baro) if alt_baro != "ground" else 0) * 0.3048,  # ft → m
        "geo_altitude":  (float(alt_geom) if alt_geom != "ground" else 0) * 0.3048,
        "velocity":      (ac.get("gs") or ac.get("speed") or 0) * 0.514444,           # knots → m/s
        "true_track":    ac.get("track") or ac.get("heading") or 0,
        "vertical_rate": (ac.get("baro_rate") or 0) * 0.00508,                         # fpm → m/s
        "on_ground":     ac.get("alt_baro") == "ground" or ac.get("on_ground", False),
        "squawk":        ac.get("squawk"),
        "category":      ac.get("category"),
        "origin_country": None,
        "source":        source,
    }


async def fetch_all_aircraft(cache=None) -> list[dict]:
    """
    Fetch all tracked aircraft globally. Tries each source in order until data arrives.
    Returns normalized list in NEXUS format.
    """
    cache_key = "adsbfi:global"
    if cache:
        cached = await cache.get(cache_key)
        if cached is not None:
            return cached

    for source_name, url in _SOURCES:
        try:
            async with httpx.AsyncClient(timeout=20.0, follow_redirects=True) as client:
                resp = await client.get(url)
                if resp.status_code != 200:
                    logger.debug(f"{source_name}: HTTP {resp.status_code}")
                    continue
                data = resp.json()

            raw = data.get("aircraft") or data.get("planes") or data.get("states") or []
            aircraft = [n for ac in raw if (n := _normalize(ac, source_name)) is not None]

            if not aircraft:
                logger.debug(f"{source_name}: returned 0 aircraft")
                continue

            logger.info(f"Flight fallback ({source_name}): {len(aircraft)} aircraft")
            if cache:
                await cache.set(cache_key, aircraft, FLIGHT_TTL)
            return aircraft

        except Exception as e:
            logger.debug(f"{source_name} error: {e}")
            continue

    logger.warning("All flight fallback sources failed — no data available")
    return []


async def fetch_aircraft_in_radius(lat: float, lon: float, radius_nm: int = 500, cache=None) -> list[dict]:
    """Fetch aircraft within radius (nautical miles) of a point."""
    cache_key = f"adsbfi:radius:{lat:.2f}:{lon:.2f}:{radius_nm}"
    if cache:
        cached = await cache.get(cache_key)
        if cached is not None:
            return cached

    for source_name, url in _SOURCES[:2]:  # only try first 2 for radius queries
        try:
            async with httpx.AsyncClient(timeout=15.0, follow_redirects=True) as client:
                resp = await client.get(url, params={"lat": lat, "lon": lon, "radius": radius_nm})
                if resp.status_code != 200:
                    continue
                data = resp.json()

            raw = data.get("aircraft") or []
            aircraft = [n for ac in raw if (n := _normalize(ac, source_name)) is not None]
            if aircraft:
                if cache:
                    await cache.set(cache_key, aircraft, FLIGHT_TTL)
                return aircraft
        except Exception as e:
            logger.debug(f"{source_name} radius error: {e}")
            continue

    return []
