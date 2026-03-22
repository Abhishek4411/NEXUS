"""
GPSJam service — GPS interference/jamming detection overlay.
Data: https://gpsjam.org — open, crowdsourced from ADS-B receivers.

GPSJam computes GPS accuracy degradation from ADS-B navigation accuracy data.
Daily CSV files are publicly available at: https://gpsjam.org/data/YYYY-MM-DD.csv

CSV format: h3_index, count, pct_good
- h3_index: H3 geospatial hexagonal grid cell ID
- count: number of aircraft reports
- pct_good: percentage of aircraft with good GPS (< this = interference likely)

Note: GPSJam has no formal REST API. We download daily CSVs.
"""

import logging
import io
import csv
from datetime import date, timedelta
import httpx

logger = logging.getLogger("nexus.gpsjam")

GPSJAM_BASE = "https://gpsjam.org/data"
GPSJAM_TTL  = 3600  # 1 hour


async def fetch_jamming_data(for_date: date = None, cache=None) -> list[dict]:
    """
    Fetch GPS jamming data for a given date (defaults to yesterday).
    Returns list of hex cells with jamming percentage.
    """
    if for_date is None:
        for_date = date.today() - timedelta(days=1)  # yesterday — today's data may not be ready

    date_str = for_date.strftime("%Y-%m-%d")
    cache_key = f"gpsjam:{date_str}"

    if cache:
        cached = await cache.get(cache_key)
        if cached is not None:
            return cached

    url = f"{GPSJAM_BASE}/{date_str}.csv"
    logger.info(f"Fetching GPSJam data for {date_str}")

    try:
        async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            text = resp.text

        # Parse CSV
        reader = csv.DictReader(io.StringIO(text))
        cells = []
        for row in reader:
            try:
                pct_good = float(row.get("pct_good", 100))
                count    = int(row.get("count", 0))
                if count < 5:
                    continue  # not enough data
                if pct_good > 95:
                    continue  # no significant jamming

                cells.append({
                    "h3_index": row.get("h3_index"),
                    "count":    count,
                    "pct_good": round(pct_good, 2),
                    "pct_jammed": round(100 - pct_good, 2),
                    "severity": _severity(pct_good),
                })
            except (ValueError, KeyError):
                pass

        logger.info(f"GPSJam: {len(cells)} interference cells for {date_str}")

        if cache:
            await cache.set(cache_key, cells, GPSJAM_TTL)
        return cells

    except httpx.HTTPStatusError as e:
        if e.response.status_code == 404:
            logger.warning(f"GPSJam data not yet available for {date_str}")
        else:
            logger.error(f"GPSJam HTTP error: {e}")
        return []
    except Exception as e:
        logger.error(f"GPSJam error: {e}")
        return []


def _severity(pct_good: float) -> str:
    """Classify jamming severity based on % good GPS."""
    if pct_good < 20:  return "extreme"
    if pct_good < 50:  return "high"
    if pct_good < 75:  return "medium"
    return "low"
