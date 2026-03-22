# NEXUS — Global Intelligence Platform

> Real-time 3D geospatial intelligence dashboard inspired by Palantir. Built entirely on free, open-source data. Zero cost to run.

---

## Features

| Layer | Data | Update Rate |
|-------|------|-------------|
| 🛰️ Satellites | 1,500–5,000 live TLE tracks (CelesTrak / SatNOGS) | Every 2s (client-side SGP4) |
| ✈️ Flights | Global flights (OpenSky → ADS-B.fi fallback, stale-cache resilience) | Every 120s (WebSocket) |
| 🌍 Earthquakes | USGS M2.5+ worldwide | Every 5 min |
| 🚀 Launches | Upcoming worldwide (Space Devs v2.2.0 dev server) | Every 1 hr |
| 🛸 ISS | Real-time position + ground track + crew | Every 5s (WebSocket) |
| ☄️ Asteroids / NEO | NASA NeoWs near-Earth objects on globe | Hourly cache |
| ☀️ Solar System | Sun, Moon, Mercury–Neptune, Pluto, black holes, galaxies | Real-time (60s update) |
| 🌦️ Space Weather | NOAA KP index | Every 15 min |
| 📡 GPS Jamming | GPSJam.org H3 hexagonal grid | Daily |

### Key Capabilities

- **GPU Accelerated** — Forces discrete NVIDIA GPU via WebGL `powerPreference: "high-performance"` + auto-detects active GPU renderer at startup
- **3D Planet Rendering** — Sun, Moon, and all 8 planets rendered as textured 3D ellipsoids (Solar System Scope 2K textures)
- **Asteroid Belt** — 300-point particle ring between Mars and Jupiter orbits
- **Continuous Camera Tracking** — Click TRACK on any object; camera continuously follows via `CallbackProperty` with 60fps interpolated positions and extrapolation for ultra-smooth motion
- **Immersive Mode** — Hide all panels for full-globe experience; fullscreen auto-enters immersive mode
- **7 Imagery Modes** — ESRI Satellite, Hybrid (satellite + labels), OSM Streets, Stadia Terrain, Carto Light, Carto Dark, Google Satellite (Cesium Ion token required)
- **Orbit Path Visualization** — 120-point computed orbit overlays for planets, the ISS, and asteroids
- **Real Astronomical Positions** — Sun and Moon positions computed via J2000.0 algorithms, updated every 60s
- **Smart Search** — Searches satellites (NORAD/name), cities/countries/airports (Nominatim geocoding), and solar system objects simultaneously
- **Stale-cache Resilience** — Always shows last-known-good data for flights/launches even when upstream APIs are rate-limited; source tag shown in status bar (`[OPENSKY]` / `[ADSB.FI]` / `[CACHED]`)
- **↺ Refresh All** — Resets camera, stops tracking, and refreshes all data layers without browser reload
- **Living Globe Auto-Rotation** — Earth slowly spins west-to-east (~6 min/revolution); pauses on interaction, resumes after 3s of inactivity
- **Smooth Zoom** — Reduced scroll sensitivity for precise zoom control
- **IST Timezone** — All timestamps displayed in Indian Standard Time (UTC+5:30), including server logs
- **Visual Effects** — NVG (night vision green), Thermal, CRT scanlines, Bloom glow

---

## Quick Start

### Windows

```batch
start.bat
```

Automatically kills any stale server processes, finds a free port, and opens the server.

### Manual (any OS)

```bash
python -m venv venv
source venv/bin/activate       # Linux/Mac
# venv\Scripts\activate        # Windows

pip install -r requirements.txt
python main.py
```

Open in browser: **http://localhost:8001**

---

## Architecture

```
NEXUS/
├── main.py                # Entry point — defaults to port 8001
├── app/
│   ├── __init__.py        # FastAPI factory + IST logging
│   ├── scheduler.py       # APScheduler background data fetcher
│   ├── websocket.py       # WebSocket connection manager
│   ├── routers/           # API endpoints (flights, satellites, launches, seismic, space, ws)
│   └── services/          # Data source clients (OpenSky, CelesTrak, USGS, SpaceDevs…)
├── static/
│   ├── index.html         # Single-page app
│   ├── css/nexus.css      # Dark enterprise theme
│   └── js/
│       ├── globe.js       # CesiumJS 1.111 3D globe + imagery provider management
│       ├── effects.js     # NVG / Thermal / CRT / Bloom post-processing
│       ├── layers/        # One module per data layer
│       │   ├── satellites.js   # SGP4 propagation + satellite tracking
│       │   ├── flights.js      # Real-time flight dead-reckoning
│       │   ├── launches.js     # Upcoming rocket launches
│       │   ├── seismic.js      # Earthquake visualization
│       │   ├── space.js        # Solar system: planets, Sun, Moon, black holes, galaxies
│       │   ├── neo.js          # Near-Earth objects
│       │   └── iss.js          # ISS tracking + ground track
│       └── ui/
│           ├── controls.js     # Search, imagery selector, layer toggles, refresh
│           └── panels.js       # Entity detail panels + TRACK / ORBIT PATH buttons
├── data/nexus.db          # SQLite TTL cache (auto-created)
└── logs/nexus.log         # Server logs in IST
```

