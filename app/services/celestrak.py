"""
Satellite TLE data service.

Primary source:   CelesTrak — https://celestrak.org/ (free, no auth)
Fallback source:  SatNOGS DB — https://db.satnogs.org/api/tle/ (free, no auth)

CelesTrak is the best source but can be rate-limited from certain IPs
(e.g. cloud/datacenter IPs). From a home/office connection it works fine.
SatNOGS is always accessible and covers most active satellites.
"""

import logging
from typing import Optional
import httpx

logger = logging.getLogger("nexus.celestrak")

# ── CelesTrak URLs ────────────────────────────────────────────
CELESTRAK_TLE_BASE  = "https://celestrak.org/pub/TLE"
CELESTRAK_GP_BASE   = "https://celestrak.org/SPACETRACK/query/"

SATELLITE_GROUPS = {
    "active":   f"{CELESTRAK_TLE_BASE}/active.txt",
    "stations": f"{CELESTRAK_TLE_BASE}/stations.txt",
    "weather":  f"{CELESTRAK_TLE_BASE}/weather.txt",
    "gps":      f"{CELESTRAK_TLE_BASE}/gps-ops.txt",
    "glonass":  f"{CELESTRAK_TLE_BASE}/glo-ops.txt",
    "galileo":  f"{CELESTRAK_TLE_BASE}/galileo.txt",
    "beidou":   f"{CELESTRAK_TLE_BASE}/beidou.txt",
    "geo":      f"{CELESTRAK_TLE_BASE}/geo.txt",
    "amateur":  f"{CELESTRAK_TLE_BASE}/amateur.txt",
    "starlink": f"{CELESTRAK_TLE_BASE}/starlink.txt",
    "oneweb":   f"{CELESTRAK_TLE_BASE}/oneweb.txt",
    "iss":      f"{CELESTRAK_TLE_BASE}/stations.txt",
}

CELESTRAK_GP_GROUPS = {
    "active":   {"GROUP": "active",   "FORMAT": "json"},
    "stations": {"GROUP": "stations", "FORMAT": "json"},
    "weather":  {"GROUP": "weather",  "FORMAT": "json"},
    "gps":      {"GROUP": "gps-ops",  "FORMAT": "json"},
    "glonass":  {"GROUP": "glo-ops",  "FORMAT": "json"},
    "galileo":  {"GROUP": "galileo",  "FORMAT": "json"},
    "beidou":   {"GROUP": "beidou",   "FORMAT": "json"},
    "geo":      {"GROUP": "geo",      "FORMAT": "json"},
    "amateur":  {"GROUP": "amateur",  "FORMAT": "json"},
    "starlink": {"GROUP": "starlink", "FORMAT": "json"},
}

# ── SatNOGS Fallback ─────────────────────────────────────────
# SatNOGS TLE API — completely free, open, no auth
# https://db.satnogs.org/api/tle/ returns paginated TLE data
SATNOGS_TLE_URL = "https://db.satnogs.org/api/tle/"

TLE_TTL = 7200  # 2-hour cache

# Browser-like headers to avoid bot detection
_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
    ),
    "Accept": "text/plain, application/json, */*;q=0.9",
    "Accept-Language": "en-US,en;q=0.9",
}


# ── TLE Text Parser ──────────────────────────────────────────

def _parse_tle_text(text: str) -> list[dict]:
    """Parse 3-line TLE text format into list of satellite dicts."""
    satellites = []
    lines = [l.strip() for l in text.strip().splitlines() if l.strip()]
    i = 0
    while i < len(lines):
        if (i + 2 < len(lines)
                and lines[i + 1].startswith('1 ')
                and lines[i + 2].startswith('2 ')):
            name  = lines[i].strip()
            line1 = lines[i + 1].strip()
            line2 = lines[i + 2].strip()
            try:
                norad_id    = int(line1[2:7].strip())
                inclination = float(line2[8:16].strip())
                period_min  = _period_from_tle(line2)
                apogee, perigee = _apogee_perigee_from_tle(line2)
                satellites.append({
                    "norad_id":    norad_id,
                    "name":        name,
                    "tle_line1":   line1,
                    "tle_line2":   line2,
                    "inclination": round(inclination, 4),
                    "period":      round(period_min, 2) if period_min else None,
                    "apogee":      apogee,
                    "perigee":     perigee,
                    "country":     None,
                    "object_type": None,
                    "epoch":       None,
                    "launch_date": None,
                })
            except (ValueError, IndexError):
                pass
            i += 3
        else:
            i += 1
    return satellites


