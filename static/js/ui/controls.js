/**
 * NEXUS UI Controls
 * Left sidebar: layer toggles, effect buttons, camera presets, search.
 */

const NexusControls = (() => {

  function init() {
    _setupEffectButtons();
    _setupLayerToggles();
    _setupSliders();
    _setupPresets();
    _setupSearch();
    _setupSettings();
    _setupDeselect();
    _setupImmersiveMode();
    _startClock();
    console.log('✅ Controls initialized');
  }

  function _setupEffectButtons() {
    document.querySelectorAll('.effect-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.effect-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        NexusEffects.setMode(btn.dataset.effect);
      });
    });
  }

  function _setupLayerToggles() {
    // Satellites
    document.getElementById('toggle-satellites')?.addEventListener('change', (e) => {
      SatelliteLayer.setVisible(e.target.checked);
    });
    document.getElementById('sat-group')?.addEventListener('change', (e) => {
      SatelliteLayer.loadGroup(e.target.value);
    });

    // Flights
    document.getElementById('toggle-flights')?.addEventListener('change', (e) => {
      FlightLayer.setVisible(e.target.checked);
    });

    // Seismic
    document.getElementById('toggle-seismic')?.addEventListener('change', (e) => {
      SeismicLayer.setVisible(e.target.checked);
    });
    document.getElementById('seismic-period')?.addEventListener('change', (e) => {
      const mag = parseFloat(document.getElementById('seismic-mag')?.value || '2.5');
      SeismicLayer.load(mag, e.target.value);
    });

    // Launches
    document.getElementById('toggle-launches')?.addEventListener('change', (e) => {
      LaunchLayer.setVisible(e.target.checked);
    });

    // NEOs — uses NeoLayer for actual globe visualization
    document.getElementById('toggle-neo')?.addEventListener('change', (e) => {
      NeoLayer.setVisible(e.target.checked);
    });

    // Solar System — clickable Sun, Moon, planets, black holes, galaxies
    document.getElementById('toggle-space')?.addEventListener('change', (e) => {
      SpaceLayer.setVisible(e.target.checked);
    });
  }

  function _setupSliders() {
    // Bloom
    const bloomSlider = document.getElementById('bloom-strength');
    bloomSlider?.addEventListener('input', (e) => {
      NexusEffects.setBloom(parseFloat(e.target.value));
    });

    // Brightness
    const brightnessSlider = document.getElementById('brightness');
    brightnessSlider?.addEventListener('input', (e) => {
      NexusEffects.setBrightness(parseFloat(e.target.value));
    });

    // Seismic magnitude
    const seismicMag = document.getElementById('seismic-mag');
    const seismicMagVal = document.getElementById('seismic-mag-val');
    seismicMag?.addEventListener('input', (e) => {
      if (seismicMagVal) seismicMagVal.textContent = e.target.value;
    });
    seismicMag?.addEventListener('change', (e) => {
      const period = document.getElementById('seismic-period')?.value || 'day';
      SeismicLayer.load(parseFloat(e.target.value), period);
    });
  }

  function _setupPresets() {
    document.querySelectorAll('.preset-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const lat = parseFloat(btn.dataset.lat);
        const lon = parseFloat(btn.dataset.lon);
        const alt = parseFloat(btn.dataset.alt);
        NexusGlobe.flyTo(lon, lat, alt);
      });
    });
  }

  function _setupSearch() {
    const input  = document.getElementById('search-input');
    const results = document.getElementById('search-results');
    let debounceTimer = null;

    input?.addEventListener('input', (e) => {
      clearTimeout(debounceTimer);
      const q = e.target.value.trim();
      if (q.length < 2) { results.classList.add('hidden'); return; }

      debounceTimer = setTimeout(async () => {
        try {
          // Run satellite + geocode searches in parallel
          const [satResp, geoResp] = await Promise.allSettled([
            fetch(`/api/satellites/search?q=${encodeURIComponent(q)}&group=active`).then(r => r.json()),
            fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=5&addressdetails=1`, {
              headers: { 'Accept-Language': 'en' }
            }).then(r => r.json()),
          ]);

          const satellites = satResp.status === 'fulfilled' ? (satResp.value.satellites || []) : [];
          const places = geoResp.status === 'fulfilled' ? (geoResp.value || []) : [];
          // Also search space objects locally (instant, no network)
          const spaceObjs = typeof SpaceLayer !== 'undefined' ? SpaceLayer.search(q) : [];
          _renderSearchResults(satellites, places, spaceObjs, results);
        } catch (ex) { console.error('Search error:', ex); }
      }, 400);
    });

    input?.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') results.classList.add('hidden');
    });

    document.addEventListener('click', (e) => {
      if (!input?.contains(e.target) && !results?.contains(e.target)) {
        results?.classList.add('hidden');
      }
    });
  }

  function _renderSearchResults(satellites, places, spaceObjs, resultsEl) {
    if (satellites.length === 0 && places.length === 0 && (spaceObjs || []).length === 0) {
      resultsEl.classList.add('hidden');
      return;
    }

    const satItems = satellites.slice(0, 8).map(s => `
      <div class="search-result-item" data-type="satellite" data-norad="${s.norad_id}">
        <div class="result-type">🛰 SATELLITE</div>
        <div>${s.name} — NORAD ${s.norad_id}</div>
        <div class="text-dim" style="font-size:10px">${s.country || ''} | ${s.object_type || ''}</div>
      </div>
    `).join('');

    const placeItems = places.slice(0, 6).map(p => {
      const typeIcon = p.type === 'city' || p.type === 'town' ? '🏙' :
        p.type === 'country' ? '🌐' :
        p.type === 'state' || p.type === 'province' ? '🗺' :
        p.type === 'airport' ? '✈' : '📍';
      const displayName = p.display_name.split(',').slice(0, 3).join(',');
      return `
        <div class="search-result-item" data-type="place" data-lat="${p.lat}" data-lon="${p.lon}" data-name="${p.display_name.split(',')[0]}">
          <div class="result-type">${typeIcon} ${(p.type || p.class || 'PLACE').toUpperCase()}</div>
          <div>${displayName}</div>
        </div>
      `;
    }).join('');

    const spaceItems = (spaceObjs || []).slice(0, 5).map(o => {
      const typeIcon = o.type === 'star' ? '⭐' : o.type === 'planet' ? '🪐'
        : o.type === 'natural_satellite' ? '🌕' : o.type.includes('black_hole') ? '⬛'
        : o.type === 'galaxy' || o.type === 'galaxy_core' ? '🌌' : '•';
      return `
        <div class="search-result-item" data-type="space" data-spaceid="${o.id}">
          <div class="result-type">${typeIcon} ${o.type.replace(/_/g, ' ').toUpperCase()}</div>
          <div>${o.name}</div>
          <div class="text-dim" style="font-size:10px">${o.data?.distance || ''}</div>
        </div>
      `;
    }).join('');

    resultsEl.innerHTML = satItems + placeItems + spaceItems;

    resultsEl.querySelectorAll('.search-result-item').forEach(item => {
      item.addEventListener('click', () => {
        if (item.dataset.type === 'satellite') {
          const noradId = parseInt(item.dataset.norad);
          SatelliteLayer.trackSatellite(noradId);
          document.getElementById('search-input').value = item.querySelector('div:nth-child(2)').textContent;
        } else if (item.dataset.type === 'place') {
          const lat = parseFloat(item.dataset.lat);
          const lon = parseFloat(item.dataset.lon);
          // Altitude based on place type — cities closer, countries farther
          const placeType = item.querySelector('.result-type')?.textContent || '';
          const alt = placeType.includes('COUNTRY') ? 2000000
            : placeType.includes('STATE') || placeType.includes('PROVINCE') ? 500000
            : placeType.includes('CITY') || placeType.includes('TOWN') ? 50000
            : 80000;
          NexusGlobe.flyTo(lon, lat, alt, 2);
          document.getElementById('search-input').value = item.dataset.name;
        } else if (item.dataset.type === 'space') {
          // Enable space layer if not visible, then track the object
          const toggle = document.getElementById('toggle-space');
          if (toggle && !toggle.checked) { toggle.checked = true; SpaceLayer.setVisible(true); }
          SpaceLayer.trackObject(item.dataset.spaceid);
          document.getElementById('search-input').value = item.querySelector('div:nth-child(2)').textContent;
        }
        resultsEl.classList.add('hidden');
      });
    });
    resultsEl.classList.remove('hidden');
  }

  function _setupSettings() {
    const btn = document.getElementById('btn-settings');
    const modal = document.getElementById('settings-modal');
    const close = document.getElementById('close-settings');
    btn?.addEventListener('click', () => modal?.classList.remove('hidden'));
    close?.addEventListener('click', () => modal?.classList.add('hidden'));
    modal?.addEventListener('click', (e) => { if (e.target === modal) modal.classList.add('hidden'); });

    // Apply Cesium token
    document.getElementById('apply-token')?.addEventListener('click', () => {
      const token = document.getElementById('cesium-token-input')?.value.trim();
      if (token) {
        localStorage.setItem('nexus_cesium_token', token);
        NexusToast.show('Token saved. Refresh to apply.', 'success');
      }
    });

    // Imagery select
    document.getElementById('imagery-select')?.addEventListener('change', (e) => {
      const token = localStorage.getItem('nexus_cesium_token') || null;
      NexusGlobe.setImagery(e.target.value, token);
    });

    // Load saved token
    const saved = localStorage.getItem('nexus_cesium_token');
    if (saved) {
      const el = document.getElementById('cesium-token-input');
      if (el) el.value = saved;
    }

    // Space weather
    document.getElementById('btn-load-weather')?.addEventListener('click', loadSpaceWeather);

    // Refresh all layers button — also resets camera and stops all tracking
    document.getElementById('btn-refresh-all')?.addEventListener('click', async () => {
      NexusToast.show('Refreshing all data layers...', 'info', 2000);

      // Stop all tracking and reset camera to default globe view
      SatelliteLayer.stopTracking();
      SpaceLayer.stopTracking();
      NexusPanels.hideEntityPanel();
      NexusGlobe.resetCamera();

      const group = document.getElementById('sat-group')?.value || 'active';
      const mag = parseFloat(document.getElementById('seismic-mag')?.value || '2.5');
      const period = document.getElementById('seismic-period')?.value || 'day';
      await Promise.all([
        document.getElementById('toggle-satellites')?.checked ? SatelliteLayer.loadGroup(group) : Promise.resolve(),
        document.getElementById('toggle-seismic')?.checked ? SeismicLayer.load(mag, period) : Promise.resolve(),
        document.getElementById('toggle-launches')?.checked ? LaunchLayer.load() : Promise.resolve(),
        document.getElementById('toggle-neo')?.checked ? NeoLayer.setVisible(true) : Promise.resolve(),
      ]);
      NexusToast.show('All layers refreshed', 'success', 2000);
    });
  }

  function _setupDeselect() {
    document.getElementById('btn-deselect')?.addEventListener('click', () => {
      NexusPanels.hideEntityPanel();
    });
  }

  // ── Immersive Mode — hide all panels for full-globe experience ──────────
  function _setupImmersiveMode() {
    let immersive = false;

    function _setImmersiveMode(on) {
      immersive = on;
      ['topbar', 'sidebar-left', 'sidebar-right', 'statusbar'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.toggle('panel-collapsed', on);
      });
      const main = document.getElementById('main-layout');
      if (main) main.classList.toggle('immersive', on);

      const btn = document.getElementById('btn-immersive');
      if (btn) {
        btn.textContent = on ? '◧' : '◨';
        btn.classList.toggle('active', on);
      }
    }

    // Immersive mode button
    document.getElementById('btn-immersive')?.addEventListener('click', () => {
      _setImmersiveMode(!immersive);
    });

    // Fullscreen button — also enters immersive mode
    document.getElementById('btn-fullscreen')?.addEventListener('click', () => {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen();
        _setImmersiveMode(true);
      } else {
        document.exitFullscreen();
        _setImmersiveMode(false);
      }
    });

    // ESC exits fullscreen → also exit immersive
    document.addEventListener('fullscreenchange', () => {
      if (!document.fullscreenElement && immersive) {
        _setImmersiveMode(false);
      }
    });
  }

  function _startClock() {
    const el = document.getElementById('utc-clock');
    function tick() {
      if (!el) return;
      // IST = UTC+5:30 (19800 seconds offset)
      const ist = new Date(Date.now() + 19800000);
      const pad = n => String(n).padStart(2, '0');
      el.textContent = `${ist.getUTCFullYear()}-${pad(ist.getUTCMonth()+1)}-${pad(ist.getUTCDate())} ${pad(ist.getUTCHours())}:${pad(ist.getUTCMinutes())}:${pad(ist.getUTCSeconds())} IST`;
    }
    tick();
    setInterval(tick, 1000);
  }

  return { init };
})();


// ── On-demand data loaders ──────────────────────────────────

async function loadNEOs() {
  try {
    const resp = await fetch('/api/space/neo');
    const data = await resp.json();
    const viewer = NexusGlobe.getViewer();
    const neos = data.neos || [];
    NexusToast.show(`Loaded ${neos.length} near-Earth objects`, 'success');

    for (const neo of neos.slice(0, 50)) {
      // NEOs don't have fixed lat/lon; show as an info overlay
      // For visualization, we place them symbolically at their orbital approach vector
      // (simplification: place at random visible positions as orbital objects)
      console.log(`NEO: ${neo.name}, miss: ${(neo.miss_distance_km/1e6).toFixed(2)}M km, hazardous: ${neo.hazardous}`);
    }
  } catch (e) {
    NexusToast.show('Failed to load NEO data', 'error');
  }
}

async function loadBlackHoles() {
  try {
    const resp = await fetch('/api/space/black-holes');
    const data = await resp.json();
    const viewer = NexusGlobe.getViewer();

    NexusToast.show(`Loaded ${data.count} black hole records`, 'success');

    // Black holes have RA/Dec (celestial coordinates) not lat/lon.
    // Display in a panel — they are not on Earth's surface.
    const feedList = document.getElementById('feed-list');
    if (feedList && data.objects) {
      const items = data.objects.map(bh => `
        <div class="feed-item sat">
          <div><strong>⬛ ${bh.name}</strong></div>
          <div>${bh.description}</div>
          <div class="feed-time">${bh.mass_solar ? `${bh.mass_solar.toLocaleString()} M☉` : ''} | ${bh.distance_ly?.toLocaleString()} ly</div>
        </div>
      `).join('');
      feedList.insertAdjacentHTML('afterbegin', items);
    }
  } catch (e) {
    NexusToast.show('Failed to load black hole data', 'error');
  }
}

async function loadSpaceWeather() {
  try {
    const resp = await fetch('/api/space/space-weather');
    const data = await resp.json();
    const kpEl = document.getElementById('kp-value');
    if (kpEl) {
      const kp = parseFloat(data.kp_index || 0);
      kpEl.textContent = kp.toFixed(1);
      kpEl.style.color = kp >= 5 ? 'var(--accent-red)'
        : kp >= 3 ? 'var(--accent-yellow)'
        : 'var(--accent-green)';
    }
    NexusToast.show(`KP Index: ${data.kp_index} (${data.timestamp})`, 'success');
  } catch (e) {
    NexusToast.show('Failed to load space weather', 'error');
  }
}
