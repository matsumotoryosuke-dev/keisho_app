import './ui/panel.css';
import { Renderer }        from './engine/renderer.js';
import { GlitchEffect }    from './engine/effects/glitch.js';
import { NoiseEffect }     from './engine/effects/noise.js';
import { ChromaticEffect } from './engine/effects/chromatic.js';
import { ScanlinesEffect } from './engine/effects/scanlines.js';
import { sampleGlyphPixels } from './engine/glyphSampler.js';
import { buildControls, cancelActiveExport, teardownControls, updateTemplateParams } from './ui/controls.js';
import { TEMPLATES, DEFAULT_TEMPLATE_ID } from './engine/templates.js';
import { PALETTES, DEFAULT_PALETTE_ID, getPaletteById } from './engine/palettes.js';
import { initRouter, navigate, parseEditorParams, onRouteChange } from './router.js';
import { buildHome } from './ui/home.js';
import { openSaveModal } from './ui/saveModal.js';
import { createSave, getSaveById, updateSave, captureThumbnail } from './saves.js';
import { AudioEngine } from './engine/audioEngine.js';

// ── Audio engine (singleton for this session) ──────────────────
const audioEngine = new AudioEngine();

// ── Canvas setup ───────────────────────────────────────────────
const canvas  = document.getElementById('canvas');
const preview = document.getElementById('preview');

function fitCanvas() {
  const pw = preview.clientWidth;
  const ph = preview.clientHeight;
  const canvasAspect = 1920 / 1080;
  const containerAspect = pw / ph;

  let displayW, displayH;
  if (containerAspect > canvasAspect) {
    displayH = ph;
    displayW = ph * canvasAspect;
  } else {
    displayW = pw;
    displayH = pw / canvasAspect;
  }

  canvas.style.width  = displayW + 'px';
  canvas.style.height = displayH + 'px';
}

fitCanvas();
window.addEventListener('resize', fitCanvas);

// ── Engine ─────────────────────────────────────────────────────
const renderer = new Renderer(canvas);

// ── Text state ─────────────────────────────────────────────────
const textState = {
  text:          'LOOP',
  font:          'Space Grotesk',
  size:          220,
  letterSpacing: 24,
};

// ── Post-process overlays (default OFF) ───────────────────────
const glitch    = new GlitchEffect();
glitch.enabled  = false;

const noise     = new NoiseEffect();
noise.enabled   = false;

const chromatic = new ChromaticEffect();
chromatic.enabled       = false;
chromatic.params.spread = 4;

const scanlines = new ScanlinesEffect();
scanlines.enabled            = false;
scanlines.params.opacity     = 0.22;
scanlines.params.lineHeight  = 3;

const effects = { glitch, noise, chromatic, scanlines };

// ── Active template & palette ──────────────────────────────────
let activeTemplate    = TEMPLATES.find(t => t.id === DEFAULT_TEMPLATE_ID) || TEMPLATES[0];
let currentPaletteId  = DEFAULT_PALETTE_ID;
let transparentBg     = false;

// ── Glyph data cache ───────────────────────────────────────────
let _glyphData    = null;
let _glyphCacheKey = '';

function glyphCacheKey() {
  return `${textState.text}|${textState.font}|${textState.size}|${textState.letterSpacing}`;
}

function getGlyphData() {
  // Geometry templates and pure-geometry audio templates don't need glyph data
  if (activeTemplate.category === 'geometry') return null;
  if (activeTemplate.needsGlyphs === false) return null;

  const key = glyphCacheKey();
  if (_glyphData && _glyphCacheKey === key) return _glyphData;

  const density = activeTemplate.density || 0.25;
  _glyphData     = sampleGlyphPixels(
    textState.text,
    textState.font,
    textState.size,
    textState.letterSpacing,
    canvas.width,
    canvas.height,
    density,
  );
  _glyphCacheKey = key;
  return _glyphData;
}

export const textProxy = {
  get text()          { return textState.text; },
  set text(v)         { textState.text = v;          _glyphData = null; },
  get font()          { return textState.font; },
  set font(v)         { textState.font = v;           _glyphData = null; },
  get size()          { return textState.size; },
  set size(v)         { textState.size = v;           _glyphData = null; },
  get letterSpacing() { return textState.letterSpacing; },
  set letterSpacing(v){ textState.letterSpacing = v;  _glyphData = null; },
  color: '#ffffff',
  align: 'center',
};

