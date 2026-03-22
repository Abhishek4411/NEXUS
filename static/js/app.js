/**
 * NEXUS — Main Application Entry Point
 * Initializes all modules in the correct order.
 * Globe init is async (loads Ion imagery if token is available).
 */

(async () => {
  console.log('%cNEXUS — Global Intelligence Platform v1.2', 'color:#00f0ff;font-size:16px;font-weight:bold');
  console.log('%cInitializing systems...', 'color:#c0deff');

  // ── 1. Fetch config (Cesium Ion token from server .env) ───────────────
  let cesiumToken = localStorage.getItem('nexus_cesium_token') || null;
  try {
    const cfgResp = await fetch('/api/config');
    const cfg = await cfgResp.json();
    if (cfg.cesium_ion_token) cesiumToken = cfg.cesium_ion_token;
  } catch (e) { /* use localStorage token if server unreachable */ }

  // ── 2. Globe (async — loads Ion imagery + terrain if token present) ───
  const cesiumViewer = await NexusGlobe.init('cesium-container', cesiumToken);

  // ── 3. Post-processing effects ────────────────────────────────────────
  NexusEffects.init(cesiumViewer);

  // ── 4. Data layers ────────────────────────────────────────────────────
  SatelliteLayer.init(cesiumViewer);
  FlightLayer.init(cesiumViewer);
  SeismicLayer.init(cesiumViewer);
  LaunchLayer.init(cesiumViewer);
  ISSLayer.init(cesiumViewer);
  NeoLayer.init(cesiumViewer);
  SpaceLayer.init(cesiumViewer);

  // ── 5. UI ─────────────────────────────────────────────────────────────
  NexusPanels.init(cesiumViewer);
  NexusControls.init();

  // ── 6. Load initial data (staggered to avoid rate limits) ─────────────
  NexusToast.show('NEXUS online. Loading data streams...', 'info', 5000);

  // Satellites first
  await SatelliteLayer.loadGroup('active');

  // Connect real-time WebSocket feeds
  FlightLayer.connect();
  ISSLayer.connect();

  // REST data
  await Promise.all([
    SeismicLayer.load(2.5, 'day'),
    LaunchLayer.load(),
  ]);

  await ISSLayer.loadCrew();
  await loadSpaceWeather();

  console.log('✅ NEXUS fully operational');
  NexusToast.show('All systems operational', 'success', 3000);

  // ── 7. Periodic refresh ───────────────────────────────────────────────
  setInterval(() => {
    const period = document.getElementById('seismic-period')?.value || 'day';
    const mag = parseFloat(document.getElementById('seismic-mag')?.value || '2.5');
    if (document.getElementById('toggle-seismic')?.checked) {
      SeismicLayer.load(mag, period);
    }
  }, 5 * 60 * 1000);

  setInterval(() => {
    if (document.getElementById('toggle-launches')?.checked) {
      LaunchLayer.load();
    }
  }, 60 * 60 * 1000);

  setInterval(() => {
    const group = document.getElementById('sat-group')?.value || 'active';
    SatelliteLayer.loadGroup(group);
  }, 2 * 60 * 60 * 1000);

})();
