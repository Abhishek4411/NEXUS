/**
 * NEXUS Flight Layer
 * Real-time flight tracking via WebSocket → OpenSky Network.
 * Renders aircraft as directional SVG airplane icons on the globe.
 * Icons rotate to match the aircraft's heading. Updates every 15 seconds.
 */

const FlightLayer = (() => {
  let viewer = null;
  let entities = new Map();  // icao24 -> entity
  let ws = null;
  let visible = true;
  let flightCount = 0;

  // ── Airplane SVG icons (bird's-eye view, nose pointing up) ──────────────
  // Pre-generated and cached — same URI reused for all planes of same color.
  const _iconCache = {};

  function _planeIcon(hex) {
    if (_iconCache[hex]) return _iconCache[hex];
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20">
      <polygon points="10,1 12,8 10,7 8,8" fill="${hex}" stroke="#000408" stroke-width="0.8"/>
      <polygon points="10,5 0.5,12 3.5,12 10,9 16.5,12 19.5,12" fill="${hex}" stroke="#000408" stroke-width="0.8"/>
      <polygon points="10,12 7,17 13,17" fill="${hex}" stroke="#000408" stroke-width="0.8"/>
    </svg>`;
    const uri = `data:image/svg+xml;base64,${btoa(svg)}`;
    _iconCache[hex] = uri;
    return uri;
  }

  // Ground icon: small dim circle
  const GROUND_ICON = (() => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 10 10">
      <circle cx="5" cy="5" r="4" fill="#555" stroke="#333" stroke-width="1"/>
    </svg>`;
    return `data:image/svg+xml;base64,${btoa(svg)}`;
  })();

  // Color palette by altitude/status
  const COLORS = {
    cruising: '#00aaff',  // blue — above 10km
    climbing: '#00ff88',  // green — 3–10km
    low:      '#ffcc00',  // yellow — below 3km
    ground:   '#666666',  // gray
  };

  function _colorFor(f) {
    if (f.on_ground) return COLORS.ground;
    const alt = f.baro_altitude || f.geo_altitude || 0;
    if (alt > 10000) return COLORS.cruising;
    if (alt > 3000)  return COLORS.climbing;
    return COLORS.low;
  }

  // ── Smooth animation: dead-reckoning between WS updates ──────────────────
  // Updates entity positions at 60fps using heading + speed for smooth motion.
  let _drTimer = null;
  const DR_INTERVAL = 1000; // dead-reckoning update interval ms

  function _startDeadReckoning() {
    if (_drTimer) clearInterval(_drTimer);
    _drTimer = setInterval(() => {
      if (!visible) return;
      const dt = DR_INTERVAL / 1000; // seconds
      entities.forEach((ent, id) => {
        const data = ent.properties?.data?.getValue?.();
        if (!data || data.on_ground || !data.velocity || !data.true_track) return;
        const pos = ent.position?.getValue?.(Cesium.JulianDate.now?.() || new Cesium.JulianDate());
        if (!pos) return;
        const carto = Cesium.Cartographic.fromCartesian(pos);
        const lat = Cesium.Math.toDegrees(carto.latitude);
        const lon = Cesium.Math.toDegrees(carto.longitude);
        const altM = carto.height;
        const headingRad = Cesium.Math.toRadians(data.true_track);
        const earthR = 6371000 + altM;
        const distM = data.velocity * dt;
        const dLat = (distM * Math.cos(headingRad)) / earthR * (180 / Math.PI);
        const dLon = (distM * Math.sin(headingRad)) / (earthR * Math.cos(carto.latitude)) * (180 / Math.PI);
        ent.position = Cesium.Cartesian3.fromDegrees(lon + dLon, lat + dLat, altM);
      });
    }, DR_INTERVAL);
  }

  // ── Module init ──────────────────────────────────────────────────────────

  function init(cesiumViewer) {
    viewer = cesiumViewer;
    _startDeadReckoning();
    console.log('✅ Flight layer initialized');
  }

  // ── WebSocket connection ─────────────────────────────────────────────────

  function connect() {
    if (ws) ws.close();
    const wsUrl = `ws://${window.location.host}/ws/flights`;
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log('✈️ Flight WS connected');
      NexusToast.show('Flight tracking connected', 'success');
    };

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'flights') {
          flightCount = msg.count;
          _updateFlights(msg.data);
          const srcTag = msg.source === 'adsbfi' ? ' [ADSB.FI]'
            : msg.source === 'cached' ? ' [CACHED]'
            : msg.source === 'none' ? ' [NO DATA]'
            : ' [OPENSKY]';
          const ist = new Date(Date.now() + 19800000);
          const pad = n => String(n).padStart(2, '0');
          const now = `${pad(ist.getUTCHours())}:${pad(ist.getUTCMinutes())} IST`;
          const el = document.getElementById('count-flights');
          if (el) el.textContent = flightCount.toLocaleString();
          const stat = document.getElementById('stat-flt');
          if (stat) stat.textContent = flightCount.toLocaleString() + srcTag;
          const sb = document.getElementById('status-flights');
          if (sb) sb.textContent = `FLT${srcTag}: ${flightCount.toLocaleString()} @${now}`;
        }
      } catch (e) { console.error('Flight WS parse error:', e); }
    };

    ws.onerror = () => NexusToast.show('Flight WS error', 'error');
    ws.onclose = () => {
      console.log('✈️ Flight WS closed, reconnecting in 10s…');
      setTimeout(() => { if (visible) connect(); }, 10000);
    };
  }

  // ── Entity management ────────────────────────────────────────────────────

  function _updateFlights(flights) {
    if (!visible) return;
    const seen = new Set();
    const altKm = NexusGlobe.getCameraAltKm();
    const showLabels = altKm < 2000;

    for (const f of flights) {
      if (!f.longitude || !f.latitude) continue;
      const id = f.icao24;
      seen.add(id);

      const altM = Math.max(f.baro_altitude || f.geo_altitude || 0, f.on_ground ? 0 : 500);
      const cartesian = Cesium.Cartesian3.fromDegrees(f.longitude, f.latitude, altM);
      const colorHex = _colorFor(f);
      const heading = f.true_track || 0;
      // Cesium billboard rotation: positive = CCW; heading is CW from North
      const rotation = -Cesium.Math.toRadians(heading);

      if (entities.has(id)) {
        const ent = entities.get(id);
        ent.position = cartesian;
        if (ent.billboard) {
          ent.billboard.image = f.on_ground ? GROUND_ICON : _planeIcon(colorHex);
          ent.billboard.rotation = rotation;
        }
        if (ent.label) ent.label.show = showLabels && !f.on_ground;
      } else {
        const icon = f.on_ground ? GROUND_ICON : _planeIcon(colorHex);
        const ent = viewer.entities.add({
          id: `flt-${id}`,
          position: cartesian,
          billboard: {
            image: icon,
            width:  f.on_ground ? 8 : 18,
            height: f.on_ground ? 8 : 18,
            rotation,
            alignedAxis: Cesium.Cartesian3.ZERO,
            verticalOrigin: Cesium.VerticalOrigin.CENTER,
            horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
            scaleByDistance: new Cesium.NearFarScalar(2e4, 1.4, 5e6, 0.4),
            distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 8e6),
          },
          label: {
            text: (f.callsign || id).trim().toUpperCase(),
            font: '9px Courier New',
            fillColor: Cesium.Color.fromCssColorString(colorHex),
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 2,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            pixelOffset: new Cesium.Cartesian2(0, -14),
            show: showLabels && !f.on_ground,
            distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 1.5e6),
          },
          properties: { type: 'flight', data: f },
        });
        entities.set(id, ent);
      }
    }

    // Remove stale flights
    entities.forEach((ent, id) => {
      if (!seen.has(id)) {
        viewer.entities.remove(ent);
        entities.delete(id);
      }
    });
  }

  // ── Public API ───────────────────────────────────────────────────────────

  function setVisible(v) {
    visible = v;
    entities.forEach(e => { e.show = v; });
    if (v && (!ws || ws.readyState !== WebSocket.OPEN)) connect();
    if (!v && ws) ws.close();
  }

  function disconnect() {
    if (ws) { ws.close(); ws = null; }
  }

  // Fallback: REST polling if WS unavailable
  async function pollRest() {
    try {
      const resp = await fetch('/api/flights/');
      const data = await resp.json();
      if (data.flights) _updateFlights(data.flights);
    } catch (e) { console.error('Flight REST poll error:', e); }
  }

  return { init, connect, setVisible, disconnect, pollRest };
})();