// ── Palette application ────────────────────────────────────────
function applyPalette(paletteId) {
  currentPaletteId = paletteId;
}

// ── Template application ───────────────────────────────────────
function applyTemplate(templateId) {
  const tmpl = TEMPLATES.find(t => t.id === templateId);
  if (!tmpl) return;

  activeTemplate = tmpl;

  // Update topbar name
  const nameEl = document.getElementById('editor-template-name');
  if (nameEl) nameEl.textContent = tmpl.name;

  // Apply template text/font settings (skip for geometry)
  if (tmpl.category !== 'geometry') {
    textProxy.font          = tmpl.font || 'Space Grotesk';
    textProxy.size          = tmpl.textSize || 220;
    textProxy.letterSpacing = tmpl.letterSpacing || 24;
  }

  // Loop duration
  renderer.loopDuration = tmpl.loopDuration || 4000;

  // Apply palette
  applyPalette(tmpl.defaultPalette || tmpl.paletteId || DEFAULT_PALETTE_ID);

  // Invalidate glyph cache
  _glyphData = null;

  // Update template params section in controls panel
  updateTemplateParams(activeTemplate);
}

// ── Render loop ────────────────────────────────────────────────
renderer.onFrame = (time, ctx, canvasEl) => {
  const w       = canvasEl.width;
  const h       = canvasEl.height;
  const palette = getPaletteById(currentPaletteId);

  // 1. Clear
  if (transparentBg) {
    ctx.clearRect(0, 0, w, h);
  } else {
    ctx.fillStyle = palette ? palette.background : '#000000';
    ctx.fillRect(0, 0, w, h);
  }

  // 2. Get (or skip) glyph point data
  const glyphData = getGlyphData();

  // 3. Build audio data snapshot for this frame
  const audioData = {
    waveform:  audioEngine.getWaveform(),
    frequency: audioEngine.getFrequency(),
    bass:      audioEngine.getBass(),
    mid:       audioEngine.getMid(),
    treble:    audioEngine.getTreble(),
    amplitude: audioEngine.getAmplitude(),
    hasAudio:  audioEngine.isLoaded,
  };

  // 4. Run the active template (6th param: audioData)
  if (activeTemplate && palette) {
    activeTemplate.render(ctx, canvasEl, time, glyphData, palette, audioData);
  }

  // 5. Post-process overlays
  glitch.apply(ctx, canvasEl, time);
  noise.apply(ctx, canvasEl, time);
  chromatic.apply(ctx, canvasEl, time);
  scanlines.apply(ctx, canvasEl, time);
};

// ── Snapshot renderer for exports ─────────────────────────────
// Returns a render function that captures the current template and palette
// by value, so mid-export template switches don't corrupt the frame sequence.
function getSnapshotRenderer() {
  const snapshotTemplate   = activeTemplate;
  const snapshotPaletteId  = currentPaletteId;
  const snapshotTransparent = transparentBg;

  return (time, ctx, canvasEl) => {
    const w       = canvasEl.width;
    const h       = canvasEl.height;
    const palette = getPaletteById(snapshotPaletteId);

    if (snapshotTransparent) {
      ctx.clearRect(0, 0, w, h);
    } else {
      ctx.fillStyle = palette ? palette.background : '#000000';
      ctx.fillRect(0, 0, w, h);
    }

    const glyphData = getGlyphData();

    const audioData = {
      waveform:  audioEngine.getWaveform(),
      frequency: audioEngine.getFrequency(),
      bass:      audioEngine.getBass(),
      mid:       audioEngine.getMid(),
      treble:    audioEngine.getTreble(),
      amplitude: audioEngine.getAmplitude(),
      hasAudio:  audioEngine.isLoaded,
    };

    if (snapshotTemplate && palette) {
      snapshotTemplate.render(ctx, canvasEl, time, glyphData, palette, audioData);
    }

    glitch.apply(ctx, canvasEl, time);
    noise.apply(ctx, canvasEl, time);
    chromatic.apply(ctx, canvasEl, time);
    scanlines.apply(ctx, canvasEl, time);
  };
}

// ── Build editor UI ────────────────────────────────────────────
let _controlsBuilt = false;

