/**
 * NEXUS ISS Layer
 * Real-time ISS position via WebSocket (updates every 5 seconds).
 * Shows ISS icon, ground track, and crew info.
 */

const ISSLayer = (() => {
  let viewer = null;
  let entity = null;
  let groundTrack = null;
  let ws = null;
  let visible = true;
  let positions = [];  // track history for ground track
  const MAX_TRACK = 200;

  const ISS_SVG = `data:image/svg+xml;base64,${btoa(`<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
    <rect x="14" y="10" width="4" height="12" fill="#00f0ff" stroke="#000" stroke-width="1"/>
    <rect x="2" y="14" width="28" height="4" fill="#00f0ff" stroke="#000" stroke-width="1"/>
    <rect x="0" y="13" width="6" height="6" fill="#aaeeff" opacity="0.7"/>
    <rect x="26" y="13" width="6" height="6" fill="#aaeeff" opacity="0.7"/>
    <circle cx="16" cy="16" r="3" fill="#ffcc00" stroke="#000" stroke-width="1"/>
  </svg>`)}`;

  function init(cesiumViewer) {
    viewer = cesiumViewer;
    console.log('✅ ISS layer initialized');
  }

  function connect() {
    if (ws) ws.close();
    const wsUrl = `ws://${window.location.host}/ws/iss`;
    ws = new WebSocket(wsUrl);

    ws.onopen = () => console.log('🛰️ ISS WS connected');
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'iss' && msg.data) {
          _updateISS(msg.data);
        }
      } catch (e) { console.error('ISS WS parse error:', e); }
    };
    ws.onerror = () => console.error('ISS WS error');
    ws.onclose = () => {
      setTimeout(() => { if (visible) connect(); }, 10000);
    };
  }

  function _updateISS(data) {
    if (!visible) return;
    const { latitude, longitude } = data;
    const altitude = 408000;  // ISS orbits at ~408km

    const cartesian = Cesium.Cartesian3.fromDegrees(longitude, latitude, altitude);
    positions.push({ lon: longitude, lat: latitude });
    if (positions.length > MAX_TRACK) positions.shift();

    if (!entity) {
      entity = viewer.entities.add({
        id: 'iss',
        position: cartesian,
        billboard: {
          image: ISS_SVG,
          width: 32, height: 32,
          verticalOrigin: Cesium.VerticalOrigin.CENTER,
          scaleByDistance: new Cesium.NearFarScalar(1e5, 2, 1e7, 0.5),
        },
        label: {
          text: 'ISS',
          font: 'bold 11px Courier New',
          fillColor: Cesium.Color.fromCssColorString('#00f0ff'),
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cesium.Cartesian2(0, -22),
          show: true,
        },
        properties: { type: 'iss', data },
      });
    } else {
      entity.position = cartesian;
      if (entity.properties) entity.properties.data = data;
    }

    _updateGroundTrack();
  }

  function _updateGroundTrack() {
    if (groundTrack) viewer.entities.remove(groundTrack);
    if (positions.length < 2) return;

    const pts = positions.map(p => Cesium.Cartesian3.fromDegrees(p.lon, p.lat, 0));
    groundTrack = viewer.entities.add({
      id: 'iss-groundtrack',
      polyline: {
        positions: pts,
        width: 1,
        material: Cesium.Color.fromCssColorString('#00f0ff').withAlpha(0.4),
        clampToGround: true,
        classificationType: Cesium.ClassificationType.TERRAIN,
      },
    });
  }

  function setVisible(v) {
    visible = v;
    if (entity) entity.show = v;
    if (groundTrack) groundTrack.show = v;
    if (v && (!ws || ws.readyState !== WebSocket.OPEN)) connect();
  }

  async function loadCrew() {
    try {
      const resp = await fetch('/api/launches/iss');
      const data = await resp.json();
      const stat = document.getElementById('stat-crew');
      if (stat) stat.textContent = data.crew_count || 0;
      return data;
    } catch (e) {
      console.error('ISS crew error:', e);
      return null;
    }
  }

  return { init, connect, setVisible, loadCrew };
})();
