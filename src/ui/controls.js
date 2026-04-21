/**
 * Controls Panel — builds and binds the DOM controls.
 * Sections: Templates | Palettes | Text | Animation | Post-Process Overlays | Export
 *
 * Post-process overlays (Glitch, Wave Noise, Chromatic, Scanlines) are all
 * default-OFF. They sit below the text-first template in the render stack.
 */
import { Exporter, EXPORT_PRESETS } from '../engine/exporter.js';
import { buildAudioPanel, teardownAudioPanel } from './audioPanel.js';

// Module-level reference to any in-progress exporter so navigation can cancel it.
let _currentExporter = null;

// Module-level FPS interval ID so it can be cleared on teardown.
let _fpsInterval = null;

/**
 * Cancel any WebM export that is currently in progress.
 * Safe to call when no export is running.
 */
export function cancelActiveExport() {
  if (_currentExporter) {
    _currentExporter.cancelExport();
    _currentExporter = null;
  }
}

/**
 * Tear down controls side-effects (FPS interval, audio RAF/interval, etc.).
 * Call before navigating away from the editor.
 */
export function teardownControls() {
  if (_fpsInterval !== null) {
    clearInterval(_fpsInterval);
    _fpsInterval = null;
  }
  teardownAudioPanel();
}

// ─────────────────────────────────────────────────────────────────────────────
// Section builder
// ─────────────────────────────────────────────────────────────────────────────
function makeSection(title, defaultOpen, bodyBuilder, toggleOpts) {
  const section = document.createElement('div');
  section.className = 'ctrl-section' + (defaultOpen ? ' is-open' : '');

  const header = document.createElement('div');
  header.className = 'ctrl-section-header';

  const titleEl = document.createElement('span');
  titleEl.className = 'ctrl-section-title';
  titleEl.textContent = title;

  const toggleGroup = document.createElement('div');
  toggleGroup.className = 'ctrl-section-toggle';

  if (toggleOpts) {
    const label = document.createElement('label');
    label.className = 'effect-toggle';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = toggleOpts.enabled;
    const track = document.createElement('span');
    track.className = 'effect-toggle-track';
    const thumb = document.createElement('span');
    thumb.className = 'effect-toggle-thumb';
    label.appendChild(input);
    label.appendChild(track);
    label.appendChild(thumb);

    input.addEventListener('change', (e) => {
      e.stopPropagation();
      toggleOpts.onToggle(input.checked);
    });
    label.addEventListener('click', e => e.stopPropagation());
    toggleGroup.appendChild(label);

    toggleOpts._syncFn = (v) => { input.checked = v; };
  }

  const arrow = document.createElement('span');
  arrow.className = 'collapse-arrow';
  arrow.textContent = '▶';
  toggleGroup.appendChild(arrow);

  header.appendChild(titleEl);
  header.appendChild(toggleGroup);

  const body = document.createElement('div');
  body.className = 'ctrl-section-body';

  header.addEventListener('click', () => section.classList.toggle('is-open'));

  bodyBuilder(body);
  section.appendChild(header);
  section.appendChild(body);
  return section;
}