---

## Data Sources (All Free)

| Source | API | Rate Limit | Cache TTL |
|--------|-----|------------|-----------|
| CelesTrak | celestrak.org | None | 2 hours |
| SatNOGS (fallback) | db.satnogs.org/api/tle/ | None | 2 hours |
| OpenSky Network | opensky-network.org | 100/hr anon | 120 s |
| ADS-B.fi (fallback) | api.adsb.fi/v1/aircraft | None | 120 s |
| USGS Earthquakes | earthquake.usgs.gov | None | 5 min |
| Space Devs (dev) | lldev.thespacedevs.com/2.2.0 | None (dev) | 1 hr |
| Open Notify (ISS) | api.open-notify.org | None | 5 s |
| NASA NeoWs | api.nasa.gov/neo | 30/hr DEMO_KEY | 1 hr |
| NOAA SWPC | services.swpc.noaa.gov | None | 15 min |
| GPSJam | gpsjam.org/data/YYYY-MM-DD.csv | None | 1 hr |
| Nominatim | nominatim.openstreetmap.org | 1/s | Client |
| ESRI tiles | server.arcgisonline.com | None | Browser |
| CartoDB tiles | CDN | None | Browser |

---

## Resilience Strategy

The app uses a multi-layer data resilience approach:

1. **SQLite TTL cache** — every API response is stored with an expiry. Persists across restarts so cold starts serve data immediately.
2. **Stale-cache fallback** — if fresh data is unavailable (rate limit, outage), the last-known-good cached value is served with a `[CACHED]` tag.
3. **Source fallback chain** — OpenSky → ADS-B.fi → cached → stale. CelesTrak → SatNOGS on 403.
4. **Dev endpoints** — Space Devs dev server has no rate limit, used for launches.
5. **Client-side computation** — satellite positions computed in-browser via satellite.js at 60fps; server only serves TLE data every 2 hours.

---

## Optional Enhancements

### Cesium Ion Token (FREE)
Enables Google Maps Satellite imagery + HD 3D terrain.
1. Sign up at https://cesium.com/ion/signup
2. In the UI: click ⚙ Settings → paste your token → Apply
3. Or add to `.env`: `CESIUM_ION_TOKEN=your_token`

### OpenSky Account (FREE)
Enables 100/hr rate limit per account (vs anonymous shared pool).
```
OPENSKY_USERNAME=yourusername
OPENSKY_PASSWORD=yourpassword
```

### NASA API Key (FREE)
Higher rate limits for NEO data.
```
NASA_API_KEY=your_key
```

---

## API Endpoints

```
GET  /api/satellites/          TLE data (group param)
GET  /api/satellites/search    Search by name/NORAD ID
GET  /api/flights/             All flights (source=opensky|adsbfi)
GET  /api/flights/gpsjam       GPS jamming hex grid
GET  /api/seismic/             Earthquakes (mag, period filters)
GET  /api/launches/upcoming    Upcoming rocket launches
GET  /api/launches/pads        All launch pads worldwide
GET  /api/launches/iss         ISS position + crew
GET  /api/space/neo            Near-Earth objects (NASA NeoWs)
GET  /api/space/space-weather  NOAA KP index
GET  /api/space/black-holes    Known black hole catalog
GET  /api/space/apod           NASA Astronomy Picture of the Day
WS   /ws/flights               Real-time flights (120s push, source-tagged)
WS   /ws/iss                   Real-time ISS (5s push)
GET  /api/health               System health check
GET  /api/docs                 Swagger UI (interactive)
```

---

## Troubleshooting

**Port already in use:**
- `start.bat` automatically kills stale processes. Just run it again.

**Flights showing 0:**
- App falls back to ADS-B.fi, then to stale cache. Check status bar — `[CACHED]` means last-known-good data is shown.

**Globe appears black:**
- CartoDB Dark Matter tiles require internet. Check browser Network tab.

**Satellites not showing:**
- Toggle ON in the sidebar. Check browser console for satellite.js propagation errors.
- CelesTrak may be rate-limited from some IPs — SatNOGS fallback activates automatically.

**Planets/Moon look tiny:**
- Zoom in on the space view — objects scale with distance. Planets use billboard scaling visible from orbit altitude.

**Debug:**
- Swagger UI: http://localhost:8001/api/docs
- Health check: http://localhost:8001/api/health
- Logs: `logs/nexus.log` (timestamps in IST)

---

**Stack:** Python FastAPI · CesiumJS 1.111 · satellite.js · SQLite · APScheduler
