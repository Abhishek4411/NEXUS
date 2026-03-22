# NEXUS — Global Intelligence Platform
## Project Notes & Change Log

---

## Overview

**NEXUS** is a real-time, open-source geospatial intelligence dashboard inspired by Palantir's visualization capabilities. It fuses live satellite tracking, global flight data, earthquake monitoring, rocket launches, maritime data, and space intelligence on a 3D globe — all using 100% free and publicly available data sources, with zero cost to run.

**Author:** Built with Claude Code
**Started:** 2026-03-20
**Status:** Active Development
**Stack:** Python (FastAPI) + JavaScript (CesiumJS) + SQLite

---

## Architecture

```
nexus/
├── main.py                 # Entry point (uvicorn launcher)
├── requirements.txt        # Python dependencies
├── .env / .env.example     # Configuration
├── start.bat / start.sh    # OS-specific launchers
│
├── app/                    # FastAPI backend
│   ├── __init__.py         # App factory (create_app)
│   ├── scheduler.py        # Background data fetcher (APScheduler)
│   ├── websocket.py        # WebSocket connection manager
│   ├── routers/
│   │   ├── satellites.py   # GET /api/satellites/
│   │   ├── flights.py      # GET /api/flights/
│   │   ├── seismic.py      # GET /api/seismic/
│   │   ├── launches.py     # GET /api/launches/
│   │   ├── space.py        # GET /api/space/ (NEO, APOD, space weather)
│   │   └── ws.py           # WebSocket /ws/flights, /ws/iss
│   └── services/
│       ├── cache.py        # SQLite cache (TTL-based)
│       ├── celestrak.py    # CelesTrak TLE satellite data
│       ├── opensky.py      # OpenSky Network flights
│       ├── usgs.py         # USGS earthquake data
│       └── spacedevs.py    # Space Devs launches + ISS
│
├── static/                 # Frontend (served by FastAPI StaticFiles)
│   ├── index.html          # Main SPA
│   ├── css/nexus.css       # Dark enterprise theme
│   └── js/
│       ├── app.js          # Main init + orchestration
│       ├── globe.js        # CesiumJS 3D globe
│       ├── effects.js      # Post-processing (NVG/thermal/CRT/bloom)
│       ├── layers/
│       │   ├── satellites.js  # TLE-based satellite tracking
│       │   ├── flights.js     # Real-time flight tracking (WS)
│       │   ├── seismic.js     # Earthquake visualization
│       │   ├── launches.js    # Launch pads + upcoming
│       │   └── iss.js         # ISS real-time (WS)
│       └── ui/
│           ├── controls.js    # Layer toggles, sliders, presets
│           └── panels.js      # Entity detail panel + toasts
│
├── data/nexus.db           # SQLite cache database
├── logs/nexus.log          # Application log
└── PROJECT_NOTES.md        # This file
```

---

## Data Sources (All Free, Open)

| Layer | Source | API | Rate Limit | Cache TTL |
|-------|---------|-----|------------|-----------|
| Satellites | CelesTrak | `celestrak.org/SPACETRACK/query/` | None | 2 hours |
| Flights | OpenSky Network | `opensky-network.org/api/` | 100/hr anon | 15 seconds |
| Earthquakes | USGS | `earthquake.usgs.gov/fdsnws/` | None | 5 minutes |
| Launches | The Space Devs | `ll.thespacedevs.com/2.2.0/` | 15/hr free | 1 hour |
| ISS Position | Open Notify | `api.open-notify.org/iss-now.json` | None | 5 seconds |
| Near-Earth Objects | NASA NeoWs | `api.nasa.gov/neo/` | DEMO_KEY | 1 hour |
| Space Weather | NOAA SWPC | `services.swpc.noaa.gov/` | None | 15 min |
| Astronomy Photo | NASA APOD | `api.nasa.gov/planetary/apod` | DEMO_KEY | 6 hours |
| Globe Imagery | CartoDB Dark Matter | tile CDN | None | Browser |
| 3D Globe Engine | CesiumJS | CDN | None | Browser |
| Satellite Positions | satellite.js | CDN | None | Client-side |

---

