/**
 * NEXUS UI Panels
 * Right-side entity detail panel, info display, and click handling.
 */

const NexusPanels = (() => {
  let viewer = null;
  let clickHandler = null;

  function init(cesiumViewer) {
    viewer = cesiumViewer;
    _setupClickHandler();
    console.log('✅ Panels initialized');
  }

  function _setupClickHandler() {
    clickHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    clickHandler.setInputAction((click) => {
      const picked = viewer.scene.pick(click.position);
      if (Cesium.defined(picked) && picked.id && picked.id.properties) {
        _showEntityDetails(picked.id);
      } else {
        hideEntityPanel();
      }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
  }

  function _showEntityDetails(entity) {
    const type = entity.properties.type?.getValue();
    const data = entity.properties.data?.getValue();
    if (!type || !data) return;

    const panel = document.getElementById('entity-panel');
    const noSel = document.getElementById('no-selection-panel');
    const title = document.getElementById('entity-title');
    const content = document.getElementById('entity-content');
    const trackBtn = document.getElementById('btn-track');
    const orbitBtn = document.getElementById('btn-orbit');

    panel.classList.remove('hidden');
    noSel.classList.add('hidden');

    if (type === 'satellite') {
      _renderSatellitePanel(data, title, content, trackBtn, orbitBtn);
    } else if (type === 'flight') {
      _renderFlightPanel(data, title, content, trackBtn, orbitBtn);
    } else if (type === 'earthquake') {
      _renderEarthquakePanel(data, title, content, trackBtn, orbitBtn);
    } else if (type === 'launch_pad') {
      const upcoming = entity.properties.upcoming?.getValue() || [];
      _renderLaunchPadPanel(data, upcoming, title, content, trackBtn, orbitBtn);
    } else if (type === 'iss') {
      _renderISSPanel(data, title, content, trackBtn, orbitBtn);
    } else if (type === 'neo') {
      _renderNeoPanel(data, title, content, trackBtn, orbitBtn);
    } else if (type === 'space_object') {
      const subtype = entity.properties.subtype?.getValue() || '';
      _renderSpaceObjectPanel(data, subtype, title, content, trackBtn, orbitBtn);
    }
  }

  function _row(key, val) {
    return `<div class="entity-row">
      <span class="entity-key">${key}</span>
      <span class="entity-val">${val ?? '—'}</span>
    </div>`;
  }

  function _renderSatellitePanel(data, title, content, trackBtn, orbitBtn) {
    title.textContent = data.name || `NORAD ${data.norad_id}`;
    content.innerHTML = [
      _row('NORAD ID',    data.norad_id),
      _row('NAME',        data.name),
      _row('COUNTRY',     data.country),
      _row('TYPE',        data.object_type),
      _row('PERIOD',      data.period ? `${parseFloat(data.period).toFixed(1)} min` : '—'),
      _row('INCLINATION', data.inclination ? `${parseFloat(data.inclination).toFixed(2)}°` : '—'),
      _row('APOGEE',      data.apogee ? `${parseInt(data.apogee).toLocaleString()} km` : '—'),
      _row('PERIGEE',     data.perigee ? `${parseInt(data.perigee).toLocaleString()} km` : '—'),
      _row('LAUNCH DATE', data.launch_date || '—'),
    ].join('');

    trackBtn.onclick = () => SatelliteLayer.trackSatellite(data.norad_id);
    orbitBtn.onclick = () => SatelliteLayer.showOrbit(data.norad_id);
    trackBtn.classList.remove('hidden');
    orbitBtn.classList.remove('hidden');
  }

  function _renderFlightPanel(data, title, content, trackBtn, orbitBtn) {
    title.textContent = data.callsign || data.icao24?.toUpperCase() || 'FLIGHT';
    const altKm = ((data.baro_altitude || 0) / 1000).toFixed(1);
    const velKmh = data.velocity ? ((data.velocity) * 3.6).toFixed(0) : '—';
    content.innerHTML = [
      _row('CALLSIGN',    data.callsign || '—'),
      _row('ICAO24',      data.icao24?.toUpperCase()),
      _row('COUNTRY',     data.origin_country),
      _row('STATUS',      data.on_ground ? '🛬 ON GROUND' : '✈️ IN FLIGHT'),
      _row('ALTITUDE',    `${altKm} km`),
      _row('SPEED',       `${velKmh} km/h`),
      _row('HEADING',     data.true_track != null ? `${data.true_track.toFixed(0)}°` : '—'),
      _row('VERT RATE',   data.vertical_rate != null ? `${data.vertical_rate.toFixed(1)} m/s` : '—'),
      _row('SQUAWK',      data.squawk || '—'),
      _row('POSITION',    `${data.latitude?.toFixed(3)}°, ${data.longitude?.toFixed(3)}°`),
    ].join('');

    trackBtn.classList.add('hidden');
    orbitBtn.classList.add('hidden');
  }

  function _renderEarthquakePanel(data, title, content, trackBtn, orbitBtn) {
    title.textContent = `M${data.magnitude?.toFixed(1)} — ${data.place || 'Unknown'}`;
    const timeStr = data.time ? new Date(data.time).toUTCString() : '—';
    content.innerHTML = [
      _row('MAGNITUDE',   data.magnitude?.toFixed(1)),
      _row('PLACE',       data.place),
      _row('TIME (UTC)',  timeStr),
      _row('DEPTH',       `${data.depth_km?.toFixed(1) ?? '—'} km`),
      _row('TYPE',        data.type),
      _row('STATUS',      data.status),
      _row('ALERT',       data.alert || 'None'),
      _row('TSUNAMI',     data.tsunami ? '⚠️ WARNING' : 'No'),
      _row('FELT',        data.felt?.toLocaleString() || '—'),
      _row('SIG SCORE',   data.sig),
      _row('COORDS',      `${data.latitude?.toFixed(3)}, ${data.longitude?.toFixed(3)}`),
      data.url ? `<div class="entity-row"><a href="${data.url}" target="_blank" style="color:var(--accent-cyan)">USGS DETAILS ↗</a></div>` : '',
    ].join('');

    trackBtn.classList.add('hidden');
    orbitBtn.classList.add('hidden');
  }

  function _renderLaunchPadPanel(data, upcoming, title, content, trackBtn, orbitBtn) {
    title.textContent = data.name || 'LAUNCH PAD';
    const nextLaunch = upcoming[0];
    const countdown = nextLaunch?.net
      ? _countdown(new Date(nextLaunch.net))
      : '—';

    content.innerHTML = [
      _row('PAD NAME',    data.name),
      _row('LOCATION',    data.location),
      _row('COUNTRY',     data.country),
      _row('STATUS',      data.status || '—'),
      _row('COORDINATES', `${data.latitude?.toFixed(4)}, ${data.longitude?.toFixed(4)}`),
      upcoming.length > 0 ? `<div style="margin-top:8px;color:var(--accent-green);font-family:var(--font-mono);font-size:10px">NEXT LAUNCH:</div>` : '',
      nextLaunch ? _row('MISSION', nextLaunch.name) : '',
      nextLaunch ? _row('ROCKET', nextLaunch.rocket) : '',
      nextLaunch ? _row('AGENCY', nextLaunch.agency) : '',
      nextLaunch ? _row('T-MINUS', countdown) : '',
    ].join('');

    trackBtn.classList.add('hidden');
    orbitBtn.classList.add('hidden');
  }

  function _renderISSPanel(data, title, content, trackBtn, orbitBtn) {
    title.textContent = 'ISS — INTERNATIONAL SPACE STATION';
    content.innerHTML = [
      _row('ALTITUDE',  '~408 km'),
      _row('SPEED',     '~27,600 km/h'),
      _row('ORBIT',     'Low Earth Orbit (LEO)'),
      _row('LATITUDE',  data.latitude?.toFixed(4) + '°'),
      _row('LONGITUDE', data.longitude?.toFixed(4) + '°'),
      _row('NORAD ID',  '25544'),
      _row('LAUNCHED',  'November 20, 1998'),
    ].join('');

    trackBtn.onclick = () => SatelliteLayer.trackSatellite(25544);
    orbitBtn.onclick = () => SatelliteLayer.showOrbit(25544);
    trackBtn.classList.remove('hidden');
    orbitBtn.classList.remove('hidden');
  }

  function _renderSpaceObjectPanel(data, subtype, title, content, trackBtn, orbitBtn) {
    const typeEmoji = {
      star: '⭐', planet: '🪐', natural_satellite: '🌕',
      stellar_black_hole: '⬛', supermassive_black_hole: '⬛',
      galaxy: '🌌', galaxy_core: '🌌',
    }[subtype] || '•';

    title.textContent = `${typeEmoji} ${data.name || 'SPACE OBJECT'}`;

    const skipKeys = ['name', 'id'];
    const labelMap = {
      type: 'TYPE', distance: 'DISTANCE', diameter: 'DIAMETER', mass: 'MASS',
      surface_temp: 'SURFACE TEMP', age: 'AGE', orbital_period: 'ORBITAL PERIOD',
      moons: 'MOONS', axial_tilt: 'AXIAL TILT', wind_speed: 'WIND SPEED',
      great_red_spot: 'GREAT RED SPOT', rings: 'RINGS',
      constellation: 'CONSTELLATION', discovered: 'DISCOVERED',
      location: 'LOCATION', imaged: 'FIRST IMAGED', galaxy: 'GALAXY',
      stars: 'STARS', collision: 'COLLISION',
      description: 'DESCRIPTION',
    };

    const rows = Object.entries(data)
      .filter(([k, v]) => !skipKeys.includes(k) && v != null)
      .map(([k, v]) => {
        const label = labelMap[k] || k.replace(/_/g, ' ').toUpperCase();
        if (k === 'description') {
          return `<div class="entity-row" style="flex-direction:column;align-items:flex-start;gap:3px">
            <span class="entity-key">${label}</span>
            <span class="entity-val" style="white-space:normal;line-height:1.4">${v}</span>
          </div>`;
        }
        return _row(label, v);
      });

    content.innerHTML = rows.join('');
    if (data.id) {
      trackBtn.classList.remove('hidden');
      trackBtn.textContent = '🔭 TRACK';
      trackBtn.onclick = () => SpaceLayer.trackObject(data.id);
      orbitBtn.classList.remove('hidden');
      orbitBtn.textContent = '🪐 ORBIT PATH';
      orbitBtn.onclick = () => SpaceLayer.showOrbitForObject(data.id);
    } else {
      trackBtn.classList.add('hidden');
      orbitBtn.classList.add('hidden');
    }
  }

  function _renderNeoPanel(data, title, content, trackBtn, orbitBtn) {
    title.textContent = data.name || 'NEAR-EARTH OBJECT';
    const hazardClass = data.hazardous ? 'color:var(--accent-red)' : 'color:var(--accent-yellow)';
    const velStr = data.relative_velocity_kmh
      ? `${(data.relative_velocity_kmh / 1000).toFixed(1)}k km/h`
      : '—';
    content.innerHTML = [
      `<div style="${hazardClass};font-family:var(--font-mono);font-size:11px;margin-bottom:6px">${data.hazardous ? '⚠ POTENTIALLY HAZARDOUS' : '✓ NON-HAZARDOUS'}</div>`,
      _row('MISS DIST.', data._missStr || '—'),
      _row('VELOCITY',   velStr),
      _row('DIAMETER',   data._diamStr ? `~${data._diamStr}` : '—'),
      _row('APPROACH',   data.close_approach_date || '—'),
      _row('ORBITING',   data.orbiting_body || 'Earth'),
      _row('VIS ALT',    `${Math.round(data._displayAlt || 0).toLocaleString()} km (symbolic)`),
      data.nasa_url ? `<div class="entity-row"><a href="${data.nasa_url}" target="_blank" style="color:var(--accent-cyan)">NASA JPL DETAILS ↗</a></div>` : '',
    ].join('');

    trackBtn.classList.add('hidden');
    orbitBtn.classList.add('hidden');
  }

  function _countdown(targetDate) {
    const diff = targetDate - Date.now();
    if (diff < 0) return 'LAUNCHED';
    const d = Math.floor(diff / 86400000);
    const h = Math.floor((diff % 86400000) / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    return `T-${d}d ${h}h ${m}m`;
  }

  function hideEntityPanel() {
    document.getElementById('entity-panel')?.classList.add('hidden');
    document.getElementById('no-selection-panel')?.classList.remove('hidden');
    SatelliteLayer.stopTracking();
    SpaceLayer.stopTracking();
  }

  return { init, hideEntityPanel };
})();


// ── Toast Notification System ───────────────────────────────
const NexusToast = (() => {
  function show(message, type = 'info', duration = 3000) {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.3s';
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }
  return { show };
})();
