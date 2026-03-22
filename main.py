"""
NEXUS - Global Intelligence Platform
=====================================
Real-time geospatial intelligence dashboard.
Entry point: starts the FastAPI server.

Usage:
    python main.py
    OR
    uvicorn main:app --host 127.0.0.1 --port 8000 --reload
"""

import socket
import uvicorn
from app import create_app

app = create_app()


def _find_free_port(start: int = 8001, end: int = 8020) -> int:
    """Find the first available TCP port in [start, end)."""
    for port in range(start, end):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind(('127.0.0.1', port))
                return port
            except OSError:
                continue
    return start  # fallback — will fail with a clear error


if __name__ == "__main__":
    port = _find_free_port()
    print(f"\n  Open in browser: http://localhost:{port}\n")
    uvicorn.run(
        "main:app",
        host="127.0.0.1",
        port=port,
        reload=True,
        log_level="info",
        access_log=True,
    )