// ─────────────────────────────────────────────────────────────────────────────
// Debounce helper — only used for expensive sliders (size, letterSpacing)
// ─────────────────────────────────────────────────────────────────────────────
function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// ─────────────────────────────────────────────────────────────────────────────
// Slider builder
// ─────────────────────────────────────────────────────────────────────────────
function makeSlider(label, min, max, value, step, onChange, unit = '') {
  const row = document.createElement('div');
  row.className = 'ctrl-row';

  const labelRow = document.createElement('div');
  labelRow.className = 'ctrl-label';

  const labelText = document.createElement('span');
  labelText.className = 'ctrl-label-text';
  labelText.textContent = label;

  const valueDisplay = document.createElement('span');
  valueDisplay.className = 'ctrl-label-value';
  // Derive decimal places from step magnitude so fine-grained steps (e.g. 0.001)
  // display correctly instead of always rounding to 1 decimal place.
  const decimals = Number.isInteger(step) ? 0 : Math.max(1, Math.ceil(-Math.log10(step)));
  const fmt = (v) => v.toFixed(decimals) + unit;
  valueDisplay.textContent = fmt(value);

  labelRow.appendChild(labelText);
  labelRow.appendChild(valueDisplay);

  const slider = document.createElement('input');
  slider.type = 'range';
  slider.className = 'filled';
  slider.min = min;
  slider.max = max;
  slider.step = step;
  slider.value = value;

  const updateFill = (v) => {
    const pct = ((v - min) / (max - min)) * 100;
    slider.style.setProperty('--fill-pct', pct + '%');
  };
  updateFill(value);

  slider.addEventListener('input', () => {
    const v = parseFloat(slider.value);
    valueDisplay.textContent = fmt(v);
    updateFill(v);
    onChange(v);
  });

  const setValue = (v) => {
    slider.value = v;
    valueDisplay.textContent = fmt(v);
    updateFill(v);
  };

  row.appendChild(labelRow);
  row.appendChild(slider);
  return { row, setValue };
}

// ─────────────────────────────────────────────────────────────────────────────
// Template param definitions — maps template id → array of control specs
// ─────────────────────────────────────────────────────────────────────────────
const TEMPLATE_PARAM_DEFS = {
  'ascii-grid': [
    { type: 'slider', key: 'cellSize',  label: 'Cell Size',  min: 8,     max: 32,   step: 1,     unit: 'px' },
    { type: 'select', key: 'charset',   label: 'Charset',    options: [
      { value: 'standard', label: 'Standard  (. : - = + *)' },
      { value: 'dense',    label: 'Dense  (i 1 t f L C G)' },
      { value: 'blocks',   label: 'Blocks  (░ ▒ ▓ █)' },
      { value: 'minimal',  label: 'Minimal  (. * #)' },
    ]},
  ],
  'halftone': [
    { type: 'slider', key: 'gridSize',  label: 'Grid Size',   min: 8,     max: 40,   step: 1,     unit: 'px' },
    { type: 'slider', key: 'scale',     label: 'Wave Scale',  min: 0.005, max: 0.03, step: 0.001 },
    { type: 'slider', key: 'contrast',  label: 'Contrast',    min: 0.5,   max: 3,    step: 0.1 },
  ],
  'tubing-text': [
    { type: 'slider', key: 'tubeRadius', label: 'Tube Radius',      min: 3,   max: 20, step: 1,   unit: 'px' },
    { type: 'slider', key: 'rotSpeed',   label: 'Rotation Speed',   min: 0.2, max: 3,  step: 0.1 },
    { type: 'toggle', key: 'bloom',      label: 'Bloom' },
    { type: 'select', key: 'colorMode',  label: 'Color Mode',       options: [
      { value: 'gradient',  label: 'Gradient' },
      { value: 'solid',     label: 'Solid' },
      { value: 'per-char',  label: 'Per Character' },
    ]},
  ],
  'dot-matrix': [
    { type: 'slider', key: 'cellSize',  label: 'Cell Size',   min: 4,   max: 12, step: 1,   unit: 'px' },
    { type: 'slider', key: 'dotRadius', label: 'Dot Radius',  min: 1,   max: 5,  step: 0.5, unit: 'px' },
  ],
  'neon-wireframe': [
    { type: 'slider', key: 'threshold',        label: 'Wire Length',       min: 6,  max: 30, step: 1,  unit: 'px' },
    { type: 'slider', key: 'scanlineSpacing',  label: 'Scanline Spacing',  min: 2,  max: 14, step: 1,  unit: 'px' },
  ],
  'pixel-rain': [
    { type: 'slider', key: 'fallDistance', label: 'Fall Distance', min: 0.1, max: 0.6, step: 0.05 },
    { type: 'slider', key: 'trailLength',  label: 'Trail Dots',    min: 0,   max: 3,   step: 1 },
  ],
};