## Key Technical Decisions

### Why FastAPI?
- Async-native: perfect for multiple concurrent API calls
- Built-in WebSocket support: real-time push for flights + ISS
- Serves static files (frontend) from same server
- Auto-generated API docs at `/api/docs`

### Why CesiumJS?
- Best free 3D globe library (Google-quality)
- Works without a Cesium Ion token (CartoDB dark imagery)
- satellite.js integration for real-time orbit computation
- Built-in post-processing pipeline (bloom, brightness, etc.)
- Used in real defense/intelligence applications

### Why SQLite Cache?
- Zero config — no Redis/Postgres needed
- Persists between restarts (warm cache)
- TTL-based expiry managed in Python
- Enough for single-user or small team usage

### Satellite Position Computation
- **NOT** computed server-side (would require `sgp4` Python calls for thousands of sats)
- Computed **client-side** using `satellite.js` (CDN, browser-native)
- Backend serves TLE data (cached 2hr) → frontend re-computes every 2 seconds
- This is highly efficient: server only needs to serve cached JSON

### WebSocket Architecture
- `/ws/flights` → pushes OpenSky data every 15 seconds
- `/ws/iss` → pushes ISS position every 5 seconds
- Auto-reconnect on disconnect (10s delay)
- Falls back to REST polling if WS unavailable

---

## Visual Modes

| Mode | Effect | CSS Class |
|------|--------|-----------|
| Normal | Default CesiumJS rendering | — |
| NVG | Green tint + brightness boost | `.nvg-mode` |
| Thermal | High saturation + contrast | `.thermal-mode` |
| CRT | Scanline overlay | `.crt-mode` |
| Bloom | Glow effect via CesiumJS PostProcessStage | — |

---

## API Endpoints

```
GET  /api/satellites/          All satellites (TLE data)
GET  /api/satellites/search    Search by name or NORAD ID
GET  /api/satellites/{id}      Single satellite by NORAD ID
GET  /api/satellites/groups    List available groups

GET  /api/flights/             All global flights
GET  /api/flights/bbox         Flights in bounding box

GET  /api/seismic/             Earthquakes (filter by mag/period)
GET  /api/seismic/significant  Mag 4.5+ past week

GET  /api/launches/upcoming    Upcoming launches worldwide
GET  /api/launches/past        Past launches
GET  /api/launches/pads        All launch pads with coordinates
GET  /api/launches/iss         ISS position + crew

GET  /api/space/black-holes    Known black holes
GET  /api/space/neo            Near-Earth objects (today)
GET  /api/space/apod           NASA Astronomy Picture of the Day
GET  /api/space/space-weather  KP index, solar storm data
GET  /api/space/bodies         Solar system bodies

WS   /ws/flights               Real-time flight stream (15s)
WS   /ws/iss                   Real-time ISS position (5s)
GET  /api/health               System health check
GET  /api/docs                 Interactive API docs (Swagger)
```

---

## Satellite Groups Available

| Group Key | Description |
|-----------|-------------|
| `active` | All ~5,000 active satellites |
| `starlink` | SpaceX Starlink constellation |
| `stations` | ISS, Tiangong, etc. |
| `gps` | GPS/NAVSTAR satellites |
| `glonass` | Russian GLONASS |
| `galileo` | EU Galileo |
| `beidou` | Chinese BeiDou |
| `weather` | Weather satellites |
| `geo` | Geostationary belt |
| `amateur` | Amateur radio satellites |

---

## Camera Presets

| Location | Lat | Lon | Alt |
|----------|-----|-----|-----|
| New York | 40.7128 | -74.006 | 500km |
| London | 51.5074 | -0.1278 | 500km |
| Tokyo | 35.6762 | 139.6503 | 500km |
| Delhi | 28.6139 | 77.209 | 500km |
| ISRO SDSC | 28.538 | 77.321 | 50km |
| Kennedy Space Center | 28.472 | -80.578 | 50km |
| Baikonur | 45.922 | 63.342 | 100km |
| Full Globe | 0 | 0 | 25,000km |

---

## Setup Instructions

### Prerequisites
- Python 3.10+
- Internet connection (for live data APIs)

