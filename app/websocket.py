"""
WebSocket connection manager.
Manages active connections and broadcasts real-time data.
"""

import asyncio
import json
import logging
from typing import Any
from fastapi import WebSocket

logger = logging.getLogger("nexus.ws")


class ConnectionManager:
    def __init__(self):
        self.active: dict[str, list[WebSocket]] = {}  # channel -> [websockets]

    async def connect(self, websocket: WebSocket, channel: str):
        await websocket.accept()
        if channel not in self.active:
            self.active[channel] = []
        self.active[channel].append(websocket)
        logger.info(f"WS connected: channel={channel}, total={len(self.active[channel])}")

    def disconnect(self, websocket: WebSocket, channel: str):
        if channel in self.active:
            self.active[channel] = [ws for ws in self.active[channel] if ws != websocket]
        logger.info(f"WS disconnected: channel={channel}")

    async def broadcast(self, channel: str, data: Any):
        """Send data to all subscribers on a channel."""
        if channel not in self.active:
            return
        payload = json.dumps(data)
        dead = []
        for ws in self.active[channel]:
            try:
                await ws.send_text(payload)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(ws, channel)

    def subscriber_count(self, channel: str) -> int:
        return len(self.active.get(channel, []))


# Global manager instance
manager = ConnectionManager()
