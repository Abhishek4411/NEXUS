/**
 * NEXUS Near-Earth Objects (NEO) Layer
 * Renders NASA NeoWs asteroids as 3D billboard icons in space around Earth.
 * Positions are SYMBOLIC (not actual orbital positions) — scaled for visibility.
 *
 * Hazardous NEOs: red, shown at ~5,000 km altitude
 * Non-hazardous:  orange, shown at ~8,000 km altitude
 *
 * Actual miss_distance_km is shown in labels + entity panel.
 */

const NeoLayer = (() => {
  let viewer = null;
  let entities = [];
  let visible = false;
  let loaded = false;

  // ── SVG Icons ────────────────────────────────────────────────────────────
  function _icon(fill, stroke) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 22 22">
      <!-- Irregular asteroid shape -->
      <polygon points="11,1 16,4 20,9 19,15 14,20 8,21 3,17 2,11 5,5 9,2"
        fill="${fill}" stroke="${stroke}" stroke-width="1.2" opacity="0.92"/>
      <!-- Surface detail lines -->
      <line x1="7" y1="6" x2="15" y2="14" stroke="${stroke}" stroke-width="0.6" opacity="0.5"/>
      <line x1="5" y1="13" x2="14" y2="8" stroke="${stroke}" stroke-width="0.6" opacity="0.5"/>
      <circle cx="11" cy="11" r="2.5" fill="${stroke}" opacity="0.25"/>
    </svg>`;
    return `data:image/svg+xml;base64,${btoa(svg)}`;
  }

  const HAZARDOUS_ICON = _icon('#ff2200', '#ff6644');
  const SAFE_ICON      = _icon('#cc6600', '#ffaa33');

  function init(cesiumViewer) {
    viewer = cesiumViewer;
    console.log('✅ NEO layer initialized');
  }

  async function load() {
    if (loaded) { setVisible(true); return; }
    try {
      const resp = await fetch('/api/space/neo');
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      const neos = (data.neos || []).slice(0, 40);  // max 40 for performance

      _clear();

      neos.forEach((neo, i) => {
        // Symbolic position: distribute evenly around Earth
        const lon = (i / neos.length) * 360 - 180;
        const lat = Math.sin(i * 1.618) * 25;  // golden-ratio spread for variety

        // Altitude: 5,000–15,000 km (symbolic, not actual miss distance)
        // Scale log of miss_distance so closer NEOs appear nearer
        const logDist = Math.log10(Math.max(neo.miss_distance_km, 10000));
        const altKm = neo.hazardous
          ? 5000  + (logDist - 4) * 1500   // 5,000–11,000 km for hazardous
          : 8000  + (logDist - 4) * 2000;  // 8,000–16,000 km for safe
        const altM = Math.max(altKm, 3000) * 1000;

        const missStr = neo.miss_distance_km > 1e6
          ? `${(neo.miss_distance_km / 1e6).toFixed(2)}M km`
          : `${(neo.miss_distance_km / 1000).toFixed(0)}k km`;

        const diamStr = neo.diameter_max_m
          ? `${Math.round(neo.diameter_max_m)}m`
          : '?';

        const ent = viewer.entities.add({
          id: `neo-${neo.id}`,
          position: Cesium.Cartesian3.fromDegrees(lon, lat, altM),
          billboard: {
            image: neo.hazardous ? HAZARDOUS_ICON : SAFE_ICON,
            width:  neo.hazardous ? 22 : 18,
            height: neo.hazardous ? 22 : 18,
            verticalOrigin: Cesium.VerticalOrigin.CENTER,
            scaleByDistance: new Cesium.NearFarScalar(5e5, 2.0, 1e7, 0.4),
            distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 5e7),
          },
          label: {
            text: neo.name.replace('(', '').replace(')', '').trim(),
            font: '9px Courier New',
            fillColor: neo.hazardous
              ? Cesium.Color.fromCssColorString('#ff4422')
              : Cesium.Color.fromCssColorString('#ffaa33'),
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 2,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            pixelOffset: new Cesium.Cartesian2(0, -16),
            distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 5e6),
            show: false,
          },
          properties: {
            type: 'neo',
            data: {
              ...neo,
              _displayAlt: altKm,
              _missStr: missStr,
              _diamStr: diamStr,
            },
          },
        });
        entities.push(ent);
      });

      loaded = true;
      visible = true;

      const hazardousCount = neos.filter(n => n.hazardous).length;
      NexusToast.show(
        `${neos.length} near-Earth objects loaded (${hazardousCount} hazardous)`,
        hazardousCount > 0 ? 'warning' : 'success'
      );

      // Update count display
      const el = document.getElementById('count-neo');
      if (el) el.textContent = neos.length;

    } catch (e) {
      console.error('NEO load error:', e);
      NexusToast.show('Failed to load NEO data', 'error');
    }
  }

  function _clear() {
    entities.forEach(e => viewer.entities.remove(e));
    entities = [];
  }

  function setVisible(v) {
    visible = v;
    entities.forEach(e => { e.show = v; });
    if (v && !loaded) load();
  }

  return { init, load, setVisible };
})();