### Quick Start (Windows)
```batch
start.bat
```

### Manual Setup
```bash
python -m venv venv
venv\Scripts\activate          # Windows
# source venv/bin/activate     # Linux/Mac

pip install -r requirements.txt
python main.py
```

Open: http://localhost:8000

---

## Optional Enhancements

### Cesium Ion Token (FREE)
- Sign up: https://cesium.com/ion/signup
- Enables: HD satellite imagery, 3D terrain, global 3D buildings
- Enter token in Settings (⚙) in the UI
- Without token: CartoDB Dark Matter imagery (still beautiful)

### OpenSky Account (FREE)
- Sign up: https://opensky-network.org/
- Enables: Higher rate limits (unlimited vs 100/hr anon)
- Add to `.env`: `OPENSKY_USERNAME=user` `OPENSKY_PASSWORD=pass`

### Space Devs API Key (FREE)
- Sign up: https://thespacedevs.com/
- Enables: More API calls per hour (15 → more)
- Add to `.env`: `SPACEDEVS_TOKEN=your_token`

### NASA API Key (FREE)
- Get at: https://api.nasa.gov/
- Enables: Higher rate limits for NEO and APOD endpoints
- Add to `.env`: `NASA_API_KEY=your_key`

---

## Planned Features (Roadmap)

### Phase 2
- [ ] Maritime tracking (AIS ship data via aisstream.io free API)
- [ ] GPS jamming overlay (gpsjam.org data)
- [ ] Historical playback mode with timeline scrubbing
- [ ] CCTV feed integration (Austin/NYC open traffic cameras)
- [ ] Planet 3D visualization (Three.js solar system view)
- [ ] Satellite launch trajectory animation

### Phase 3
- [ ] Data export (GeoJSON, KML)
- [ ] Alert system (earthquake mag > 6, upcoming launch T-1hr)
- [ ] Offline mode with cached data
- [ ] Multi-user support
- [ ] Mobile-responsive layout
- [ ] Dark/DKMS satellite data integration
- [ ] Stellar object catalog overlay (HYG database)

### Phase 4
- [ ] AI-powered anomaly detection
- [ ] Correlation engine (satellite overflight + events)
- [ ] Custom data source plugins
- [ ] Docker deployment
- [ ] Electron desktop app wrapper

---

## Change Log

### v1.2.0 — 2026-03-20
**Fixed:**
- `WinError 10013` on `start.bat` — changed server bind from `0.0.0.0` to `127.0.0.1` (avoids Windows Firewall block)
- `start.bat` now kills stale processes on ports 8000-8020 before starting
- `main.py` auto-scans ports 8000–8019 and binds to first free one (no more `Address already in use`)
- Flights showing 0: WebSocket `/ws/flights` now falls back to ADS-B.fi when OpenSky returns empty (rate-limited or down)
- Status bar shows flight source `[OPENSKY]` / `[ADSB.FI]` + timestamp of last push

**Improved:**
- Globe init is now async: loads **Google Maps Satellite** (Ion asset 3830183) + **Cesium World Terrain** (Ion asset 1) when token is set
- Falls back to CartoDB Dark Matter if no Ion token (unchanged visual quality for free users)
- Satellite icons: type-differentiated SVG billboards instead of plain dots
  - Space stations (ISS): gold cross with solar panels
  - Starlink: flat blue rectangles
  - GPS/GLONASS/Galileo: green hexagons
  - Weather: orange circles with crosses
  - Generic: cyan satellite crosses
