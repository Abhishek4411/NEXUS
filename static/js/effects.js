/**
 * NEXUS Effects — Post-processing visual modes.
 * Normal | NVG (Night Vision) | Thermal | CRT
 * Also handles bloom and brightness controls.
 */

const NexusEffects = (() => {
  let viewer = null;
  let bloomStage = null;
  let brightnessStage = null;
  let currentMode = 'normal';

  function init(cesiumViewer) {
    viewer = cesiumViewer;

    // Bloom post-process stage
    bloomStage = viewer.scene.postProcessStages.bloom;
    bloomStage.enabled = false;
    bloomStage.uniforms.contrast = 128;
    bloomStage.uniforms.brightness = -0.3;
    bloomStage.uniforms.delta = 1.0;
    bloomStage.uniforms.sigma = 2.0;
    bloomStage.uniforms.stepSize = 1.0;

    // Brightness/contrast stage
    brightnessStage = Cesium.PostProcessStageLibrary.createBrightnessStage();
    brightnessStage.enabled = false;
    viewer.scene.postProcessStages.add(brightnessStage);

    console.log('✅ Effects initialized');
  }

  function setMode(mode) {
    if (!viewer) return;
    const container = document.getElementById('cesium-container');
    container.classList.remove('nvg-mode', 'thermal-mode', 'crt-mode');
    currentMode = mode;

    if (mode === 'nvg') {
      container.classList.add('nvg-mode');
      _setBrightness(0.3);
    } else if (mode === 'thermal') {
      container.classList.add('thermal-mode');
      _setBrightness(0.1);
    } else if (mode === 'crt') {
      container.classList.add('crt-mode');
      _setBrightness(0);
    } else {
      _setBrightness(0);
    }
  }

  function setBloom(strength) {
    if (!bloomStage) return;
    if (strength > 0) {
      bloomStage.enabled = true;
      bloomStage.uniforms.brightness = -0.3 + (strength * 0.2);
      bloomStage.uniforms.sigma = 1 + strength;
    } else {
      bloomStage.enabled = false;
    }
  }

  function _setBrightness(value) {
    if (!brightnessStage) return;
    if (value !== 0) {
      brightnessStage.enabled = true;
      brightnessStage.uniforms.brightness = value;
    } else {
      brightnessStage.enabled = false;
    }
  }

  function setBrightness(value) { _setBrightness(parseFloat(value)); }

  function getMode() { return currentMode; }

  return { init, setMode, setBloom, setBrightness, getMode };
})();
