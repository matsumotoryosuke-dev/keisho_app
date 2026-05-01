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
import { Exporter, EXPORT_PRESETS } from './engine/exporter.js';

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

  // Glyph data must be resampled at the EXPORT canvas size, not the display
  // canvas size. Display is always 1920×1080; export can be 1280×720, 4K, etc.
  // Using display-canvas coordinates on an export canvas shifts everything
  // to the wrong position (typically off-screen bottom-right).
  let _exportGlyphData = null;
  let _exportGlyphKey  = '';

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

    // Resample glyph data at the export resolution on the first frame,
    // then cache it for the rest of the export sequence.
    let glyphData = null;
    if (snapshotTemplate.category !== 'geometry' && snapshotTemplate.needsGlyphs !== false) {
      const exportKey = `${textState.text}|${textState.font}|${textState.size}|${textState.letterSpacing}|${w}|${h}`;
      if (_exportGlyphKey !== exportKey) {
        const density = snapshotTemplate.density || 0.25;
        _exportGlyphData = sampleGlyphPixels(
          textState.text,
          textState.font,
          textState.size,
          textState.letterSpacing,
          w,
          h,
          density,
        );
        _exportGlyphKey = exportKey;
      }
      glyphData = _exportGlyphData;
    }

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

// ── Headless export mode (used by MCP server / AI agents) ─────────────────
async function doHeadlessExport(format, resolution) {
  const preset = EXPORT_PRESETS.find(p => p.id === resolution) || EXPORT_PRESETS.find(p => p.id === '1080p');
  console.log(`[headless] starting ${format} export at ${resolution}`);

  const exporter = new Exporter(getSnapshotRenderer(), {
    width:         preset.width,
    height:        preset.height,
    fps:           60,
    loopDuration:  renderer.loopDuration,
    transparentBg: false,
    onProgress: (pct) => console.log(`[headless] ${(pct * 100).toFixed(0)}%`),
    onStatus:   (msg) => console.log(`[headless] ${msg}`),
  });

  if (format === 'png-zip')     await exporter.exportPNGZip();
  else if (format === 'mp4')    await exporter.exportMP4();
  else if (format === 'prores') await exporter.exportProResLuma();
  else                          await exporter.exportWebM();

  console.log('[headless] export complete');
}

function tryHeadlessMode() {
  const sp = new URLSearchParams(window.location.search);
  if (sp.get('headless') !== '1') return;

  // Apply params from query string
  const text = sp.get('text');
  if (text) textProxy.text = decodeURIComponent(text);

  const ld = parseFloat(sp.get('loopDuration'));
  if (!isNaN(ld) && ld > 0) renderer.loopDuration = ld * 1000;

  const format     = sp.get('format') || 'webm';
  const resolution = sp.get('resolution') || '1080p';

  // Let the renderer warm up for a few frames before triggering export
  let warmupFrames = 0;
  const origOnFrame = renderer.onFrame;
  renderer.onFrame = (time, ctx, canvasEl) => {
    origOnFrame(time, ctx, canvasEl);
    warmupFrames++;
    if (warmupFrames === 5) {
      // Restore and trigger export
      renderer.onFrame = origOnFrame;
      doHeadlessExport(format, resolution).catch(err => {
        console.error('[headless] export error:', err);
      });
    }
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
      // Allow MCP / deep-links to override the template's default palette
      if (params.palette) applyPalette(params.palette);
    } else {
      _currentSaveId = null;
      applyTemplate(DEFAULT_TEMPLATE_ID);
    }

    tryHeadlessMode();
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
