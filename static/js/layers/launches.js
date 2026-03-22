/**
 * NEXUS Launch Layer
 * Displays rocket launch pads, upcoming launches, and past launches.
 * Data: The Space Devs API (SpaceX, ISRO, DRDO, NASA, ESA, Roscosmos, CNSA...)
 */

const LaunchLayer = (() => {
  let viewer = null;
  let entities = [];
  let visible = true;
  let upcomingData = [];

  function init(cesiumViewer) {
    viewer = cesiumViewer;
    console.log('✅ Launch layer initialized');
  }

  async function load() {
    _clearEntities();
    try {
      const [padsResp, upcomingResp] = await Promise.all([
        fetch('/api/launches/pads'),
        fetch('/api/launches/upcoming'),
      ]);
      const padsData    = await padsResp.json();
      const upcomingData_ = await upcomingResp.json();

      const pads     = padsData.pads || [];
      const upcoming = upcomingData_.launches || [];
      upcomingData = upcoming;

      _renderPads(pads, upcoming);
      _populateLaunchList(upcoming);

      const el = document.getElementById('count-launches');
      if (el) el.textContent = upcoming.length;
      const stat = document.getElementById('stat-lnch');
      if (stat) stat.textContent = upcoming.length;

      NexusToast.show(`${pads.length} pads, ${upcoming.length} upcoming launches`, 'success');
    } catch (e) {
      console.error('Launch load error:', e);
      NexusToast.show('Failed to load launch data', 'error');
    }
  }

  function _renderPads(pads, upcoming) {
    // Build a set of pads with upcoming launches
    const upcomingPadNames = new Set(upcoming.map(u => u.pad_name));

    for (const pad of pads) {
      const lon = pad.longitude, lat = pad.latitude;
      if (!lon || !lat) continue;

      const hasUpcoming = upcomingPadNames.has(pad.name);
      const color = hasUpcoming
        ? Cesium.Color.fromCssColorString('#00ff88')
        : Cesium.Color.fromCssColorString('#ff6600').withAlpha(0.7);

      const entity = viewer.entities.add({
        id: `pad-${pad.id}`,
        position: Cesium.Cartesian3.fromDegrees(lon, lat, 0),
        billboard: {
          image: _rocketIconSvg(hasUpcoming),
          width: hasUpcoming ? 24 : 18,
          height: hasUpcoming ? 24 : 18,
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          scaleByDistance: new Cesium.NearFarScalar(1e3, 2, 5e6, 0.5),
        },
        label: {
          text: pad.name,
          font: '10px Courier New',
          fillColor: color,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cesium.Cartesian2(0, -28),
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 2e6),
          show: true,
        },
        properties: {
          type: 'launch_pad',
          data: pad,
          upcoming: upcoming.filter(u => u.pad_name === pad.name),
        },
      });
      entities.push(entity);
    }
  }

  function _rocketIconSvg(active = false) {
    const color = active ? '#00ff88' : '#ff6600';
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
      <polygon points="12,2 8,14 12,11 16,14" fill="${color}" stroke="#000" stroke-width="1"/>
      <rect x="10" y="14" width="4" height="6" fill="${color}" stroke="#000" stroke-width="1"/>
      <polygon points="8,20 4,24 10,21" fill="${color}"/>
      <polygon points="16,20 20,24 14,21" fill="${color}"/>
      <circle cx="12" cy="8" r="2" fill="#000"/>
    </svg>`;
    return `data:image/svg+xml;base64,${btoa(svg)}`;
  }

  function _populateLaunchList(launches) {
    const list = document.getElementById('launch-list');
    if (!list) return;

    const sorted = [...launches].sort((a, b) => new Date(a.net) - new Date(b.net));
    const top = sorted.slice(0, 20);

    if (top.length === 0) {
      list.innerHTML = '<div class="feed-item text-dim">No upcoming launches found</div>';
      return;
    }

    list.innerHTML = top.map(l => {
      const net = l.net ? new Date(l.net) : null;
      const countdown = net ? _countdown(net) : '—';
      // Show launch time in IST (UTC+5:30)
      const netIST = net ? new Date(net.getTime() + 19800000) : null;
      const pad = n => String(n).padStart(2, '0');
      const dateStr = netIST
        ? `${netIST.getUTCFullYear()}-${pad(netIST.getUTCMonth()+1)}-${pad(netIST.getUTCDate())} ${pad(netIST.getUTCHours())}:${pad(netIST.getUTCMinutes())} IST`
        : '—';
      const statusColor = l.status_abbrev === 'Go' ? 'var(--accent-green)'
        : l.status_abbrev === 'TBD' ? 'var(--accent-yellow)'
        : 'var(--text-dim)';

      return `<div class="launch-item">
        <div class="launch-name">${l.name || 'Unknown Mission'}</div>
        <div class="launch-agency">${l.agency || ''} ${l.agency_country ? `(${l.agency_country})` : ''}</div>
        <div class="launch-time">${dateStr}</div>
        <div class="launch-countdown">${countdown}</div>
        <div class="launch-status" style="color:${statusColor}">${l.status || ''}</div>
        <div class="launch-status text-dim">🚀 ${l.rocket || ''} — ${l.pad_location_name || ''}</div>
      </div>`;
    }).join('');
  }

  function _countdown(targetDate) {
    const diff = targetDate - Date.now();
    if (diff < 0) return 'LAUNCHED';
    const days = Math.floor(diff / 86400000);
    const hrs  = Math.floor((diff % 86400000) / 3600000);
    const mins = Math.floor((diff % 3600000) / 60000);
    if (days > 0) return `T-${days}d ${hrs}h`;
    if (hrs > 0) return `T-${hrs}h ${mins}m`;
    return `T-${mins}m`;
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