def _period_from_tle(line2: str) -> Optional[float]:
    try:
        mean_motion = float(line2[52:63].strip())
        if mean_motion > 0:
            return 1440.0 / mean_motion
    except (ValueError, IndexError):
        pass
    return None


def _apogee_perigee_from_tle(line2: str) -> tuple:
    try:
        mean_motion = float(line2[52:63].strip())
        ecc = float("0." + line2[26:33].strip())
        import math
        mu = 398600.4418
        n = mean_motion * 2 * math.pi / 86400
        a = (mu / (n * n)) ** (1 / 3)
        earth_r = 6371
        return round(a * (1 + ecc) - earth_r), round(a * (1 - ecc) - earth_r)
    except Exception:
        return None, None


# ── CelesTrak Fetchers ───────────────────────────────────────

async def _celestrak_tle(url: str) -> list[dict]:
    async with httpx.AsyncClient(timeout=30.0, headers=_HEADERS, follow_redirects=True) as client:
        resp = await client.get(url)
        resp.raise_for_status()
        return _parse_tle_text(resp.text)


async def _celestrak_json(group: str) -> list[dict]:
    params = CELESTRAK_GP_GROUPS.get(group)
    if not params:
        return []
    params = dict(params, **{"class": "gp"})
    async with httpx.AsyncClient(timeout=30.0, headers=_HEADERS, follow_redirects=True) as client:
        resp = await client.get(CELESTRAK_GP_BASE, params=params)
        resp.raise_for_status()
        data = resp.json()
    return [{
        "norad_id":    sat.get("NORAD_CAT_ID"),
        "name":        sat.get("OBJECT_NAME", "UNKNOWN").strip(),
        "tle_line1":   sat.get("TLE_LINE1", ""),
        "tle_line2":   sat.get("TLE_LINE2", ""),
        "epoch":       sat.get("EPOCH"),
        "launch_date": sat.get("LAUNCH_DATE"),
        "country":     sat.get("COUNTRY_CODE"),
        "object_type": sat.get("OBJECT_TYPE"),
        "period":      sat.get("PERIOD"),
        "inclination": sat.get("INCLINATION"),
        "apogee":      sat.get("APOGEE"),
        "perigee":     sat.get("PERIGEE"),
    } for sat in data]


# ── SatNOGS Fallback ─────────────────────────────────────────

async def _satnogs_tle(max_pages: int = 5) -> list[dict]:
    """
    Fetch TLE data from SatNOGS DB.
    Returns up to max_pages * 100 satellites.
    SatNOGS covers ISS, CubeSats, amateur, and many commercial satellites.
    """
    satellites = []
    url = SATNOGS_TLE_URL
    async with httpx.AsyncClient(timeout=30.0, headers=_HEADERS, follow_redirects=True) as client:
        for _ in range(max_pages):
            resp = await client.get(url, params={"format": "json", "page_size": 100})
            if not resp.is_success:
                break
            data = resp.json()
            results = data if isinstance(data, list) else data.get("results", [])
            for sat in results:
                tle0 = sat.get("tle0", "")
                tle1 = sat.get("tle1", "")
                tle2 = sat.get("tle2", "")
                if not (tle1.startswith("1 ") and tle2.startswith("2 ")):
                    continue
                try:
                    norad_id = int(tle1[2:7].strip())
                    period = _period_from_tle(tle2)
                    apogee, perigee = _apogee_perigee_from_tle(tle2)
                    inclination = float(tle2[8:16].strip())
                    # TLE line 0 sometimes has a digit prefix (e.g. "0 ISS") — strip it
                    clean_name = tle0.strip()
                    if clean_name and clean_name[0].isdigit() and clean_name[1:2] == " ":
                        clean_name = clean_name[2:].strip()
                    satellites.append({
                        "norad_id":    sat.get("norad_cat_id", norad_id),
                        "name":        clean_name or sat.get("name", str(norad_id)),
                        "tle_line1":   tle1,
                        "tle_line2":   tle2,
                        "inclination": round(inclination, 4),
                        "period":      round(period, 2) if period else None,
                        "apogee":      apogee,
                        "perigee":     perigee,
                        "country":     None,
                        "object_type": None,
                        "epoch":       None,
                        "launch_date": None,
                    })
                except (ValueError, IndexError):
                    pass

            # Follow pagination
            if isinstance(data, dict) and data.get("next"):
                url = data["next"]
            else:
                break

    return satellites