// Module-level reference to the template params section body
let _templateParamsContainer = null;

// ─────────────────────────────────────────────────────────────────────────────
// Build (or rebuild) template param controls inside the given container
// ─────────────────────────────────────────────────────────────────────────────
function buildTemplateParamsBody(container, template) {
  container.innerHTML = '';

  const defs = template && template.params ? TEMPLATE_PARAM_DEFS[template.id] : null;

  if (!defs || defs.length === 0) {
    const note = document.createElement('div');
    note.className = 'export-note';
    note.textContent = 'No adjustable parameters for this template.';
    container.appendChild(note);
    return;
  }

  for (const def of defs) {
    const currentVal = template.params[def.key];

    if (def.type === 'slider') {
      const { row } = makeSlider(
        def.label,
        def.min, def.max,
        currentVal,
        def.step,
        (v) => { template.params[def.key] = v; },
        def.unit || '',
      );
      container.appendChild(row);

    } else if (def.type === 'select') {
      const row = document.createElement('div');
      row.className = 'ctrl-row';
      const lbl = document.createElement('div');
      lbl.className = 'ctrl-label';
      lbl.innerHTML = `<span class="ctrl-label-text">${def.label}</span>`;
      const sel = document.createElement('select');
      def.options.forEach(opt => {
        const o = document.createElement('option');
        o.value = opt.value;
        o.textContent = opt.label;
        if (opt.value === currentVal) o.selected = true;
        sel.appendChild(o);
      });
      sel.addEventListener('change', () => { template.params[def.key] = sel.value; });
      row.appendChild(lbl);
      row.appendChild(sel);
      container.appendChild(row);

    } else if (def.type === 'toggle') {
      const row = document.createElement('div');
      row.className = 'ctrl-row';
      const lbl = document.createElement('div');
      lbl.className = 'ctrl-label';
      lbl.innerHTML = `<span class="ctrl-label-text">${def.label}</span>`;
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = Boolean(currentVal);
      cb.style.cssText = 'width:auto; cursor:pointer; accent-color:#00ff88;';
      cb.addEventListener('change', () => { template.params[def.key] = cb.checked; });
      row.appendChild(lbl);
      row.appendChild(cb);
      container.appendChild(row);
    }
  }
}

/**
 * Update the template params section when the active template changes.
 * Safe to call before buildControls (no-op if panel not yet built).
 */
export function updateTemplateParams(template) {
  if (!_templateParamsContainer) return;
  buildTemplateParamsBody(_templateParamsContainer, template);
}

