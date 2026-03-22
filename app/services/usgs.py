"""
USGS Earthquake Hazards service — real-time seismic data.
Completely free, no authentication required.
API: https://earthquake.usgs.gov/fdsnws/event/1/
"""

import logging
import httpx

logger = logging.getLogger("nexus.usgs")

USGS_BASE = "https://earthquake.usgs.gov/fdsnws/event/1"
SEISMIC_TTL = 300  # 5 minutes


async def fetch_earthquakes(
    min_magnitude: float = 2.5,
    period: str = "day",  # 'hour', 'day', 'week', 'month'
    cache=None
) -> list[dict]:
    """
    Fetch recent earthquakes globally.
    period: USGS summary period (hour/day/week/month)
    """
    cache_key = f"seismic:{period}:{min_magnitude}"
    if cache:
        cached = await cache.get(cache_key)
        if cached is not None:
            return cached

    url = f"https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_{period}.geojson"

    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            data = resp.json()

        quakes = []
        for feature in data.get("features", []):
            props = feature.get("properties", {})
            mag = props.get("mag")
            if mag is None or mag < min_magnitude:
                continue
            coords = feature["geometry"]["coordinates"]  # [lon, lat, depth_km]
            quakes.append({
                "id":        feature["id"],
                "magnitude": mag,
                "place":     props.get("place", "Unknown"),
                "time":      props.get("time"),       # epoch ms
                "updated":   props.get("updated"),
                "url":       props.get("url"),
                "detail_url": props.get("detail"),
                "type":      props.get("type", "earthquake"),
                "status":    props.get("status"),
                "tsunami":   props.get("tsunami", 0),
                "felt":      props.get("felt"),
                "longitude": coords[0],
                "latitude":  coords[1],
                "depth_km":  coords[2],
                "alert":     props.get("alert"),      # green/yellow/orange/red
                "sig":       props.get("sig", 0),     # significance score
                "mmi":       props.get("mmi"),        # max mercalli intensity
            })

        quakes.sort(key=lambda q: q.get("time", 0), reverse=True)
        logger.info(f"Fetched {len(quakes)} earthquakes (mag >= {min_magnitude}, period={period})")

        if cache:
            await cache.set(cache_key, quakes, SEISMIC_TTL)
        return quakes

    except Exception as e:
        logger.error(f"Error fetching USGS data: {e}")
        return []


def magnitude_color(magnitude: float) -> str:
    """Return hex color string based on earthquake magnitude."""
    if magnitude >= 7.0:
        return "#ff0000"   # red
    elif magnitude >= 6.0:
        return "#ff4400"
    elif magnitude >= 5.0:
        return "#ff8800"
    elif magnitude >= 4.0:
        return "#ffcc00"
    elif magnitude >= 3.0:
        return "#00ff88"
    else:
        return "#00ccff"