# ── Public Interface ─────────────────────────────────────────

async def fetch_group(group: str = "active", cache=None) -> list[dict]:
    """
    Fetch TLE data for a satellite group.
    Tries: CelesTrak TLE text → CelesTrak GP JSON → SatNOGS.
    """
    cache_key = f"tle:{group}"
    if cache:
        cached = await cache.get(cache_key)
        if cached:
            logger.debug(f"Cache hit: {cache_key} ({len(cached)} sats)")
            return cached

    satellites = []

    # 1) CelesTrak TLE text (most complete, coverage of all objects)
    url = SATELLITE_GROUPS.get(group, SATELLITE_GROUPS["active"])
    logger.info(f"Fetching TLE: {group} from CelesTrak TLE text")
    try:
        satellites = await _celestrak_tle(url)
        logger.info(f"CelesTrak TLE OK: {len(satellites)} sats ({group})")
    except Exception as e:
        logger.warning(f"CelesTrak TLE failed ({e}) — trying GP JSON")

        # 2) CelesTrak GP JSON API
        try:
            satellites = await _celestrak_json(group)
            logger.info(f"CelesTrak GP JSON OK: {len(satellites)} sats ({group})")
        except Exception as e2:
            logger.warning(f"CelesTrak GP JSON failed ({e2}) — falling back to SatNOGS")

            # 3) SatNOGS — always accessible
            try:
                pages = 20 if group == "active" else 3
                satellites = await _satnogs_tle(max_pages=pages)
                logger.info(f"SatNOGS fallback: {len(satellites)} sats")
            except Exception as e3:
                logger.error(f"All satellite sources failed: {e3}")
                logger.error(
                    "TIP: From a home/office connection, CelesTrak usually works. "
                    "If behind a corporate proxy, try adding credentials to .env"
                )
                return []

    if satellites and cache:
        await cache.set(cache_key, satellites, TLE_TTL)

    return satellites


async def fetch_satellite_by_norad(norad_id: int, cache=None) -> Optional[dict]:
    """Fetch a single satellite. Searches active list first for speed."""
    cache_key = f"tle:sat:{norad_id}"
    if cache:
        cached = await cache.get(cache_key)
        if cached:
            return cached

    # Search the cached active list first (fastest)
    active = await fetch_group("active", cache)
    for sat in active:
        if sat.get("norad_id") == norad_id:
            if cache:
                await cache.set(cache_key, sat, TLE_TTL)
            return sat

    # Try CelesTrak GP JSON for the specific NORAD ID
    try:
        params = {"class": "gp", "CATNR": str(norad_id), "FORMAT": "json"}
        async with httpx.AsyncClient(timeout=15.0, headers=_HEADERS, follow_redirects=True) as client:
            resp = await client.get(CELESTRAK_GP_BASE, params=params)
            resp.raise_for_status()
            data = resp.json()
        if data:
            sat = data[0]
            result = {
                "norad_id":  sat.get("NORAD_CAT_ID"),
                "name":      sat.get("OBJECT_NAME", "UNKNOWN").strip(),
                "tle_line1": sat.get("TLE_LINE1", ""),
                "tle_line2": sat.get("TLE_LINE2", ""),
                "inclination": sat.get("INCLINATION"),
                "period":    sat.get("PERIOD"),
                "apogee":    sat.get("APOGEE"),
                "perigee":   sat.get("PERIGEE"),
            }
            if cache:
                await cache.set(cache_key, result, TLE_TTL)
            return result
    except Exception as e:
        logger.warning(f"CelesTrak individual lookup failed: {e}")

    # Search stations list (covers ISS)
    stations = await fetch_group("stations", cache)
    for sat in stations:
        if sat.get("norad_id") == norad_id:
            return sat

    return None


async def fetch_iss(cache=None) -> Optional[dict]:
    """Fetch ISS TLE data (NORAD 25544)."""
    sats = await fetch_group("stations", cache)
    for sat in sats:
        if sat.get("norad_id") == 25544:
            return sat
    # Fallback: direct NORAD lookup
    return await fetch_satellite_by_norad(25544, cache)