function ensureControlsBuilt() {
  if (_controlsBuilt) return;
  _controlsBuilt = true;

  const panelEl = document.getElementById('panel');

  buildControls(
    renderer,
    textProxy,
    effects,
    panelEl,
    {
      templates:      TEMPLATES,
      palettes:       PALETTES,
      applyTemplate:  applyTemplate,
      applyPalette:   applyPalette,
      getPaletteById: getPaletteById,
      getTransparentBg: () => transparentBg,
      setTransparentBg: (v) => { transparentBg = v; chromatic.transparentBg = v; },
      renderFrame:    renderer.onFrame,
      getRenderer:    () => renderer,
      getSnapshotRenderer,
      getCurrentPaletteId: () => currentPaletteId,
      audioEngine,
    }
  );
}

// ── Editor topbar wiring ───────────────────────────────────────
document.getElementById('btn-back').addEventListener('click', () => {
  cancelActiveExport();
  teardownControls();
  renderer.stop();
  navigate('#/home');
});

document.getElementById('btn-save').addEventListener('click', () => {
  const existingSave = _currentSaveId ? getSaveById(_currentSaveId) : null;
  openSaveModal({
    defaultName: existingSave ? existingSave.name : (activeTemplate.name + ' Loop'),
    showDuplicate: Boolean(_currentSaveId),
    onSave(name, isDuplicate) {
      const thumbnail = captureThumbnail(canvas);
      const saveData = {
        name,
        templateId:    activeTemplate.id,
        text:          textProxy.text,
        font:          textProxy.font,
        fontSize:      textProxy.size,
        letterSpacing: textProxy.letterSpacing,
        paletteId:     currentPaletteId,
        params:        activeTemplate.params ? { ...activeTemplate.params } : {},
        thumbnail,
      };

      try {
        if (_currentSaveId && !isDuplicate) {
          // Update existing
          Promise.resolve().then(() => {
            try {
              updateSave(_currentSaveId, saveData);
            } catch (err) {
              alert(err.message);
            }
          });
        } else {
          // Create new
          const saved = createSave(saveData);
          if (!isDuplicate) _currentSaveId = saved.id;
        }
      } catch (err) {
        alert(err.message);
      }
    },
  });
});

let _currentSaveId = null;

// ── Route handling ─────────────────────────────────────────────
onRouteChange((page, hash) => {
  if (page === 'editor') {
    const params = parseEditorParams();
    ensureControlsBuilt();
    // Re-fit canvas now that #page-editor is visible (it was display:none on load)
    requestAnimationFrame(fitCanvas);

    if (params.saved) {
      // Load saved project
      const save = getSaveById(params.saved);
      if (save) {
        _currentSaveId = save.id;
        // Restore state
        textProxy.text          = save.text || 'LOOP';
        textProxy.font          = save.font || 'Space Grotesk';
        textProxy.size          = save.fontSize || 220;
        textProxy.letterSpacing = save.letterSpacing ?? 24;
        currentPaletteId        = save.paletteId || DEFAULT_PALETTE_ID;
        // Apply template (sets name in topbar)
        applyTemplate(save.templateId || DEFAULT_TEMPLATE_ID);
        // Override palette back to saved (applyTemplate may have changed it)
        currentPaletteId = save.paletteId || DEFAULT_PALETTE_ID;
        // Restore saved template params (shallow-merge so unknown keys are ignored)
        if (save.params && typeof save.params === 'object' && activeTemplate.params) {
          Object.assign(activeTemplate.params, save.params);
          updateTemplateParams(activeTemplate);
        }
      } else {
        // Save not found — fall through to default
        _currentSaveId = null;
        applyTemplate(DEFAULT_TEMPLATE_ID);
      }
    } else if (params.template) {
      _currentSaveId = null;
      applyTemplate(params.template);
    } else {
      _currentSaveId = null;
      applyTemplate(DEFAULT_TEMPLATE_ID);
    }

    renderer.start();
  } else {
    // Home page
    renderer.stop();
    const homeContent = document.getElementById('home-content');
    buildHome(homeContent);
  }
});

// ── Init router (reads current hash, shows correct page) ──────
// NOTE: initRouter() fires onRouteChange immediately, which calls buildHome()
// for the home page. Do NOT call buildHome() here separately — that would
// register duplicate IntersectionObservers and RAF loops (P1-05 fix).
initRouter();
