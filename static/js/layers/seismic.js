/**
 * NEXUS Seismic Layer
 * Renders earthquake data from USGS as pulsing 3D circles on the globe.
 * Size = magnitude. Color = severity. Depth = actual earthquake depth.
 */

const SeismicLayer = (() => {
  let viewer = null;
  let entities = [];
  let visible = true;

  const MAG_COLORS = [
    { min: 7.0, color: '#ff0000', label: 'MAJOR' },
    { min: 6.0, color: '#ff4400', label: 'STRONG' },
    { min: 5.0, color: '#ff8800', label: 'MODERATE' },
    { min: 4.0, color: '#ffcc00', label: 'LIGHT' },
    { min: 3.0, color: '#88ff00', label: 'MINOR' },
    { min: 0.0, color: '#00ccff', label: 'MICRO' },
  ];

  function init(cesiumViewer) {
    viewer = cesiumViewer;
    console.log('✅ Seismic layer initialized');
  }

  async function load(minMag = 2.5, period = 'day') {
    _clearEntities();
    try {
      const resp = await fetch(`/api/seismic/?min_magnitude=${minMag}&period=${period}`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      const quakes = data.earthquakes || [];

      for (const q of quakes) {
        _addQuake(q);
      }

      const el = document.getElementById('count-seismic');
      if (el) el.textContent = quakes.length;
      const stat = document.getElementById('stat-eq');
      if (stat) stat.textContent = quakes.length;
      const sb = document.getElementById('status-eq');
      if (sb) sb.textContent = `EQ: ${quakes.length}`;

      // Add to feed
      _populateFeed(quakes);
      NexusToast.show(`Loaded ${quakes.length} earthquakes`, 'success');
    } catch (e) {
      console.error('Seismic load error:', e);
      NexusToast.show('Failed to load earthquake data', 'error');
    }
  }

  function _addQuake(q) {
    const { longitude, latitude, depth_km, magnitude, place, time, tsunami, alert } = q;
    if (longitude == null || latitude == null) return;

    const depthM = Math.max((depth_km || 0) * -1000, -700000);  // depth as negative altitude
    const color = Cesium.Color.fromCssColorString(_colorForMag(magnitude));
    const radius = Math.max(20000, magnitude * magnitude * 25000);  // bigger = more visible

    const entity = viewer.entities.add({
      id: `eq-${q.id}`,
      position: Cesium.Cartesian3.fromDegrees(longitude, latitude, 0),
      ellipse: {
        semiMinorAxis: radius,
        semiMajorAxis: radius,
        height: 0,
        material: color.withAlpha(0.25),
        outline: true,
        outlineColor: color.withAlpha(0.8),
        outlineWidth: 2,
      },
      point: {
        pixelSize: Math.max(4, magnitude * 2),
        color: color.withAlpha(0.9),
        outlineColor: Cesium.Color.WHITE.withAlpha(0.4),
        outlineWidth: 1,
      },
      label: {
        text: `M${magnitude.toFixed(1)}`,
        font: 'bold 10px Courier New',
        fillColor: color,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 2,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(0, -16),
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 3e6),
        show: true,
      },
      properties: {
        type: 'earthquake',
        data: q,
      },
    });

    entities.push(entity);
  }

  function _colorForMag(mag) {
    for (const { min, color } of MAG_COLORS) {
      if (mag >= min) return color;
    }
    return '#00ccff';
  }

  function _populateFeed(quakes) {
    const feedList = document.getElementById('feed-list');
    if (!feedList) return;
    const significant = quakes.filter(q => q.magnitude >= 4.5).slice(0, 10);
    if (significant.length === 0) return;

    const items = significant.map(q => {
      const d = new Date(q.time);
      const timeStr = d.toUTCString().slice(0, 25);
      return `<div class="feed-item eq">
        <div><strong>M${q.magnitude.toFixed(1)}</strong> — ${q.place}</div>
        <div class="feed-time">${timeStr}</div>
        ${q.tsunami ? '<div style="color:#ff2244">⚠️ TSUNAMI WARNING</div>' : ''}
      </div>`;
    }).join('');

    feedList.innerHTML = items;
  }

  function setVisible(v) {
    visible = v;
    entities.forEach(e => { e.show = v; });
  }

  function _clearEntities() {
    entities.forEach(e => viewer.entities.remove(e));
    entities = [];
  }

  return { init, load, setVisible };
})();
