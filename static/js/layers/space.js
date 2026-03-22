/**
 * NEXUS Space Objects Layer — Solar System + Deep Space
 *
 * Features:
 *   - Real-time Sun & Moon positions (astronomical algorithms, updates every 60s)
 *   - 3D ellipsoid planets with realistic textures (fallback to colored spheres)
 *   - Black holes: Gaia BH1, Gaia BH2, Sagittarius A*, M87*
 *   - Andromeda Galaxy (M31), Milky Way Core
 *   - Asteroid belt ring (300 points between Mars and Jupiter)
 *   - Continuous camera tracking via viewer.trackedEntity
 *   - Orbit paths: Moon (29.5d), Sun ecliptic (1yr), planets
 *   - Searchable by name from the search bar
 */

const SpaceLayer = (() => {
  let viewer = null;
  let entities = [];
  let orbitEntities = [];
  let beltEntities = [];
  let visible = false;
  let _updateInterval = null;
  let _trackedId = null;

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

  // ── Planet textures (Solar System Scope — CC BY 4.0) ──────────────────────
  // Fallback to solid colors if CORS blocks cross-origin textures
  const TEXTURES = {
    sun:     'https://www.solarsystemscope.com/textures/download/2k_sun.jpg',
    moon:    'https://www.solarsystemscope.com/textures/download/2k_moon.jpg',
    mercury: 'https://www.solarsystemscope.com/textures/download/2k_mercury.jpg',
    venus:   'https://www.solarsystemscope.com/textures/download/2k_venus_atmosphere.jpg',
    mars:    'https://www.solarsystemscope.com/textures/download/2k_mars.jpg',
    jupiter: 'https://www.solarsystemscope.com/textures/download/2k_jupiter.jpg',
    saturn:  'https://www.solarsystemscope.com/textures/download/2k_saturn.jpg',
    uranus:  'https://www.solarsystemscope.com/textures/download/2k_uranus.jpg',
    neptune: 'https://www.solarsystemscope.com/textures/download/2k_neptune.jpg',
  };

  // Fallback colors if textures fail to load
  const COLORS = {
    sun:     '#ffffa0',
    moon:    '#c8c8c8',
    mercury: '#b5b5b5',
    venus:   '#f5deb3',
    mars:    '#cd5c5c',
    jupiter: '#d2a679',
    saturn:  '#e4d191',
    uranus:  '#7de8e8',
    neptune: '#3f54ba',
  };

  // ── Planet config: scene distances + radii (scaled for navigability) ──────
  const PLANET_CFG = {
    sun:     { sceneAlt: 3e11,   sceneRadius: 2e9 },
    moon:    { sceneAlt: 3.84e8, sceneRadius: 5e6 },
    mercury: { sceneAlt: 2e10,   sceneRadius: 1e8 },
    venus:   { sceneAlt: 3.6e10, sceneRadius: 2e8 },
    mars:    { sceneAlt: 7.6e10, sceneRadius: 1.5e8 },
    jupiter: { sceneAlt: 2.6e11, sceneRadius: 5e8 },
    saturn:  { sceneAlt: 4.77e11, sceneRadius: 4e8 },
    uranus:  { sceneAlt: 9.6e11, sceneRadius: 3e8 },
    neptune: { sceneAlt: 1.5e12, sceneRadius: 2.8e8 },
  };

  // ── Icon generators (for non-planet objects) ──────────────────────────────
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
  // Objects with a PLANET_CFG entry render as 3D ellipsoids.
  // Others render as billboards (black holes, galaxies).
  const OBJECTS = [
    {
      id: 'sun', name: 'Sun', type: 'star',
      ra: null, dec: null,
      dynamic: true, getRaDec: _sunRaDec,
      orbitPeriodDays: 365.25, orbitColor: '#ffdd00',
      data: {
        type: 'Star (G-type main sequence)', distance: '149.6 million km (1 AU)',
        diameter: '1,392,700 km (109× Earth)', mass: '1.989 × 10³⁰ kg',
        surface_temp: '5,778 K', age: '4.6 billion years',
        description: 'The star at the center of the Solar System. Provides all energy for life on Earth.',
      }
    },
    {
      id: 'moon', name: 'Moon', type: 'natural_satellite',
      ra: null, dec: null,
      dynamic: true, getRaDec: _moonRaDec,
      orbitPeriodDays: 29.5, orbitColor: '#aaaaaa',
      data: {
        type: 'Natural Satellite', distance: '384,400 km (avg)',
        diameter: '3,474 km (0.27× Earth)', orbital_period: '27.3 days',
        description: "Earth's only natural satellite. Stabilizes Earth's axial tilt.",
      }
    },
    { id: 'mercury', name: 'Mercury', type: 'planet', ra: 30, dec: 5,
      orbitPeriodDays: 87.97, orbitColor: '#b5b5b5',
      data: { type: 'Terrestrial Planet', distance: '77 million km (avg)', diameter: '4,879 km',
        orbital_period: '88 Earth days', description: 'Closest planet to the Sun. Extreme temperature swings.' }
    },
    { id: 'venus', name: 'Venus', type: 'planet', ra: 60, dec: 10,
      orbitPeriodDays: 224.7, orbitColor: '#f5deb3',
      data: { type: 'Terrestrial Planet', distance: '38 million km (closest)', diameter: '12,104 km',
        orbital_period: '225 Earth days', surface_temp: '465°C', description: 'Hottest planet. Dense CO₂ atmosphere.' }
    },
    { id: 'mars', name: 'Mars', type: 'planet', ra: 120, dec: 15,
      orbitPeriodDays: 687, orbitColor: '#cd5c5c',
      data: { type: 'Terrestrial Planet', distance: '56–225 million km', diameter: '6,779 km',
        orbital_period: '687 Earth days', moons: 'Phobos, Deimos',
        description: 'The Red Planet. Has Olympus Mons, largest volcano in solar system.' }
    },
    { id: 'jupiter', name: 'Jupiter', type: 'planet', ra: 180, dec: 5,
      orbitPeriodDays: 4333, orbitColor: '#d2a679',
      data: { type: 'Gas Giant', distance: '588–968 million km', diameter: '139,820 km (largest)',
        orbital_period: '11.9 Earth years', moons: '95 known (Io, Europa, Ganymede, Callisto)',
        great_red_spot: 'Storm 340+ years old', description: 'Largest planet. Protects inner solar system.' }
    },
    { id: 'saturn', name: 'Saturn', type: 'planet', ra: 210, dec: -5,
      orbitPeriodDays: 10759, orbitColor: '#e4d191',
      data: { type: 'Gas Giant (Ringed)', distance: '1.2–1.67 billion km', diameter: '116,460 km',
        orbital_period: '29.5 Earth years', rings: 'Seven ring groups, 282,000 km wide', moons: '146 known',
        description: 'Famous for its spectacular ring system made of ice and rock.' }
    },
    { id: 'uranus', name: 'Uranus', type: 'planet', ra: 240, dec: -10,
      orbitPeriodDays: 30687, orbitColor: '#7de8e8',
      data: { type: 'Ice Giant', distance: '2.58–3.15 billion km', diameter: '50,724 km',
        orbital_period: '84 Earth years', axial_tilt: '97.77° (rotates on its side)',
        description: 'Rotates on its side. Coldest planetary atmosphere.' }
    },
    { id: 'neptune', name: 'Neptune', type: 'planet', ra: 270, dec: -15,
      orbitPeriodDays: 60190, orbitColor: '#3f54ba',
      data: { type: 'Ice Giant', distance: '4.3–4.7 billion km', diameter: '49,528 km',
        orbital_period: '165 Earth years', wind_speed: '2,100 km/h (fastest in solar system)',
        description: 'Windiest planet. Has Great Dark Spot similar to Jupiter\'s Great Red Spot.' }
    },
    // ── Deep space objects (billboard rendering) ──
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

  /** Get the scene altitude for an object (from PLANET_CFG or obj.altM) */
  function _getAltM(obj) {
    const cfg = PLANET_CFG[obj.id];
    return cfg ? cfg.sceneAlt : (obj.altM || 1e12);
  }

  // ── Load all objects ──────────────────────────────────────────────────────
  function load() {
    _clear();
    const now = Date.now();

    // Disable built-in CesiumJS moon to avoid duplicate
    NexusGlobe.setBuiltinMoon(false);

    for (const obj of OBJECTS) {
      const { ra, dec } = _getCurrentRaDec(obj, now);
      const altM = _getAltM(obj);
      const pos = _radecToCartesian(ra, dec, altM, now);

      const cfg = PLANET_CFG[obj.id];

      if (cfg) {
        // ── 3D Ellipsoid planet/star/moon ──
        _createEllipsoidEntity(obj, pos, cfg);
      } else {
        // ── Billboard (black holes, galaxies) ──
        _createBillboardEntity(obj, pos);
      }
    }

    // Asteroid belt
    _createAsteroidBelt();

    // Start dynamic position updates for Sun + Moon
    _startDynamicUpdates();

    visible = true;
    NexusToast.show(`Solar System loaded — ${OBJECTS.length} objects + asteroid belt`, 'info', 4000);
  }

  /** Create a 3D ellipsoid entity for a planet/star/moon */
  function _createEllipsoidEntity(obj, pos, cfg) {
    const r = cfg.sceneRadius;
    const colorStr = COLORS[obj.id] || '#888888';
    const textureUrl = TEXTURES[obj.id];

    // Try texture first, fall back to solid color
    let material;
    if (textureUrl) {
      material = new Cesium.ImageMaterialProperty({
        image: textureUrl,
        repeat: new Cesium.Cartesian2(1, 1),
      });
    } else {
      material = Cesium.Color.fromCssColorString(colorStr);
    }

    const typeLabel = {
      star: '⭐', planet: '🪐', natural_satellite: '🌕',
    }[obj.type] || '•';

    // Use CallbackProperty + posRef so viewer.trackedEntity can continuously follow
    const posRef = { value: pos };

    const ent = viewer.entities.add({
      id: `space-${obj.id}`,
      position: new Cesium.CallbackProperty(() => posRef.value, false),
      ellipsoid: {
        radii: new Cesium.Cartesian3(r, r, r),
        material: material,
        slicePartitions: 36,
        stackPartitions: 18,
      },
      label: {
        text: `${typeLabel} ${obj.name}`,
        font: 'bold 11px Courier New',
        fillColor: obj.type === 'star' ? Cesium.Color.fromCssColorString('#ffff88')
          : Cesium.Color.fromCssColorString('#c0deff'),
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 2,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(0, -24),
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, cfg.sceneAlt * 5),
        scaleByDistance: new Cesium.NearFarScalar(cfg.sceneRadius * 2, 1.0, cfg.sceneAlt * 3, 0.4),
        show: true,
      },
      properties: {
        type: 'space_object',
        subtype: obj.type,
        data: { ...obj.data, name: obj.name, id: obj.id },
      },
    });
    ent._posRef = posRef;  // store ref for dynamic position updates
    entities.push(ent);
  }

  /** Create a billboard entity for deep-space objects */
  function _createBillboardEntity(obj, pos) {
    const typeLabel = {
      stellar_black_hole: '⬛ BH', supermassive_black_hole: '⬛ SMBH',
      galaxy: '🌌', galaxy_core: '🌌',
    }[obj.type] || '•';

    // Per-type scaling instead of one-size-fits-all
    const scaleMap = {
      stellar_black_hole:      new Cesium.NearFarScalar(1e10, 2.0, 5e13, 0.5),
      supermassive_black_hole: new Cesium.NearFarScalar(1e11, 3.0, 8e13, 0.5),
      galaxy:                  new Cesium.NearFarScalar(1e11, 3.0, 8e13, 0.5),
      galaxy_core:             new Cesium.NearFarScalar(1e11, 2.5, 8e13, 0.5),
    };

    // Use CallbackProperty + posRef so viewer.trackedEntity can continuously follow
    const posRef = { value: pos };

    const ent = viewer.entities.add({
      id: `space-${obj.id}`,
      position: new Cesium.CallbackProperty(() => posRef.value, false),
      billboard: {
        image: obj.icon,
        width: obj.size,
        height: obj.size,
        verticalOrigin: Cesium.VerticalOrigin.CENTER,
        scaleByDistance: scaleMap[obj.type] || new Cesium.NearFarScalar(1e7, 3.0, 1e13, 0.3),
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 5e14),
      },
      label: {
        text: `${typeLabel} ${obj.name}`,
        font: 'bold 10px Courier New',
        fillColor: obj.type.includes('black_hole') ? Cesium.Color.fromCssColorString('#cc88ff')
          : Cesium.Color.fromCssColorString('#aaaaff'),
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 2,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(0, -obj.size / 2 - 4),
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 2e14),
        show: true,
      },
      properties: {
        type: 'space_object',
        subtype: obj.type,
        data: { ...obj.data, name: obj.name, id: obj.id },
      },
    });
    ent._posRef = posRef;  // store ref for dynamic position updates
    entities.push(ent);
  }

  // ── Asteroid belt (300 points between Mars and Jupiter) ───────────────────
  function _createAsteroidBelt() {
    const BELT_COUNT = 300;
    const MIN_ALT = 1e11;    // ~1.3 AU scaled (just beyond Mars at 7.6e10)
    const MAX_ALT = 2.3e11;  // ~3 AU scaled (just before Jupiter at 2.6e11)

    for (let i = 0; i < BELT_COUNT; i++) {
      const alt = MIN_ALT + Math.random() * (MAX_ALT - MIN_ALT);
      const ra = Math.random() * 360;
      const dec = (Math.random() - 0.5) * 8; // small scatter around ecliptic
      const pos = _radecToCartesian(ra, dec, alt);
      const size = 3 + Math.random() * 5;

      const ent = viewer.entities.add({
        id: `asteroid-belt-${i}`,
        position: pos,
        point: {
          pixelSize: size,
          color: Cesium.Color.fromCssColorString('#8b7355').withAlpha(0.5 + Math.random() * 0.5),
          scaleByDistance: new Cesium.NearFarScalar(1e9, 1.5, 5e11, 0.3),
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 2e12),
        },
      });
      beltEntities.push(ent);
    }
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
      const newPos = _radecToCartesian(ra, dec, _getAltM(obj), now);
      // Update via posRef so CallbackProperty returns new position
      if (ent._posRef) {
        ent._posRef.value = newPos;
      }
    }
  }

  // ── Orbit path computation ────────────────────────────────────────────────
  function _computeOrbitPath(obj) {
    if (!obj.orbitPeriodDays) return null;
    const now = Date.now();
    const periodMs = obj.orbitPeriodDays * 86400000;
    const altM = _getAltM(obj);
    const steps = 120;
    const points = [];

    for (let i = 0; i <= steps; i++) {
      const t = now - periodMs / 2 + (i / steps) * periodMs;
      const { ra, dec } = _getCurrentRaDec(obj, t);
      points.push(_radecToCartesian(ra, dec, altM, t));
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

  // ── Tracking (continuous via viewer.trackedEntity) ────────────────────────
  function trackObject(objId) {
    stopTracking();
    _trackedId = objId;

    const obj = OBJECTS.find(o => o.id === objId);
    if (!obj) return;

    // Show orbit if available
    showOrbitForObject(objId);

    // Use Cesium's built-in tracked entity for continuous camera follow
    const entity = viewer.entities.getById(`space-${objId}`);
    if (entity) {
      // First fly to the object, then lock tracking
      const altM = _getAltM(obj);
      const viewDist = altM * (obj.type === 'star' ? 0.3 : 1.5);

      // Set as tracked entity — camera continuously follows
      viewer.trackedEntity = entity;

      // Adjust zoom distance after tracking locks
      setTimeout(() => {
        if (_trackedId === objId) {
          const cfg = PLANET_CFG[obj.id];
          const zoomDist = cfg ? cfg.sceneRadius * 5 : viewDist;
          viewer.camera.zoomOut(zoomDist);
        }
      }, 500);
    }

    NexusToast.show(`Tracking ${obj.name} — zoom/orbit freely, click Refresh to stop`, 'info', 3000);
  }

  function stopTracking() {
    _trackedId = null;
    _clearOrbits();
    if (viewer) {
      viewer.trackedEntity = undefined;
      viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
    }
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
    beltEntities.forEach(e => viewer.entities.remove(e));
    beltEntities = [];
    _clearOrbits();
    // Re-enable built-in moon
    NexusGlobe.setBuiltinMoon(true);
  }

  function setVisible(v) {
    visible = v;
    entities.forEach(e => { e.show = v; });
    beltEntities.forEach(e => { e.show = v; });
    if (v && entities.length === 0) {
      load();
    } else if (!v) {
      stopTracking();
      if (_updateInterval) { clearInterval(_updateInterval); _updateInterval = null; }
      NexusGlobe.setBuiltinMoon(true);
    } else {
      NexusGlobe.setBuiltinMoon(false);
    }
  }

  return { init, load, setVisible, trackObject, stopTracking, showOrbitForObject, search };
})();
