"""
Background scheduler — periodically fetches data to keep cache warm.
Uses APScheduler to run async jobs.

Rate limit strategy:
  OpenSky: max 100 req/hr anon → schedule at 120s → 30 req/hr (safe margin)
  USGS: no rate limit → every 5 min
  Space Devs: lldev v2.2.0 → no rate limit → every 1 hr
  CelesTrak/SatNOGS: no rate limit → every 2 hr
"""

import logging
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger

from .services import celestrak, opensky, adsbfi, usgs, spacedevs

logger = logging.getLogger("nexus.scheduler")


async def start_scheduler(cache) -> AsyncIOScheduler:
    scheduler = AsyncIOScheduler()

    async def warm_satellites():
        logger.info("[Scheduler] Refreshing active satellites TLE...")
        await celestrak.fetch_group("active", cache)
        await celestrak.fetch_group("starlink", cache)
        await celestrak.fetch_group("stations", cache)

    async def warm_flights():
        """
        Refresh flights. Only OpenSky is called here — at 120s intervals,
        keeping usage at 30 req/hr (well under 100/hr anon limit).
        Falls back to ADS-B.fi if OpenSky is unavailable.
        """
        logger.info("[Scheduler] Refreshing flight data...")
        flights = await opensky.fetch_all_flights(cache)
        if not flights:
            # Fallback to ADS-B.fi (if it is available)
            flights = await adsbfi.fetch_all_aircraft(cache)
            if flights:
                logger.info(f"[Scheduler] ADS-B.fi fallback: {len(flights)} aircraft")
            else:
                logger.warning("[Scheduler] No flight data from any source — check rate limits or API availability")

    async def warm_seismic():
        logger.info("[Scheduler] Refreshing seismic data...")
        await usgs.fetch_earthquakes(2.5, "day", cache)
        await usgs.fetch_earthquakes(4.5, "week", cache)

    async def warm_launches():
        logger.info("[Scheduler] Refreshing launch data...")
        await spacedevs.fetch_upcoming_launches(50, cache)
        await spacedevs.fetch_past_launches(50, cache)
        await spacedevs.fetch_launch_pads(cache)

    async def purge_cache():
        await cache.purge_expired()

    # TLE data: every 2 hours
    scheduler.add_job(warm_satellites, IntervalTrigger(hours=2), id="satellites", replace_existing=True)
    # Flights: every 120 seconds = 30 req/hr (OpenSky limit: 100/hr anonymous)
    scheduler.add_job(warm_flights, IntervalTrigger(seconds=120), id="flights", replace_existing=True)
    # Seismic: every 5 minutes
    scheduler.add_job(warm_seismic, IntervalTrigger(minutes=5), id="seismic", replace_existing=True)
    # Launches: every hour
    scheduler.add_job(warm_launches, IntervalTrigger(hours=1), id="launches", replace_existing=True)
    # Cache purge: every 30 minutes
    scheduler.add_job(purge_cache, IntervalTrigger(minutes=30), id="cache_purge", replace_existing=True)

    scheduler.start()

    # Initial warm-up (non-blocking)
    import asyncio
    asyncio.create_task(warm_satellites())
    asyncio.create_task(warm_flights())
    asyncio.create_task(warm_seismic())
    asyncio.create_task(warm_launches())

    logger.info("Scheduler started: satellites(2h) flights(120s) seismic(5m) launches(1h)")
    return scheduler


async def stop_scheduler(scheduler: AsyncIOScheduler):
    if scheduler.running:
        scheduler.shutdown(wait=False)
        logger.info("Scheduler stopped")
