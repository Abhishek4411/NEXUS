"""
SQLite-backed cache service with TTL support.
Stores API responses to minimize external requests and respect rate limits.
"""

import json
import logging
import time
import os
import aiosqlite

logger = logging.getLogger("nexus.cache")

DB_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "data", "nexus.db")


class CacheService:
    def __init__(self):
        self.db: aiosqlite.Connection | None = None

    async def init(self):
        os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
        self.db = await aiosqlite.connect(DB_PATH)
        await self.db.execute("""
            CREATE TABLE IF NOT EXISTS cache (
                key       TEXT PRIMARY KEY,
                value     TEXT NOT NULL,
                expires_at REAL NOT NULL
            )
        """)
        await self.db.execute("""
            CREATE TABLE IF NOT EXISTS events (
                id        INTEGER PRIMARY KEY AUTOINCREMENT,
                ts        REAL NOT NULL,
                type      TEXT NOT NULL,
                data      TEXT NOT NULL
            )
        """)
        await self.db.commit()
        logger.info(f"Cache DB initialized at {DB_PATH}")

    async def close(self):
        if self.db:
            await self.db.close()

    async def get(self, key: str):
        """Return cached value if it hasn't expired, else None."""
        now = time.time()
        async with self.db.execute(
            "SELECT value, expires_at FROM cache WHERE key = ?", (key,)
        ) as cursor:
            row = await cursor.fetchone()
        if row and row[1] > now:
            return json.loads(row[0])
        return None

    async def get_stale(self, key: str):
        """Return cached value even if expired (last-known-good fallback)."""
        async with self.db.execute(
            "SELECT value FROM cache WHERE key = ?", (key,)
        ) as cursor:
            row = await cursor.fetchone()
        return json.loads(row[0]) if row else None

    async def set(self, key: str, value, ttl: int):
        """Store value in cache with TTL in seconds."""
        expires_at = time.time() + ttl
        await self.db.execute(
            "INSERT OR REPLACE INTO cache (key, value, expires_at) VALUES (?, ?, ?)",
            (key, json.dumps(value), expires_at),
        )
        await self.db.commit()

    async def delete(self, key: str):
        await self.db.execute("DELETE FROM cache WHERE key = ?", (key,))
        await self.db.commit()

    async def purge_expired(self):
        """Remove expired entries to keep DB small."""
        now = time.time()
        await self.db.execute("DELETE FROM cache WHERE expires_at <= ?", (now,))
        await self.db.commit()

    async def log_event(self, event_type: str, data: dict):
        """Persist an event for debugging/replay."""
        await self.db.execute(
            "INSERT INTO events (ts, type, data) VALUES (?, ?, ?)",
            (time.time(), event_type, json.dumps(data)),
        )
        await self.db.commit()
