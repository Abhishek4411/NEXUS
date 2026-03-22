/**
 * NEXUS Globe — CesiumJS 3D globe initialization.
 *
 * Features:
 *  - Star field (Tycho2 sky box — 2.5 million stars)
 *  - Sun at correct ecliptic position (casts real shadows)
 *  - Moon at correct position
 *  - Earth atmosphere (blue limb glow)
 *  - Day/night lighting on the globe surface
 *  - Async Ion imagery: Google Maps Satellite (asset 3830183) + Terrain (asset 1)
 *  - CartoDB Dark Matter fallback (no token needed)
 */

const NexusGlobe = (() => {
  let viewer = null;
  let mouseMoveHandler = null;
  let fpsCounter = { frames: 0, last: Date.now(), fps: 0 };

  /**
   * Initialize the CesiumJS viewer (async).
   * @param {string} containerId
   * @param {string|null} ionToken
   * @returns {Promise<Cesium.Viewer>}
   */
  async function init(containerId, ionToken = null) {
    if (ionToken) {
      Cesium.Ion.defaultAccessToken = ionToken;
    }

    // ── Star field (built-in Tycho2 catalog) ────────────────────────────
    const skyBox = new Cesium.SkyBox({
      sources: {
        positiveX: Cesium.buildModuleUrl('Assets/Textures/SkyBox/tycho2t3_80_px.jpg'),
        negativeX: Cesium.buildModuleUrl('Assets/Textures/SkyBox/tycho2t3_80_mx.jpg'),
        positiveY: Cesium.buildModuleUrl('Assets/Textures/SkyBox/tycho2t3_80_py.jpg'),
        negativeY: Cesium.buildModuleUrl('Assets/Textures/SkyBox/tycho2t3_80_my.jpg'),
        positiveZ: Cesium.buildModuleUrl('Assets/Textures/SkyBox/tycho2t3_80_pz.jpg'),
        negativeZ: Cesium.buildModuleUrl('Assets/Textures/SkyBox/tycho2t3_80_mz.jpg'),
      },
    });

    viewer = new Cesium.Viewer(containerId, {
      imageryProvider: false,          // Added after construction
      baseLayerPicker: false,
      geocoder: false,
      homeButton: false,
      sceneModePicker: false,
      navigationHelpButton: false,
      animation: false,
      timeline: false,
      fullscreenButton: false,
      infoBox: false,
      selectionIndicator: false,
      skyBox,                          // ✨ 2.5M stars (Tycho2)
      skyAtmosphere: new Cesium.SkyAtmosphere(),  // ✨ blue atmospheric limb
      shadows: true,                   // ✨ sun casts real shadows
      terrainProvider: new Cesium.EllipsoidTerrainProvider(),
    });

    // ── Globe appearance ─────────────────────────────────────────────────
    viewer.scene.backgroundColor = Cesium.Color.BLACK;
    // baseColor shows while tiles load — use deep ocean blue for realistic feel
    viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString('#1a3a5c');
    viewer.scene.globe.enableLighting = true;       // ✨ real day/night terminator
    viewer.scene.globe.showGroundAtmosphere = true; // ✨ atmospheric haze at horizon

    // ── Sun & Moon ───────────────────────────────────────────────────────
    viewer.scene.sun  = new Cesium.Sun();    // ✨ sun at real ecliptic position
    viewer.scene.moon = new Cesium.Moon();   // ✨ moon at real position

    // SSAO: off (performance)
    viewer.scene.postProcessStages.ambientOcclusion.enabled = false;

    // Remove double-click select behavior
    viewer.screenSpaceEventHandler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);

    // Imagery (async — Ion if token, CartoDB otherwise)
    await _loadImagery(ionToken);

    // Mouse coordinate tracking
    _setupMouseTracking();

    // FPS counter
    _setupFpsTracking();

    // Initial camera position: full Earth view
    viewer.camera.setView({
      destination: Cesium.Cartesian3.fromDegrees(0, 20, 25000000),
      orientation: { pitch: Cesium.Math.toRadians(-90) },
    });

    console.log('🌍 NEXUS Globe initialized — stars, sun, moon, atmosphere active');
    return viewer;
  }

  async function _loadImagery(ionToken) {
    if (ionToken) {
      try {
        // Google Maps Satellite + Labels via Cesium Ion (asset 3830183)
        const googleProvider = await Cesium.IonImageryProvider.fromAssetId(3830183);
        viewer.imageryLayers.addImageryProvider(googleProvider);
        console.log('🗺️ Google Maps Satellite imagery loaded (Ion)');

        // Cesium World Terrain (asset 1)
        try {
          const terrain = await Cesium.CesiumTerrainProvider.fromIonAssetId(1);
          viewer.terrainProvider = terrain;
          console.log('⛰️ Cesium World Terrain loaded');
        } catch (e) {
          console.warn('World Terrain unavailable:', e.message);
        }
        return;
      } catch (e) {
        console.warn('Ion imagery failed, falling back to ESRI:', e.message);
      }
    }
    // Free fallback — ESRI World Imagery (photo-realistic, no auth required)
    // Shows real oceans, land, deserts, forests, ice caps at full color
    viewer.imageryLayers.addImageryProvider(_esriImagery());
    console.log('🌍 ESRI World Imagery loaded (free, realistic Earth)');
  }

  function _esriImagery() {
    // Use UrlTemplateImageryProvider — ArcGisMapServerImageryProvider breaks CesiumJS 1.111
    return new Cesium.UrlTemplateImageryProvider({
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      maximumLevel: 19,
      credit: '© Esri, Maxar, Earthstar Geographics',
    });
  }

  function _addCloudLayer() {
    // NASA GIBS — MODIS Terra true-color reflectance (updates daily, ~250m resolution)
    // Bake yesterday's date directly into URL (avoids broken times/clock params in CesiumJS 1.111)
    const yesterday = (() => {
      const d = new Date();
      d.setDate(d.getDate() - 1);
      return d.toISOString().slice(0, 10);
    })();
    try {
      const cloudLayer = new Cesium.WebMapTileServiceImageryProvider({
        url: `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_CorrectedReflectance_TrueColor/default/${yesterday}/GoogleMapsCompatible_Level9/{TileMatrix}/{TileRow}/{TileCol}.jpg`,
        layer: 'MODIS_Terra_CorrectedReflectance_TrueColor',
        style: 'default',
        format: 'image/jpeg',
        tileMatrixSetID: 'GoogleMapsCompatible_Level9',
        maximumLevel: 9,
        credit: 'NASA GIBS / MODIS Terra',
      });
      // Non-critical — globe still looks great without it
      viewer.imageryLayers.addImageryProvider(cloudLayer).alpha = 0.55;
      console.log(`☁️ MODIS cloud layer loaded for ${yesterday}`);
    } catch (e) {
      console.warn('MODIS cloud layer unavailable:', e.message);
    }
  }

  function _cartoProvider() {
    return new Cesium.UrlTemplateImageryProvider({
      url: 'https://cartodb-basemaps-a.global.ssl.fastly.net/dark_all/{z}/{x}/{y}.png',
      maximumLevel: 18,
      credit: '© CARTO, © OpenStreetMap contributors',
    });
  }

  function _osmProvider() {
    return new Cesium.UrlTemplateImageryProvider({
      url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      maximumLevel: 19,
      credit: '© OpenStreetMap contributors',
    });
  }

  function _labelsOverlay() {
    // CartoDB Positron labels-only (transparent bg) — overlays on satellite imagery
    return new Cesium.UrlTemplateImageryProvider({
      url: 'https://cartodb-basemaps-a.global.ssl.fastly.net/light_only_labels/{z}/{x}/{y}.png',
      maximumLevel: 18,
      credit: '© CARTO, © OpenStreetMap contributors',
      hasAlphaChannel: true,
    });
  }

  function _stadiaTerrainProvider() {
    // Stadia Alidade Smooth Dark — clean terrain with labels
    return new Cesium.UrlTemplateImageryProvider({
      url: 'https://tiles.stadiamaps.com/tiles/stamen_terrain/{z}/{x}/{y}.png',
      maximumLevel: 18,
      credit: '© Stadia Maps, © OpenStreetMap contributors',
    });
  }

  function _cartoLightProvider() {
    // CartoDB Positron — light map with full labels
    return new Cesium.UrlTemplateImageryProvider({
      url: 'https://cartodb-basemaps-a.global.ssl.fastly.net/light_all/{z}/{x}/{y}.png',
      maximumLevel: 18,
      credit: '© CARTO, © OpenStreetMap contributors',
    });
  }

  function _setupMouseTracking() {
    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    handler.setInputAction((movement) => {
      const cartesian = viewer.camera.pickEllipsoid(movement.endPosition);
      if (cartesian) {
        const carto = Cesium.Cartographic.fromCartesian(cartesian);
        const lat = Cesium.Math.toDegrees(carto.latitude).toFixed(4);
        const lon = Cesium.Math.toDegrees(carto.longitude).toFixed(4);
        const alt = (viewer.camera.positionCartographic.height / 1000).toFixed(0);
        const el = document.getElementById('status-coords');
        if (el) el.textContent = `LAT: ${lat}° LON: ${lon}° ALT: ${alt} km`;
      }
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
    mouseMoveHandler = handler;
  }

  function _setupFpsTracking() {
    viewer.scene.postRender.addEventListener(() => {
      fpsCounter.frames++;
      const now = Date.now();
      if (now - fpsCounter.last >= 1000) {
        fpsCounter.fps = fpsCounter.frames;
        fpsCounter.frames = 0;
        fpsCounter.last = now;
        const el = document.getElementById('stat-fps');
        if (el) el.textContent = fpsCounter.fps;
      }
    });
  }

  function flyTo(lon, lat, altitude = 500000, duration = 2) {
    // flyToBoundingSphere always places the target at the exact screen center,
    // regardless of pitch/tilt — fixes the "city appears below/off-center" issue.
    const center = Cesium.Cartesian3.fromDegrees(lon, lat, 0);
    const radius = Math.max(altitude * 0.15, 500);  // bounding sphere radius
    viewer.camera.flyToBoundingSphere(
      new Cesium.BoundingSphere(center, radius),
      {
        duration,
        offset: new Cesium.HeadingPitchRange(
          0,                              // heading: north-up
          Cesium.Math.toRadians(-50),     // pitch: slight tilt for context
          altitude                        // distance from center
        ),
      }
    );
  }

  async function setImagery(type, ionToken) {
    viewer.imageryLayers.removeAll();

    // Google Maps HD Satellite (Ion token required)
    if (type === 'satellite' && ionToken) {
      try {
        const p = await Cesium.IonImageryProvider.fromAssetId(3830183);
        viewer.imageryLayers.addImageryProvider(p);
        return;
      } catch (e) {
        console.warn('Ion satellite imagery failed, using ESRI fallback:', e.message);
      }
    }

    // ESRI satellite (free, no token)
    if (type === 'satellite' || type === 'esri') {
      viewer.imageryLayers.addImageryProvider(_esriImagery());
      return;
    }

    // Hybrid: satellite + street labels overlay
    if (type === 'hybrid') {
      viewer.imageryLayers.addImageryProvider(_esriImagery());
      viewer.imageryLayers.addImageryProvider(_labelsOverlay()).alpha = 0.9;
      return;
    }

    // OpenStreetMap — full streets, city names, POIs
    if (type === 'osm') {
      viewer.imageryLayers.addImageryProvider(_osmProvider());
      return;
    }

    // Terrain map with labels (Stadia)
    if (type === 'terrain') {
      viewer.imageryLayers.addImageryProvider(_stadiaTerrainProvider());
      return;
    }

    // CartoDB Light — clean light map with all labels
    if (type === 'light') {
      viewer.imageryLayers.addImageryProvider(_cartoLightProvider());
      return;
    }

    // CartoDB Dark Matter
    if (type === 'dark') {
      viewer.imageryLayers.addImageryProvider(_cartoProvider());
      return;
    }

    // Default: ESRI realistic satellite
    viewer.imageryLayers.addImageryProvider(_esriImagery());
  }

  function getViewer() { return viewer; }

  function getCameraAltKm() {
    if (!viewer) return 0;
    return viewer.camera.positionCartographic.height / 1000;
  }

  return { init, flyTo, setImagery, getViewer, getCameraAltKm };
})();