- Flight icons: SVG airplane silhouettes (bird's-eye) that **rotate to match the aircraft heading**
  - Cruising (>10km): blue planes
  - Climbing (3–10km): green planes
  - Low altitude (<3km): yellow planes
  - On ground: small gray dots

**New features:**
- Near-Earth Objects (NEO) now render on the 3D globe as asteroid icons
  - Red/irregular shape for hazardous NEOs, orange for non-hazardous
  - Altitude position is symbolic (scaled by log of miss distance); actual distance shown in panel
  - Click to see name, miss distance, velocity, diameter, approach date, NASA JPL link
- NEO toggle shows count in sidebar

**Updated:**
- Space Devs API upgraded to **v2.3.0** using `https://lldev.thespacedevs.com/2.3.0` (dev server, no rate limits)
- `setImagery()` now supports Google Maps Satellite via Ion async API
- Version bump: NEXUS v1.0 → v1.2 in status bar

**Space / Environment:**
- **Stars**: Tycho2 star catalog sky box (2.5 million stars) enabled by default
- **Sun**: renders at correct ecliptic position, casts real shadows
- **Moon**: renders at correct position relative to Earth
- **Atmosphere**: Earth limb blue glow + ground horizon haze enabled
- **Day/night**: globe surface shows real sun terminator lighting

**Smooth animations:**
- Satellites: SGP4 propagation every 1s + linear position interpolation at 60fps (via `preRender`)
- Flights: velocity dead-reckoning every 1s for smooth motion between 120s WS pushes

**Rate limiting fixes:**
- OpenSky scheduler: 15s → 120s (was 480 req/hr, now 30 req/hr — well under 100/hr anon limit)
- OpenSky cache TTL: 15s → 120s
- WebSocket handler now reads from cache ONLY (no direct API calls — eliminates duplicate hits)
- ADS-B.fi v1 API (404) → multi-source fallback: tries v1, v2, adsb.lol, airplanes.live in order
- Flight source displayed in status bar: `FLT[OPENSKY]` or `FLT[ADSB.FI]` + last-push timestamp

---

### v1.5.0 — 2026-03-20
**Data Persistence — Flights & Launches Never Show 0:**
- Added `cache.get_stale(key)` to `CacheService` — returns last-known-good data even after TTL expires
- WebSocket flights handler uses 3-tier fallback: OpenSky fresh → ADSB.fi fresh → **stale any-source**
- Status bar shows `[CACHED]` when serving stale data so user knows it's not fresh
- Flights will now always show last known data instead of 0 when rate-limited

**Solar System Layer — Major Upgrade:**
- Real-time astronomical position algorithms for **Sun** (accurate to ~1°) and **Moon** (accurate to ~5°)
  - Based on standard low-precision solar/lunar equations (J2000.0 epoch)
  - Positions recalculate every **60 seconds** automatically
- All space objects support **TRACK** button → camera flies to and centers on the object
- All dynamic objects (Sun/Moon) have continuous camera re-center every 30s while tracked
- **Orbit paths**: click "ORBIT PATH" button to show computed orbit arc:
  - Moon: 29.5-day orbit rendered as cyan polyline
  - Sun: 365-day apparent ecliptic path
- Planets sized **relatively** (Jupiter 30px, Saturn 27px, Uranus/Neptune 22px, Earth-sized ~17px, Mercury 14px)
- `SpaceLayer.search(query)` method — searches all objects locally (no network call)

**Search Bar — Full Cosmos Search:**
- Searching "Mars", "Jupiter", "Moon", "Sagittarius A*", "Andromeda" etc. now finds space objects
- Click result → SOLAR SYSTEM layer auto-enables → camera flies to and centers on object
- Results now show 3 categories: 🛰 Satellites + 📍 Geocoded Places + ⭐/🪐/🌌 Space Objects

**↺ Refresh Button:**
- Added refresh icon (↺) to top bar — refreshes all active layers without a browser reload
- Re-fetches satellites, earthquakes, launches, NEOs in parallel

**Earth Rotation & Star Field:**
- CesiumJS natively handles Earth's rotation in the correct inertial reference frame
- Tycho2 star skybox is fixed in ICRF (correct — stars don't rotate with Earth)
- Sun and Moon rendered by CesiumJS at true ecliptic positions (shadows/lighting accurate)
- Camera tracks any object while Earth rotates correctly beneath it

---

### v1.4.0 — 2026-03-20
**Fixed:**
- **Earth stripes / claw marks** — removed MODIS cloud layer from default load. The WMTS tiles had seam gaps at certain zoom levels causing diagonal stripes. Cloud layer removed; ESRI base still looks perfectly realistic.
- **Camera tracking locks user out** — `viewer.camera.lookAt()` was called every second, snapping camera back whenever user tried to zoom/pan. Fixed: tracking now does a **one-time flyTo** to the satellite then releases camera completely. User can freely zoom/pan/rotate; orbit path stays visible.
- **Dual server instances (8000 + 8001)** — `start.bat` now kills ALL `python.exe` instances (not just by port) before starting. `main.py` now defaults to port **8001**, skipping 8000.
- **Launches showing 0** — Space Devs v2.3.0 doesn't exist on dev server (404). Reverted to v2.2.0 (`lldev.thespacedevs.com/2.2.0`).
- **Search only worked for satellites** — Added Nominatim (OpenStreetMap) geocoding. Now searches both satellites AND real places (cities, countries, airports). Click a city → flies to it at street level.

**New Imagery Modes (Settings → Imagery Provider):**
- `Hybrid` — ESRI Satellite + street labels overlay (best of both)
- `OpenStreetMap` — full streets, POI names, all labels
- `Terrain` — Stadia terrain map with city names
- `Light Map` — CartoDB Positron, clean light labels
- `Dark Matter` — CartoDB dark mode (unchanged)

**UI Changes:**
- "NEAR-EARTH OBJ." renamed to "ASTEROIDS / NEO" (clearer)
- "BLACK HOLES" toggle removed — black holes now included in "SOLAR SYSTEM" layer
- "SPACE OBJECTS" renamed to "SOLAR SYSTEM" toggle

---

### v1.3.0 — 2026-03-20
**Critical Bug Fixes:**
- `TypeError: e.isIon is not a function` crash (FPS drops to 1, globe freezes) — CesiumJS 1.111 incompatibility with `ArcGisMapServerImageryProvider`
  - Fixed: Replaced with `UrlTemplateImageryProvider` using ESRI tile URL template `…/MapServer/tile/{z}/{y}/{x}`
- GIBS WMTS cloud layer crash — removed broken `times`/`clock` dynamic parameters
  - Fixed: Date now embedded directly in URL (e.g. `…/default/2026-03-19/…`) — static per session, always works

**New Features:**
- **Space Objects layer** (`space.js`) — 15 clickable celestial objects rendered in 3D space around Earth:
  - Sun, Moon (with dynamic RA/Dec from current time)
  - 7 planets: Mercury, Venus, Mars, Jupiter, Saturn, Uranus, Neptune
  - Black Holes: Gaia BH1, Gaia BH2, Sagittarius A\*, M87\*
  - Galaxies: Andromeda (M31), Milky Way Core
  - Each has SVG icon (circle, galaxy spiral, or black hole accretion disk)
  - Click any object → rich detail panel (distance, diameter, mass, description, etc.)
  - Toggle via sidebar "SPACE OBJECTS" switch
- **Space Object Detail Panel** (`panels.js`) — renders all data fields with proper labels for each object type
- **IST Timestamps everywhere** — all times now shown in Indian Standard Time (UTC+5:30):
  - Top bar clock: `2026-03-20 18:30:00 IST`
  - Flight status bar: `FLT[OPENSKY]: 5,234 @18:30 IST`
  - Upcoming launches list: dates in IST
  - Python backend logs: all timestamps in IST (using custom `_ISTFormatter`)

---

### v1.1.0 — 2026-03-20
**Added:**
- ADS-B.fi as alternative/supplemental flight source (`/api/flights/?source=adsbfi`)
  - Community-run, free, no auth, broader coverage than OpenSky alone
  - Some military flights appear that OpenSky misses
  - Use: toggle in UI or via `?source=adsbfi` query param
- GPSJam overlay (`/api/flights/gpsjam`)
  - Daily GPS interference data from gpsjam.org (H3 hexagonal grid cells)
  - Shows severity: low/medium/high/extreme based on % good GPS
  - Useful for monitoring conflict zones and jamming events
- `app/services/adsbfi.py` — ADS-B.fi service
- `app/services/gpsjam.py` — GPSJam CSV data service
- Updated flights router to support both OpenSky and ADS-B.fi sources

**Change log notes:**
- CelesTrak blocked from datacenter IPs (403) — SatNOGS fallback works great (1,526 sats)
- CelesTrak works fine from home/office residential IPs
- Space Devs dev server: `https://lldev.thespacedevs.com/2.2.0/` has higher rate limits for dev

---

### v1.0.0 — 2026-03-20 (Initial Build)
**Added:**
- Full FastAPI backend with SQLite caching
- CesiumJS 3D globe with CartoDB dark imagery
- Satellite tracking: all active ~5,000 satellites via CelesTrak TLE
- 8 satellite groups: active, starlink, stations, GPS, GLONASS, weather, GEO, amateur
- Real-time flight tracking via OpenSky Network WebSocket feed (~6,700 flights)
- Earthquake layer: USGS data (magnitude 2.5+, filter by period)
- Rocket launches: Space Devs API (SpaceX, ISRO, DRDO, NASA, ESA, CNSA, Roscosmos)
- Launch pad map with upcoming launch indicators
- ISS real-time tracking with ground track
- Near-Earth Objects: NASA NeoWs API
- Black holes catalog: Gaia BH1, Gaia BH2, Sgr A*, M87*
- Space weather: NOAA KP index
- NASA APOD
- 4 visual modes: Normal, NVG (Night Vision), Thermal, CRT
- Bloom post-processing
- Brightness control
- Entity click-to-inspect panel
- Satellite search by name or NORAD ID
- Orbit path visualization (90-minute ground track)
- Camera presets (8 locations)
- UTC clock
- Toast notifications
- Background scheduler: auto-refresh all data on optimal intervals
- Settings modal (Cesium Ion token, OpenSky credentials, imagery provider)
- Windows start.bat and Unix start.sh launchers

**Architecture decisions:**
- Satellite positions computed client-side (satellite.js) for efficiency
- SQLite cache to minimize API calls and respect rate limits
- WebSocket for flights + ISS; REST for slower-changing data
- Single-binary deployment: FastAPI serves both API and frontend

---

## Notes on Rate Limits

The app is designed to be very respectful of free API limits:

- **OpenSky**: Cached 15 seconds. Even with 1 user, max ~240 calls/hour (well under 100/hr anon). Add account for more.
- **Space Devs**: Cached 1 hour. Refresh cycle = max ~1 call/hour per endpoint.
- **USGS**: No rate limit. Refresh every 5 minutes.
- **CelesTrak**: No rate limit. Refresh every 2 hours.
- **NASA**: DEMO_KEY allows 30 requests/hour, 50/day. Add your own key for more.
- **CartoDB tiles**: No rate limit for reasonable usage.

---

## Debugging

### Logs
- Application: `logs/nexus.log`
- Browser: F12 → Console

### API Testing
- Swagger UI: http://localhost:8000/api/docs
- Health check: http://localhost:8000/api/health

### Common Issues

**"Satellite positions not showing"**
- Check browser console for satellite.js errors
- Verify TLE data loading: http://localhost:8000/api/satellites/?group=active

**"No flights showing"**
- OpenSky may be rate limited (anonymous limit: 100 req/hr)
- Check: http://localhost:8000/api/flights/
- Add OpenSky credentials to .env for higher limits

**"Launches not loading"**
- Space Devs free tier: 15 requests/hour
- Data cached for 1 hour after first fetch
- Check: http://localhost:8000/api/launches/upcoming

**"Globe looks blank"**
- CartoDB tiles require internet
- Try different imagery in Settings
- Check browser network tab for tile loading errors

---

## Data Flow Summary

```
[CelesTrak] ──TLE──► [Backend Cache] ──JSON──► [Frontend]
                                                    │
                                               satellite.js
                                                    │
                                              [CesiumJS Globe]
                                              (positions updated every 2s)

[OpenSky] ──flights──► [Backend Cache] ──WS──► [Frontend]
                                               (pushes every 15s)

[USGS] ──quakes──► [Backend Cache] ──REST──► [Frontend]
                                             (refresh every 5min)

[SpaceDevs] ──launches──► [Backend Cache] ──REST──► [Frontend]
                                                    (refresh every 1hr)

[OpenNotify] ──ISS──► [Backend Cache] ──WS──► [Frontend]
                                              (pushes every 5s)
```