// ─────────────────────────────────────────────────────────────────────────────
// Main buildControls entry point
// ─────────────────────────────────────────────────────────────────────────────
export function buildControls(renderer, textLayer, effects, panelEl, appState) {
  if (!panelEl) { console.error('[AnimTypo] buildControls: panelEl is null — aborting'); return; }

  const {
    templates,
    palettes,
    applyTemplate,
    applyPalette,
    getPaletteById,
    getTransparentBg,
    setTransparentBg,
    getRenderer,
    getSnapshotRenderer,
    getCurrentPaletteId,
    audioEngine,
  } = appState;

  // Post-process overlays only (geometry/particles/neonPulse removed)
  const { glitch, noise, chromatic, scanlines } = effects;

  // Wordmark (editor panel — no template picker here, that's on the home page)
  const wordmark = document.createElement('div');
  wordmark.className = 'panel-wordmark';
  wordmark.innerHTML = '<span>Controls</span><span class="version">v0.4</span>';
  panelEl.appendChild(wordmark);

  // ── PALETTES ───────────────────────────────────────────────────
  let paletteChips = [];

  const syncPaletteSelection = (paletteId) => {
    paletteChips.forEach(({ chip, id }) => {
      chip.classList.toggle('is-active', id === paletteId);
    });
  };

  panelEl.appendChild(makeSection('Palettes', true, (body) => {
    const groups = [
      { label: 'Art / Artist', ids: ['bauhaus','mondrian','warhol','matisse','hokusai','klimt','vangogh','rothko'] },
      { label: 'Mood',         ids: ['cyberpunk','retro','aurora','desert','jungle','coral','lavender','autumn','spring','storm','vaporwave'] },
    ];

    groups.forEach(group => {
      const groupLabel = document.createElement('div');
      groupLabel.className = 'palette-group-label';
      groupLabel.textContent = group.label;
      body.appendChild(groupLabel);

      const swatchRow = document.createElement('div');
      swatchRow.className = 'palette-swatch-row';

      group.ids.forEach(pid => {
        const palette = palettes.find(p => p.id === pid);
        if (!palette) return;

        const chip = document.createElement('button');
        chip.className = 'palette-chip';
        chip.title = palette.name;
        chip.dataset.id = pid;
        chip.style.cssText = `background: ${palette.background}; border-color: ${palette.primary};`;

        const inner = document.createElement('span');
        inner.className = 'palette-chip-name';
        inner.textContent = palette.name;
        chip.appendChild(inner);

        chip.addEventListener('click', () => {
          applyPalette(pid);
          syncPaletteSelection(pid);
        });

        paletteChips.push({ chip, id: pid });
        swatchRow.appendChild(chip);
      });

      body.appendChild(swatchRow);
    });

    syncPaletteSelection(getCurrentPaletteId());
  }));

  // ── TEMPLATE PARAMS ──────────────────────────────────────────
  panelEl.appendChild(makeSection('Template', true, (body) => {
    _templateParamsContainer = body;
    // Will be populated by updateTemplateParams() once applyTemplate is called.
    const note = document.createElement('div');
    note.className = 'export-note';
    note.textContent = 'No adjustable parameters for this template.';
    body.appendChild(note);
  }));

  // ── TEXT SECTION ──────────────────────────────────────────────
  panelEl.appendChild(makeSection('Text', false, (body) => {
    const textRow = document.createElement('div');
    textRow.className = 'ctrl-row';
    const textarea = document.createElement('textarea');
    textarea.rows = 2;
    textarea.value = textLayer.text;
    textarea.spellcheck = false;
    textarea.placeholder = 'Type your text…';
    textarea.addEventListener('input', () => { textLayer.text = textarea.value || ' '; });
    textRow.appendChild(textarea);
    body.appendChild(textRow);

    // Font selector
    const fontRow = document.createElement('div');
    fontRow.className = 'ctrl-row';
    const fontLabel = document.createElement('div');
    fontLabel.className = 'ctrl-label';
    fontLabel.innerHTML = '<span class="ctrl-label-text">Font</span>';
    const fontSelect = document.createElement('select');
    [
      ['Space Grotesk', 'Space Grotesk'],
      ['Inter',         'Inter'],
      ['Courier New',   'Courier New'],
      ['Georgia',       'Georgia'],
      ['Impact',        'Impact'],
    ].forEach(([value, label]) => {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = label;
      if (value === textLayer.font) opt.selected = true;
      fontSelect.appendChild(opt);
    });
    fontSelect.addEventListener('change', () => { textLayer.font = fontSelect.value; });
    fontRow.appendChild(fontLabel);
    fontRow.appendChild(fontSelect);
    body.appendChild(fontRow);

    const { row: sizeRow } = makeSlider('Size', 20, 300, textLayer.size, 1,
      debounce((v) => { textLayer.size = v; }, 100), 'px');
    body.appendChild(sizeRow);

    const { row: lsRow } = makeSlider('Letter Spacing', 0, 80, textLayer.letterSpacing, 1,
      debounce((v) => { textLayer.letterSpacing = v; }, 100), 'px');
    body.appendChild(lsRow);
  }));

  // ── ANIMATION SECTION ─────────────────────────────────────────
  panelEl.appendChild(makeSection('Animation', false, (body) => {
    const { row: loopRow } = makeSlider('Loop Duration', 1, 10, renderer.loopDuration / 1000, 0.5, (v) => {
      renderer.loopDuration = v * 1000;
    }, 's');
    body.appendChild(loopRow);

    const fpsRow = document.createElement('div');
    fpsRow.className = 'ctrl-row';
    const fpsLabel = document.createElement('div');
    fpsLabel.className = 'ctrl-label';
    fpsLabel.innerHTML = '<span class="ctrl-label-text">Frame Rate</span>';
    const fpsVal = document.createElement('span');
    fpsVal.className = 'fps-display';
    fpsVal.textContent = '-- fps';
    fpsRow.appendChild(fpsLabel);
    fpsRow.appendChild(fpsVal);
    body.appendChild(fpsRow);

    _fpsInterval = setInterval(() => {
      fpsVal.textContent = renderer.fps + ' fps';
      const badge = document.getElementById('fps-badge');
      if (badge) badge.textContent = renderer.fps + ' fps';
    }, 500);
  }));

  // ── POST-PROCESS OVERLAYS (all default OFF) ───────────────────
  // Wrapped in a single parent section for visual grouping
  panelEl.appendChild(makeSection('Post-Process Overlays', false, (body) => {
    const hint = document.createElement('div');
    hint.className = 'export-note';
    hint.style.marginBottom = '10px';
    hint.textContent = 'Optional effects applied on top of the template. All off by default.';
    body.appendChild(hint);

    // ── Glitch ────────────────────────────────────────────────
    body.appendChild(makeSection('Glitch', false, (b) => {
      const { row: r1 } = makeSlider('Intensity',   0, 1,   glitch.params.intensity,  0.01, (v) => { glitch.params.intensity = v; });
      const { row: r2 } = makeSlider('Slice Count', 3, 20,  glitch.params.sliceCount, 1,    (v) => { glitch.params.sliceCount = v; });
      const { row: r3 } = makeSlider('Speed',       0.1, 3, glitch.params.speed,      0.1,  (v) => { glitch.params.speed = v; });
      b.appendChild(r1); b.appendChild(r2); b.appendChild(r3);
    }, { enabled: glitch.enabled, onToggle: (v) => { glitch.enabled = v; } }));

    // ── Wave Noise ────────────────────────────────────────────
    body.appendChild(makeSection('Wave Noise', false, (b) => {
      const { row: r1 } = makeSlider('Amplitude', 0, 50,  noise.params.amplitude, 1,   (v) => { noise.params.amplitude = v; }, 'px');
      const { row: r2 } = makeSlider('Frequency', 0.5, 5, noise.params.frequency, 0.1, (v) => { noise.params.frequency = v; });
      const { row: r3 } = makeSlider('Speed',     0.1, 2, noise.params.speed,     0.1, (v) => { noise.params.speed = v; });
      b.appendChild(r1); b.appendChild(r2); b.appendChild(r3);
    }, { enabled: noise.enabled, onToggle: (v) => { noise.enabled = v; } }));

    // ── Chromatic ─────────────────────────────────────────────
    body.appendChild(makeSection('Chromatic Aberration', false, (b) => {
      const { row: r1 } = makeSlider('Spread', 0, 20,  chromatic.params.spread, 0.5, (v) => { chromatic.params.spread = v; }, 'px');
      const { row: r2 } = makeSlider('Angle',  0, 360, chromatic.params.angle,  1,   (v) => { chromatic.params.angle = v; }, '°');
      const { row: r3 } = makeSlider('Speed',  0.1, 2, chromatic.params.speed,  0.1, (v) => { chromatic.params.speed = v; });
      b.appendChild(r1); b.appendChild(r2); b.appendChild(r3);
    }, { enabled: chromatic.enabled, onToggle: (v) => { chromatic.enabled = v; } }));

    // ── Scanlines ─────────────────────────────────────────────
    body.appendChild(makeSection('Scanlines', false, (b) => {
      const { row: r1 } = makeSlider('Line Height',   2, 8,   scanlines.params.lineHeight, 1,    (v) => { scanlines.params.lineHeight = v; }, 'px');
      const { row: r2 } = makeSlider('Opacity',       0, 0.8, scanlines.params.opacity,    0.01, (v) => { scanlines.params.opacity = v; });
      const { row: r3 } = makeSlider('Scroll Speed',  0, 1,   scanlines.params.speed,      0.01, (v) => { scanlines.params.speed = v; });
      b.appendChild(r1); b.appendChild(r2); b.appendChild(r3);
    }, { enabled: scanlines.enabled, onToggle: (v) => { scanlines.enabled = v; } }));
  }));

  // ── EXPORT ───────────────────────────────────────────────────
  panelEl.appendChild(makeSection('Export', false, (body) => {

    // Transparent BG toggle
    const bgRow = document.createElement('div');
    bgRow.className = 'ctrl-row';
    const bgLabel = document.createElement('div');
    bgLabel.className = 'ctrl-label';
    bgLabel.innerHTML = '<span class="ctrl-label-text">Transparent BG (Alpha)</span>';
    const bgToggle = document.createElement('input');
    bgToggle.type = 'checkbox';
    bgToggle.checked = getTransparentBg();
    bgToggle.style.cssText = 'width:auto; cursor:pointer; accent-color:#00ff88;';
    bgToggle.addEventListener('change', () => { setTransparentBg(bgToggle.checked); });
    bgRow.appendChild(bgLabel);
    bgRow.appendChild(bgToggle);
    body.appendChild(bgRow);

    // Resolution selector
    const resRow = document.createElement('div');
    resRow.className = 'ctrl-row';
    const resLabel = document.createElement('div');
    resLabel.className = 'ctrl-label';
    resLabel.innerHTML = '<span class="ctrl-label-text">Resolution</span>';
    const resSelect = document.createElement('select');
    EXPORT_PRESETS.forEach(preset => {
      const opt = document.createElement('option');
      opt.value = preset.id;
      opt.textContent = preset.label;
      resSelect.appendChild(opt);
    });
    resRow.appendChild(resLabel);
    resRow.appendChild(resSelect);
    body.appendChild(resRow);

    // Format selector
    const fmtRow = document.createElement('div');
    fmtRow.className = 'ctrl-row';
    const fmtLabel = document.createElement('div');
    fmtLabel.className = 'ctrl-label';
    fmtLabel.innerHTML = '<span class="ctrl-label-text">Format</span>';
    const fmtSelect = document.createElement('select');
    [
      ['webm',    'WebM VP9 + Alpha  (Chrome/Edge)'],
      ['png-zip', 'PNG Sequence ZIP  (universal)'],
      ['prores',  'ProRes 4444 → Luma Matte  (FCPX / Resolve)'],
      ['mp4',     'MP4 H.264  (universal, no alpha)'],
    ].forEach(([val, lbl]) => {
      const opt = document.createElement('option');
      opt.value = val;
      opt.textContent = lbl;
      fmtSelect.appendChild(opt);
    });
    fmtRow.appendChild(fmtLabel);
    fmtRow.appendChild(fmtSelect);
    body.appendChild(fmtRow);

    const fmtHint = document.createElement('div');
    fmtHint.className = 'export-note';

    const FORMAT_HINTS = {
      'webm':    'Alpha channel preserved. Plays natively in Chrome/Edge. Not supported in Safari or NLEs.',
      'png-zip': 'Lossless, universal. Import the PNG sequence into any NLE as a numbered image sequence.',
      'prores':  'Exports two files (RGB + alpha mask) in a ZIP. Use luma-matte compositing in FCPX or Resolve.',
      'mp4':     'H.264, no alpha. Best for web delivery or as a reference preview. Loads ffmpeg.wasm (~20 MB on first use).',
    };
    const updateHint = () => { fmtHint.textContent = FORMAT_HINTS[fmtSelect.value] || ''; };
    fmtSelect.addEventListener('change', updateHint);
    updateHint();
    body.appendChild(fmtHint);

    // Progress area
    const progressWrap = document.createElement('div');
    progressWrap.className = 'export-progress-wrap';
    progressWrap.style.display = 'none';

    const progressBar  = document.createElement('div');
    progressBar.className = 'export-progress-bar';
    const progressFill = document.createElement('div');
    progressFill.className = 'export-progress-fill';
    progressBar.appendChild(progressFill);

    const progressLabel = document.createElement('div');
    progressLabel.className = 'export-progress-label';
    progressLabel.textContent = 'Rendering…';

    const statusLine = document.createElement('div');
    statusLine.className = 'export-status-line';
    statusLine.style.cssText = 'font-size:10px; color:#888; margin-top:4px; min-height:14px;';

    progressWrap.appendChild(progressBar);
    progressWrap.appendChild(progressLabel);
    progressWrap.appendChild(statusLine);
    body.appendChild(progressWrap);

    // Export button
    const btn = document.createElement('button');
    btn.className = 'export-btn export-btn-active';
    btn.textContent = 'Export';
    body.appendChild(btn);

    btn.addEventListener('click', async () => {
      if (btn.disabled) return;

      const preset = EXPORT_PRESETS.find(p => p.id === resSelect.value) || EXPORT_PRESETS[0];
      const fmt    = fmtSelect.value;
      const r      = getRenderer();

      btn.disabled = true;
      btn.textContent = 'Working…';
      progressWrap.style.display = 'block';
      progressFill.style.width   = '0%';
      progressLabel.textContent  = 'Starting…';
      statusLine.textContent     = '';

      // Snapshot the render function at export-start time so template switches
      // during a long multi-second export don't corrupt frames mid-sequence.
      const renderFn = getSnapshotRenderer ? getSnapshotRenderer() : r.onFrame;

      try {
        const exporter = new Exporter(renderFn, {
          width:        preset.width,
          height:       preset.height,
          fps:          60,
          loopDuration: r.loopDuration,
          transparentBg: getTransparentBg(),
          onProgress: (pct) => {
            progressFill.style.width  = (pct * 100).toFixed(0) + '%';
            progressLabel.textContent = `${(pct * 100).toFixed(0)}%`;
          },
          onStatus: (msg) => {
            statusLine.textContent    = msg;
            progressLabel.textContent = msg;
          },
        });
        _currentExporter = exporter;

        if (fmt === 'png-zip')      { await exporter.exportPNGZip(); }
        else if (fmt === 'mp4')     { await exporter.exportMP4(); }
        else if (fmt === 'prores')  { await exporter.exportProResLuma(); }
        else                        { await exporter.exportWebM(); }

        _currentExporter = null;
        progressFill.style.width  = '100%';
        progressLabel.textContent = 'Done — file downloading.';
        statusLine.textContent    = '';
        btn.textContent  = 'Export';
        btn.disabled     = false;
        setTimeout(() => { progressWrap.style.display = 'none'; }, 4000);
      } catch (err) {
        _currentExporter = null;
        console.error('Export failed:', err);
        progressLabel.textContent = 'Export failed: ' + err.message;
        statusLine.textContent    = '';
        btn.textContent  = 'Export';
        btn.disabled     = false;
      }
    });
  }));

  // ── AUDIO PANEL ───────────────────────────────────────────────
  if (audioEngine) {
    buildAudioPanel(panelEl, audioEngine);
  }

  // Footer
  const footer = document.createElement('div');
  footer.className = 'panel-footer';
  footer.innerHTML = '<p class="panel-footer-text">AnimTypo · Kuuki Design</p>';
  panelEl.appendChild(footer);
}
