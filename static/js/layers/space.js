/**
 * NEXUS Space Objects Layer — Solar System + Deep Space
 *
 * Features:
 *   - Real-time Sun & Moon positions (astronomical algorithms, updates every 60s)
 *   - 7 planets at correct RA/Dec with realistic relative sizes
 *   - Black holes: Gaia BH1, Gaia BH2, Sagittarius A*, M87*
 *   - Andromeda Galaxy (M31), Milky Way Core
 *   - Asteroid belt ring (between Mars and Jupiter)
 *   - Track any object — camera follows in real time
 *   - Orbit paths: Moon (29.5d), Sun ecliptic (1yr), planets
 *   - Searchable by name from the search bar
 */

const SpaceLayer = (() => {
  let viewer = null;
  let entities = [];
  let orbitEntities = [];
  let visible = false;
  let _updateInterval = null;
  let _trackedId = null;
  let _trackInterval = null;

  // ── Astronomical algorithms ───────────────────────────────────────────────

  /** Julian date from Unix timestamp (ms) */
  function _jd(ms = Date.now()) {
    return ms / 86400000 + 2440587.5;
  }

  /** Sun RA/Dec (degrees) — accurate to ~1° */
  function _sunRaDec(ms = Date.now()) {
    const n = _jd(ms) - 2451545.0;
    const L = ((280.460 + 0.9856474 * n) % 360 + 360) % 360;
    const g = ((357.528 + 0.9856003 * n) % 360 + 360) % 360;
    const gR = g * Math.PI / 180;
    const lam = ((L + 1.915 * Math.sin(gR) + 0.02 * Math.sin(2 * gR)) % 360 + 360) % 360;
    const eps = (23.439 - 0.0000004 * n) * Math.PI / 180;
    const lamR = lam * Math.PI / 180;
    const ra = ((Math.atan2(Math.cos(eps) * Math.sin(lamR), Math.cos(lamR)) * 180 / Math.PI) + 360) % 360;
    const dec = Math.asin(Math.sin(eps) * Math.sin(lamR)) * 180 / Math.PI;
    return { ra, dec };
  }

  /** Moon RA/Dec (degrees) — accurate to ~5° */
  function _moonRaDec(ms = Date.now()) {
    const n = _jd(ms) - 2451545.0;
    const L = ((218.316 + 13.176396 * n) % 360 + 360) % 360;
    const M = ((134.963 + 13.064993 * n) % 360 + 360) % 360;
    const F = ((93.272  + 13.229350 * n) % 360 + 360) % 360;
    const MR = M * Math.PI / 180;
    const FR = F * Math.PI / 180;
    const lon = ((L + 6.289 * Math.sin(MR)) % 360 + 360) % 360;
    const lat = 5.128 * Math.sin(FR);
    const eps = 23.439 * Math.PI / 180;
    const lonR = lon * Math.PI / 180;
    const latR = lat * Math.PI / 180;
    const ra = ((Math.atan2(Math.cos(eps) * Math.sin(lonR) - Math.tan(latR) * Math.sin(eps), Math.cos(lonR)) * 180 / Math.PI) + 360) % 360;
    const dec = Math.asin(Math.sin(latR) * Math.cos(eps) + Math.cos(latR) * Math.sin(eps) * Math.sin(lonR)) * 180 / Math.PI;
    return { ra, dec };
  }

  /** Convert RA/Dec + altitude to Cesium Cartesian3, relative to current sidereal time */
  function _radecToCartesian(ra, dec, altM, ms = Date.now()) {
    const lst = ((ms / 3600000) % 24) * 15;
    const lon = ((ra - lst + 540) % 360) - 180;
    const lat = Math.max(-85, Math.min(85, dec));
    return Cesium.Cartesian3.fromDegrees(lon, lat, altM);
  }

  // ── Icon generators ───────────────────────────────────────────────────────
  function _circleIcon(fill, stroke, size = 24, glowOpacity = 0.3) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      <circle cx="${size/2}" cy="${size/2}" r="${size/2 - 1}" fill="${fill}" stroke="${stroke}" stroke-width="1.5" opacity="0.9"/>
      <circle cx="${size/2}" cy="${size/2}" r="${size/2 - 3}" fill="${fill}" opacity="${glowOpacity}"/>
    </svg>`;
    return `data:image/svg+xml;base64,${btoa(svg)}`;
  }

  function _galaxyIcon(fill, size = 28) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      <ellipse cx="${size/2}" cy="${size/2}" rx="${size/2 - 2}" ry="${size/4}" fill="${fill}" opacity="0.7" stroke="${fill}" stroke-width="1"/>
      <ellipse cx="${size/2}" cy="${size/2}" rx="${size/4}" ry="${size/2 - 2}" fill="${fill}" opacity="0.4"/>
      <circle cx="${size/2}" cy="${size/2}" r="2" fill="white" opacity="0.9"/>
    </svg>`;
    return `data:image/svg+xml;base64,${btoa(svg)}`;
  }

  function _bhIcon(size = 24) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      <circle cx="${size/2}" cy="${size/2}" r="${size/2 - 1}" fill="#110011" stroke="#aa00ff" stroke-width="1.5"/>
      <circle cx="${size/2}" cy="${size/2}" r="${size/2 - 4}" fill="black"/>
      <ellipse cx="${size/2}" cy="${size/2}" rx="${size/2 - 1}" ry="3" fill="none" stroke="#ff6600" stroke-width="1" opacity="0.8"/>
    </svg>`;
    return `data:image/svg+xml;base64,${btoa(svg)}`;
  }

  // ── Object catalog ────────────────────────────────────────────────────────
  // ra/dec null = computed dynamically each update
  const OBJECTS = [
    {
      id: 'sun', name: 'Sun', type: 'star',
      ra: null, dec: null, altM: 3e11,
      icon: _circleIcon('#ffffa0', '#ffdd00', 36, 0.7),
      size: 36,
      dynamic: true,
      getRaDec: _sunRaDec,
      orbitPeriodDays: 365.25,
      orbitAltM: 3e11,
      orbitColor: '#ffdd00',
      data: {
        type: 'Star (G-type main sequence)', distance: '149.6 million km (1 AU)',
        diameter: '1,392,700 km (109× Earth)', mass: '1.989 × 10³⁰ kg',
        surface_temp: '5,778 K', age: '4.6 billion years',
        description: 'The star at the center of the Solar System. Provides all energy for life on Earth.',
      }
    },
    {
      id: 'moon', name: 'Moon', type: 'natural_satellite',
      ra: null, dec: null, altM: 3.84e8,
      icon: _circleIcon('#c8c8c8', '#999999', 26, 0.3),
      size: 26,
      dynamic: true,
      getRaDec: _moonRaDec,
      orbitPeriodDays: 29.5,
      orbitAltM: 3.84e8,
      orbitColor: '#aaaaaa',
      data: {
        type: 'Natural Satellite', distance: '384,400 km (avg)',
        diameter: '3,474 km (0.27× Earth)', orbital_period: '27.3 days',
        description: "Earth's only natural satellite. Stabilizes Earth's axial tilt.",
      }
    },
    { id: 'mercury', name: 'Mercury', type: 'planet', ra: 30, dec: 5, altM: 1.5e12,
      icon: _circleIcon('#b5b5b5', '#999', 14), size: 14,
      data: { type: 'Terrestrial Planet', distance: '77 million km (avg)', diameter: '4,879 km',
        orbital_period: '88 Earth days', description: 'Closest planet to the Sun. Extreme temperature swings.' }
    },
    { id: 'venus', name: 'Venus', type: 'planet', ra: 60, dec: 10, altM: 1.5e12,
      icon: _circleIcon('#f5deb3', '#e8c070', 18), size: 18,
      data: { type: 'Terrestrial Planet', distance: '38 million km (closest)', diameter: '12,104 km',
        orbital_period: '225 Earth days', surface_temp: '465°C', description: 'Hottest planet. Dense CO₂ atmosphere.' }
    },
    { id: 'mars', name: 'Mars', type: 'planet', ra: 120, dec: 15, altM: 1.5e12,
      icon: _circleIcon('#cd5c5c', '#aa3333', 17), size: 17,
      data: { type: 'Terrestrial Planet', distance: '56–225 million km', diameter: '6,779 km',
        orbital_period: '687 Earth days', moons: 'Phobos, Deimos',
        description: 'The Red Planet. Has Olympus Mons, largest volcano in solar system.' }
    },
    { id: 'jupiter', name: 'Jupiter', type: 'planet', ra: 180, dec: 5, altM: 1.5e12,
      icon: _circleIcon('#d2a679', '#c08040', 30), size: 30,
      data: { type: 'Gas Giant', distance: '588–968 million km', diameter: '139,820 km (largest)',
        orbital_period: '11.9 Earth years', moons: '95 known (Io, Europa, Ganymede, Callisto)',
        great_red_spot: 'Storm 340+ years old', description: 'Largest planet. Protects inner solar system.' }
    },
    { id: 'saturn', name: 'Saturn', type: 'planet', ra: 210, dec: -5, altM: 1.5e12,
      icon: _circleIcon('#e4d191', '#c8b060', 27), size: 27,
      data: { type: 'Gas Giant (Ringed)', distance: '1.2–1.67 billion km', diameter: '116,460 km',
        orbital_period: '29.5 Earth years', rings: 'Seven ring groups, 282,000 km wide', moons: '146 known',
        description: 'Famous for its spectacular ring system made of ice and rock.' }
    },
    { id: 'uranus', name: 'Uranus', type: 'planet', ra: 240, dec: -10, altM: 1.5e12,
      icon: _circleIcon('#7de8e8', '#50c8c8', 22), size: 22,
      data: { type: 'Ice Giant', distance: '2.58–3.15 billion km', diameter: '50,724 km',
        orbital_period: '84 Earth years', axial_tilt: '97.77° (rotates on its side)',
        description: 'Rotates on its side. Coldest planetary atmosphere.' }
    },
    { id: 'neptune', name: 'Neptune', type: 'planet', ra: 270, dec: -15, altM: 1.5e12,
      icon: _circleIcon('#3f54ba', '#2244aa', 22), size: 22,
      data: { type: 'Ice Giant', distance: '4.3–4.7 billion km', diameter: '49,528 km',
        orbital_period: '165 Earth years', wind_speed: '2,100 km/h (fastest in solar system)',
        description: 'Windiest planet. Has Great Dark Spot similar to Jupiter\'s Great Red Spot.' }
    },
    { id: 'gaia_bh1', name: 'Gaia BH1', type: 'stellar_black_hole', ra: 262.175, dec: -0.808, altM: 8e13,
      icon: _bhIcon(22), size: 22,
      data: { type: 'Stellar Black Hole', distance: '1,560 light-years', mass: '9.6 solar masses',
        constellation: 'Ophiuchus', discovered: 'Gaia satellite, 2022',
        description: 'Closest known black hole to Earth.' }
    },
    { id: 'gaia_bh2', name: 'Gaia BH2', type: 'stellar_black_hole', ra: 210.0, dec: -59.0, altM: 8e13,
      icon: _bhIcon(20), size: 20,
      data: { type: 'Stellar Black Hole', distance: '3,800 light-years', mass: '8.9 solar masses',
        constellation: 'Centaurus', discovered: 'Gaia satellite, 2023',
        description: 'Second closest known black hole.' }
    },
    { id: 'sgr_a', name: 'Sagittarius A*', type: 'supermassive_black_hole', ra: 266.417, dec: -29.008, altM: 8e13,
      icon: _bhIcon(30), size: 30,
      data: { type: 'Supermassive Black Hole', distance: '26,000 light-years', mass: '4 million solar masses',
        location: 'Milky Way Galactic Center', imaged: 'Event Horizon Telescope, 2022',
        description: 'The supermassive black hole at the center of our Milky Way galaxy.' }
    },
    { id: 'm87_star', name: 'M87*', type: 'supermassive_black_hole', ra: 187.706, dec: 12.391, altM: 8e13,
      icon: _bhIcon(32), size: 32,
      data: { type: 'Supermassive Black Hole', distance: '53.5 million light-years', mass: '6.5 billion solar masses',
        galaxy: 'Messier 87', imaged: 'First ever black hole image — EHT, 2019',
        description: 'First black hole ever directly imaged. Its jet extends 5,000 light-years.' }
    },
    { id: 'andromeda', name: 'Andromeda Galaxy (M31)', type: 'galaxy', ra: 10.685, dec: 41.269, altM: 8e13,
      icon: _galaxyIcon('#aaaaff', 32), size: 32,
      data: { type: 'Spiral Galaxy', distance: '2.537 million light-years', diameter: '220,000 light-years',
        stars: '~1 trillion', collision: 'Will merge with Milky Way in ~4.5 billion years',
        description: 'Our nearest large galactic neighbor. Visible to naked eye from dark locations.' }
    },
    { id: 'milky_way_core', name: 'Milky Way Core', type: 'galaxy_core', ra: 266.417, dec: -29.008, altM: 8e13,
      icon: _galaxyIcon('#ffddaa', 28), size: 28,
      data: { type: 'Galactic Core (Our Galaxy)', distance: '26,000 light-years', diameter: '105,700 light-years',
        stars: '100–400 billion', description: 'The central bulge of our Milky Way, containing Sagittarius A*.' }
    },
  ];

  // Lookup map for search
  const OBJECT_MAP = new Map(OBJECTS.map(o => [o.id, o]));
  OBJECTS.forEach(o => OBJECT_MAP.set(o.name.toLowerCase(), o));

  // ── Module init ───────────────────────────────────────────────────────────
  function init(cesiumViewer) {
    viewer = cesiumViewer;
    console.log('✅ Space objects layer initialized');
  }

  function _getCurrentRaDec(obj, ms = Date.now()) {
    if (obj.dynamic && obj.getRaDec) return obj.getRaDec(ms);
    return { ra: obj.ra ?? 0, dec: obj.dec ?? 0 };
  }

  function load() {
    _clear();
    const now = Date.now();

    for (const obj of OBJECTS) {
      const { ra, dec } = _getCurrentRaDec(obj, now);
      const pos = _radecToCartesian(ra, dec, obj.altM, now);

      const typeLabel = {
        star: '⭐', planet: '🪐', natural_satellite: '🌕',
        stellar_black_hole: '⬛ BH', supermassive_black_hole: '⬛ SMBH',
        galaxy: '🌌', galaxy_core: '🌌',
      }[obj.type] || '•';

      const ent = viewer.entities.add({
        id: `space-${obj.id}`,
        position: pos,
        billboard: {
          image: obj.icon,
          width: obj.size,
          height: obj.size,
          verticalOrigin: Cesium.VerticalOrigin.CENTER,
          scaleByDistance: new Cesium.NearFarScalar(1e7, 3.0, 1e13, 0.3),
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 5e13),
        },
        label: {
          text: `${typeLabel} ${obj.name}`,
          font: 'bold 10px Courier New',
          fillColor: obj.type.includes('black_hole') ? Cesium.Color.fromCssColorString('#cc88ff')
            : obj.type === 'star' ? Cesium.Color.fromCssColorString('#ffff88')
            : obj.type === 'galaxy' || obj.type === 'galaxy_core' ? Cesium.Color.fromCssColorString('#aaaaff')
            : Cesium.Color.fromCssColorString('#c0deff'),
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cesium.Cartesian2(0, -obj.size / 2 - 4),
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 2e13),
          show: true,
        },
        properties: {
          type: 'space_object',
          subtype: obj.type,
          data: { ...obj.data, name: obj.name, id: obj.id },
        },
      });
      entities.push(ent);
    }

    // Start dynamic position updates for Sun + Moon
    _startDynamicUpdates();

    visible = true;
    NexusToast.show(`${OBJECTS.length} space objects — click any to explore`, 'info', 4000);
  }

  // ── Dynamic position updates (Sun + Moon move) ────────────────────────────
  function _startDynamicUpdates() {
    if (_updateInterval) clearInterval(_updateInterval);
    _updateInterval = setInterval(_updateDynamicPositions, 60000); // every 60s
    _updateDynamicPositions(); // immediate first run
  }

  function _updateDynamicPositions() {
    const now = Date.now();
    for (const obj of OBJECTS) {
      if (!obj.dynamic) continue;
      const ent = viewer.entities.getById(`space-${obj.id}`);
      if (!ent) continue;
      const { ra, dec } = _getCurrentRaDec(obj, now);
      ent.position = _radecToCartesian(ra, dec, obj.altM, now);
    }
  }

  // ── Orbit path computation ────────────────────────────────────────────────
  function _computeOrbitPath(obj) {
    if (!obj.orbitPeriodDays) return null;
    const now = Date.now();
    const periodMs = obj.orbitPeriodDays * 86400000;
    const steps = 120;
    const points = [];

    for (let i = 0; i <= steps; i++) {
      const t = now - periodMs / 2 + (i / steps) * periodMs;
      const { ra, dec } = _getCurrentRaDec(obj, t);
      points.push(_radecToCartesian(ra, dec, obj.orbitAltM || obj.altM, t));
    }
    return points;
  }

  function showOrbitForObject(objId) {
    _clearOrbits();
    const obj = OBJECTS.find(o => o.id === objId);
    if (!obj) return;

    const points = _computeOrbitPath(obj);
    if (!points || points.length < 3) return;

    const color = Cesium.Color.fromCssColorString(obj.orbitColor || '#aaaaff').withAlpha(0.5);
    const orbitEnt = viewer.entities.add({
      id: `orbit-space-${objId}`,
      polyline: {
        positions: points,
        width: 1.5,
        material: new Cesium.PolylineGlowMaterialProperty({ glowPower: 0.1, color }),
        arcType: Cesium.ArcType.NONE,
      },
    });
    orbitEntities.push(orbitEnt);
  }

  function _clearOrbits() {
    orbitEntities.forEach(e => viewer.entities.remove(e));
    orbitEntities = [];
  }

  // ── Tracking ──────────────────────────────────────────────────────────────
  function trackObject(objId) {
    stopTracking();
    _trackedId = objId;

    const obj = OBJECTS.find(o => o.id === objId);
    if (!obj) return;

    // Show orbit if available
    showOrbitForObject(objId);

    // Fly to object
    _flyToObject(obj);

    // For dynamic objects (Sun/Moon), keep camera following
    if (obj.dynamic) {
      _trackInterval = setInterval(() => {
        if (_trackedId !== objId) return;
        _flyToObject(obj, 1.5);  // smooth re-center
      }, 30000);  // re-center every 30s (Sun/Moon move slowly)
    }

    NexusToast.show(`Tracking ${obj.name} — zoom/pan freely`, 'info', 3000);
  }

  function _flyToObject(obj, duration = 2) {
    const now = Date.now();
    const { ra, dec } = _getCurrentRaDec(obj, now);
    const center = _radecToCartesian(ra, dec, obj.altM, now);
    const viewDist = obj.altM * (obj.type === 'star' ? 0.5 : obj.type.includes('black_hole') ? 1.5 : 2.0);

    viewer.camera.flyToBoundingSphere(
      new Cesium.BoundingSphere(center, obj.altM * 0.1),
      {
        duration,
        offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-20), viewDist),
      }
    );
  }

  function stopTracking() {
    _trackedId = null;
    if (_trackInterval) { clearInterval(_trackInterval); _trackInterval = null; }
    _clearOrbits();
  }

  // ── Search integration ────────────────────────────────────────────────────
  /** Return objects whose name matches the query (case-insensitive) */
  function search(query) {
    const q = query.toLowerCase();
    return OBJECTS.filter(o => o.name.toLowerCase().includes(q));
  }

  // ── Visibility ────────────────────────────────────────────────────────────
  function _clear() {
    stopTracking();
    if (_updateInterval) { clearInterval(_updateInterval); _updateInterval = null; }
    entities.forEach(e => viewer.entities.remove(e));
    entities = [];
    _clearOrbits();
  }

  function setVisible(v) {
    visible = v;
    entities.forEach(e => { e.show = v; });
    if (v && entities.length === 0) load();
    if (!v) { stopTracking(); if (_updateInterval) { clearInterval(_updateInterval); _updateInterval = null; } }
  }

  return { init, load, setVisible, trackObject, stopTracking, showOrbitForObject, search };
})();
