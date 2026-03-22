/**
 * NEXUS Satellite Layer
 * Fetches TLE data from backend, computes real-time positions using satellite.js,
 * and renders satellites as type-differentiated SVG billboard icons on the globe.
 * Updates every 2 seconds. Click to track.
 *
 * Icon types by group:
 *   stations  → ISS cross/solar-panel shape (gold)
 *   starlink  → small rectangle (blue)
 *   gps/nav   → hexagon (green)
 *   weather   → circle with crosses (orange)
 *   generic   → small satellite cross (cyan)
 */

const SatelliteLayer = (() => {
  let viewer = null;
  let entities = new Map();        // norad_id -> Cesium entity
  let tleData = [];
  let satrecs = new Map();         // norad_id -> { satrec, meta }
  let updateTimer = null;
  let orbitPath = null;
  let trackedId = null;
  let _trackJustStarted = false;
  let visible = true;
  let currentGroup = 'active';

  // ── Pre-generated SVG billboard icons ────────────────────────────────────
  function _svg(content, size = 16) {
    const encoded = btoa(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${content}</svg>`);
    return `data:image/svg+xml;base64,${encoded}`;
  }

  const ICONS = {
    // ISS / Space Stations — gold cross with solar panels
    station: _svg(`
      <rect x="7" y="2" width="2" height="12" fill="#ffd700" stroke="#000" stroke-width="0.5"/>
      <rect x="1" y="6" width="14" height="2" fill="#ffd700" stroke="#000" stroke-width="0.5"/>
      <rect x="0" y="5" width="3" height="4" fill="#aaeeff" opacity="0.8"/>
      <rect x="13" y="5" width="3" height="4" fill="#aaeeff" opacity="0.8"/>
      <circle cx="8" cy="8" r="1.5" fill="#ff8800"/>
    `, 16),

    // Starlink — flat rectangular body (blue)
    starlink: _svg(`
      <rect x="2" y="5" width="12" height="6" rx="1" fill="#0077ff" stroke="#000" stroke-width="0.5"/>
      <rect x="0" y="6" width="4" height="4" fill="#88ccff" opacity="0.7"/>
      <rect x="12" y="6" width="4" height="4" fill="#88ccff" opacity="0.7"/>
      <circle cx="8" cy="8" r="1" fill="#ffffff" opacity="0.6"/>
    `, 16),

    // GPS / GLONASS / Navigation — hexagon (green)
    gps: _svg(`
      <polygon points="8,1 13,4.5 13,11.5 8,15 3,11.5 3,4.5" fill="#00cc66" stroke="#000" stroke-width="0.5"/>
      <line x1="8" y1="1" x2="8" y2="15" stroke="#003" stroke-width="0.5" opacity="0.5"/>
      <line x1="3" y1="4.5" x2="13" y2="11.5" stroke="#003" stroke-width="0.5" opacity="0.5"/>
      <line x1="3" y1="11.5" x2="13" y2="4.5" stroke="#003" stroke-width="0.5" opacity="0.5"/>
      <circle cx="8" cy="8" r="2" fill="#00ff88"/>
    `, 16),

    // Weather satellites — circle with cardinal crosses
    weather: _svg(`
      <circle cx="8" cy="8" r="5" fill="#ff8800" stroke="#000" stroke-width="0.5"/>
      <line x1="8" y1="1" x2="8" y2="3" stroke="#000" stroke-width="1"/>
      <line x1="8" y1="13" x2="8" y2="15" stroke="#000" stroke-width="1"/>
      <line x1="1" y1="8" x2="3" y2="8" stroke="#000" stroke-width="1"/>
      <line x1="13" y1="8" x2="15" y2="8" stroke="#000" stroke-width="1"/>
      <circle cx="8" cy="8" r="2" fill="#ffcc44"/>
    `, 16),

    // Amateur / GEO / Generic — small satellite with two solar wings
    generic: _svg(`
      <rect x="6" y="5" width="4" height="6" fill="#00f0ff" stroke="#000" stroke-width="0.5"/>
      <rect x="1" y="6.5" width="5" height="3" fill="#00aacc" opacity="0.8"/>
      <rect x="10" y="6.5" width="5" height="3" fill="#00aacc" opacity="0.8"/>
      <circle cx="8" cy="8" r="1" fill="#ffffff" opacity="0.7"/>
    `, 16),
  };

  function _iconFor(meta, group) {
    if (group === 'stations' || meta.norad_id === 25544) return ICONS.station;
    if (group === 'starlink') return ICONS.starlink;
    if (group === 'gps' || group === 'glonass' || group === 'galileo' || group === 'beidou') return ICONS.gps;
    if (group === 'weather') return ICONS.weather;
    return ICONS.generic;
  }

  function _sizeFor(meta, group) {
    if (group === 'stations' || meta.norad_id === 25544) return 22;
    if (group === 'starlink') return 12;
    return 14;
  }

  // ── Module init ──────────────────────────────────────────────────────────

  function init(cesiumViewer) {
    viewer = cesiumViewer;
    console.log('✅ Satellite layer initialized');
  }

  async function loadGroup(group = 'active') {
    currentGroup = group;
    _clearEntities();
    try {
      const resp = await fetch(`/api/satellites/?group=${group}`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      tleData = data.satellites || [];
      satrecs.clear();

      for (const sat of tleData) {
        if (sat.tle_line1 && sat.tle_line2) {
          try {
            const satrec = satellite.twoline2satrec(sat.tle_line1, sat.tle_line2);
            satrecs.set(sat.norad_id, { satrec, meta: sat });
          } catch (e) { /* skip bad TLEs */ }
        }
      }

      const el = document.getElementById('count-satellites');
      if (el) el.textContent = tleData.length.toLocaleString();
      const stat = document.getElementById('stat-sat');
      if (stat) stat.textContent = tleData.length.toLocaleString();

      NexusToast.show(`Loaded ${tleData.length} satellites (${group})`, 'success');
      _startUpdateLoop();
    } catch (e) {
      console.error('Satellite load error:', e);
      NexusToast.show('Failed to load satellite data', 'error');
    }
  }

  // ── Position computation ─────────────────────────────────────────────────

  function _computePositions() {
    const now = new Date();
    const gmst = satellite.gstime(now);
    const positions = [];

    satrecs.forEach(({ satrec, meta }, noradId) => {
      try {
        const pv = satellite.propagate(satrec, now);
        if (!pv.position || pv.position === false) return;

        const geo = satellite.eciToGeodetic(pv.position, gmst);
        const lon = satellite.degreesLong(geo.longitude);
        const lat = satellite.degreesLat(geo.latitude);
        const altM = geo.height * 1000;  // km → m

        if (isNaN(lon) || isNaN(lat) || altM < 0) return;

        positions.push({ noradId, lon, lat, altM, meta,
          vx: pv.velocity.x, vy: pv.velocity.y, vz: pv.velocity.z });
      } catch (e) { /* propagation error — skip */ }
    });

    return positions;
  }

  // _updateEntities replaced by _createEntity + _smoothTick for 60fps interpolation

  // ── Smooth 60fps animation via interpolation ─────────────────────────────
  // Propagate SGP4 every 1 second; interpolate entity positions every frame.
  let _prevPositions = new Map();   // noradId -> Cartesian3 (position at last update)
  let _currPositions = new Map();   // noradId -> Cartesian3 (position at current update)
  let _lastUpdateMs = 0;
  const UPDATE_MS = 1000;           // SGP4 re-propagation interval (1s)
  const _scratch = new Cesium.Cartesian3();

  function _startUpdateLoop() {
    if (updateTimer) {
      clearInterval(updateTimer);
      viewer.scene.preRender.removeEventListener(_smoothTick);
    }

    // SGP4 propagation: every 1s
    updateTimer = setInterval(() => {
      if (!visible) return;
      const positions = _computePositions();
      _lastUpdateMs = Date.now();

      for (const { noradId, lon, lat, altM, meta } of positions) {
        const newPos = Cesium.Cartesian3.fromDegrees(lon, lat, altM);
        _prevPositions.set(noradId, _currPositions.get(noradId) || newPos);
        _currPositions.set(noradId, newPos);

        // Create entity if it doesn't exist yet
        if (!entities.has(noradId)) {
          _createEntity(noradId, newPos, meta);
        }
      }

      // Tracking: on first lock, fly to satellite centered on screen — then release camera
      if (trackedId !== null && _trackJustStarted) {
        _trackJustStarted = false;
        const pos = positions.find(p => p.noradId === trackedId);
        if (pos) {
          const center = Cesium.Cartesian3.fromDegrees(pos.lon, pos.lat, pos.altM);
          viewer.camera.flyToBoundingSphere(
            new Cesium.BoundingSphere(center, pos.altM * 0.3),
            {
              duration: 2,
              offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-30), pos.altM * 2.5),
            }
          );
        }
      }
    }, UPDATE_MS);

    // Smooth position interpolation: every Cesium frame (~60fps)
    viewer.scene.preRender.addEventListener(_smoothTick);

    // Initial propagation
    const positions = _computePositions();
    _lastUpdateMs = Date.now();
    for (const { noradId, lon, lat, altM, meta } of positions) {
      const pos = Cesium.Cartesian3.fromDegrees(lon, lat, altM);
      _prevPositions.set(noradId, pos);
      _currPositions.set(noradId, pos);
      if (!entities.has(noradId)) _createEntity(noradId, pos, meta);
    }
  }

  function _smoothTick() {
    if (!visible) return;
    const t = Math.min((Date.now() - _lastUpdateMs) / UPDATE_MS, 1.0);
    const altKm = NexusGlobe.getCameraAltKm();
    const showLabels = altKm < 5000;

    entities.forEach((ent, noradId) => {
      const prev = _prevPositions.get(noradId);
      const curr = _currPositions.get(noradId);
      if (!prev || !curr) return;
      Cesium.Cartesian3.lerp(prev, curr, t, _scratch);
      ent.position = _scratch.clone();  // clone to avoid shared mutation
      if (ent.label) ent.label.show = showLabels;
    });
  }

  function _createEntity(noradId, position, meta) {
    const icon = _iconFor(meta, currentGroup);
    const size = _sizeFor(meta, currentGroup);
    const ent = viewer.entities.add({
      id: `sat-${noradId}`,
      position,
      billboard: {
        image: icon,
        width: size,
        height: size,
        verticalOrigin: Cesium.VerticalOrigin.CENTER,
        horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
        scaleByDistance: new Cesium.NearFarScalar(1.5e5, 1.8, 2e7, 0.3),
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 3e7),
      },
      label: {
        text: meta.name || String(noradId),
        font: '10px Courier New',
        fillColor: Cesium.Color.fromCssColorString('#00f0ff'),
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 2,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(0, -14),
        show: false,
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 5e6),
      },
      properties: { type: 'satellite', data: meta },
    });
    entities.set(noradId, ent);
  }

  function _tick() { /* replaced by _startUpdateLoop above */ }

  // ── Orbit path ───────────────────────────────────────────────────────────

  function showOrbit(noradId) {
    _clearOrbit();
    const entry = satrecs.get(noradId);
    if (!entry) return;

    const { satrec } = entry;
    const points = [];
    const now = new Date();

    for (let i = 0; i <= 90; i++) {
      const t = new Date(now.getTime() + i * 60000);
      try {
        const pv = satellite.propagate(satrec, t);
        if (!pv.position || pv.position === false) continue;
        const gmst = satellite.gstime(t);
        const geo = satellite.eciToGeodetic(pv.position, gmst);
        const lon = satellite.degreesLong(geo.longitude);
        const lat = satellite.degreesLat(geo.latitude);
        const altM = geo.height * 1000;
        if (!isNaN(lon) && !isNaN(lat) && altM > 0) {
          points.push(Cesium.Cartesian3.fromDegrees(lon, lat, altM));
        }
      } catch (e) { /* skip */ }
    }

    if (points.length > 2) {
      orbitPath = viewer.entities.add({
        id: 'orbit-path',
        polyline: {
          positions: points,
          width: 1.5,
          material: new Cesium.PolylineGlowMaterialProperty({
            glowPower: 0.15,
            color: Cesium.Color.CYAN.withAlpha(0.6),
          }),
          clampToGround: false,
        },
      });
    }
  }

  function _clearOrbit() {
    if (orbitPath) { viewer.entities.remove(orbitPath); orbitPath = null; }
  }

  function trackSatellite(noradId) {
    trackedId = noradId;
    _trackJustStarted = true;
    // Release any existing camera lock so user can navigate freely
    viewer.trackedEntity = undefined;
    viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
    showOrbit(noradId);
    NexusToast.show('Tracking — zoom/pan freely, orbit path shown', 'info', 3000);
  }

  function stopTracking() {
    trackedId = null;
    _trackJustStarted = false;
    _clearOrbit();
    viewer.trackedEntity = undefined;
    viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
  }

  function setVisible(v) {
    visible = v;
    entities.forEach(e => { e.show = v; });
    if (!v) _clearOrbit();
  }

  function _clearEntities() {
    entities.forEach(e => viewer.entities.remove(e));
    entities.clear();
    _prevPositions.clear();
    _currPositions.clear();
    _clearOrbit();
    if (viewer) viewer.scene.preRender.removeEventListener(_smoothTick);
  }

  function destroy() {
    if (updateTimer) clearInterval(updateTimer);
    _clearEntities();
  }

  return { init, loadGroup, setVisible, trackSatellite, stopTracking, showOrbit };
})();
