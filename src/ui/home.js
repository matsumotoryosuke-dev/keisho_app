/**
 * Home Page — two tabs: Templates | Saved
 *
 * Templates tab:
 *   - Filter pills: All | Text | Geometry
 *   - 3-4 column grid of cards with live mini-canvas previews (200x120)
 *   - Each card: preview canvas, name, category badge, click → editor
 *
 * Saved tab:
 *   - Grid of saved project cards with thumbnail, name, date, delete
 *   - Empty state if no saves
 */

import { navigate } from '../router.js';
import { loadSaves, deleteSave } from '../saves.js';
import { TEMPLATES } from '../engine/templates.js';
import { getPaletteById } from '../engine/palettes.js';
import { sampleGlyphPixels } from '../engine/glyphSampler.js';

// ── Mini-canvas preview runners ────────────────────────────────────────────
// Each card gets its own RAF. We use IntersectionObserver to pause off-screen.
//
// Glyph sampling strategy:
//   - All text templates share one cached glyphData sampled at 200×120 with
//     font size ~60px (proportional to mini-canvas height). Same text+font+size
//     → same pixel map every time, so one sample covers all text cards.
//   - Geometry templates pass null for glyphData — they never use it.
//   - We do NOT scale the canvas transform to a 1920×1080 space; instead we
//     call template.render() directly at 200×120 so point coords from the
//     glyphSampler already match the canvas size.

const MINI_W = 200;
const MINI_H = 120;
const MINI_FONT_SIZE = 60; // ~0.5 × MINI_H — keeps letters legible in the preview
const MINI_TEXT = 'text';
const MINI_FONT = 'Space Grotesk';
const MINI_LETTER_SPACING = 8;

// One cached glyph sample shared across all text-category previews
let _sharedGlyphData = null;

function getSharedGlyphData() {
  if (_sharedGlyphData) return _sharedGlyphData;
  // density=1 at mini size → keep every pixel (point count is tiny at 200×120)
  _sharedGlyphData = sampleGlyphPixels(
    MINI_TEXT,
    MINI_FONT,
    MINI_FONT_SIZE,
    MINI_LETTER_SPACING,
    MINI_W,
    MINI_H,
    1.0,
  );
  return _sharedGlyphData;
}

const _previewLoops = new Map(); // canvas → { start, stop, observer }

function startPreview(canvas, template) {
  if (_previewLoops.has(canvas)) return;

  const ctx = canvas.getContext('2d');
  if (!ctx) return; // bail gracefully if context limit hit
  let rafId = null;
  let running = false;
  let time = 0;
  let lastTs = null;
  const loopDuration = template.loopDuration || 4000;
  const palette = getPaletteById(template.defaultPalette || template.paletteId || 'cyberpunk');

  // Resolve glyphData:
  //   - geometry → null (never uses glyph data)
  //   - audio    → shared sample if template uses glyphs, else null
  //   - text     → shared sample
  const needsGlyphs = template.category !== 'geometry';
  const glyphData = needsGlyphs ? getSharedGlyphData() : null;

  // Zeroed audio data for home page previews (no audio loaded here)
  const noAudioData = {
    waveform:  null,
    frequency: null,
    bass:      0,
    mid:       0,
    treble:    0,
    amplitude: 0,
    hasAudio:  false,
  };

  function tick(ts) {
    if (!running) return;
    if (lastTs === null) lastTs = ts;
    const delta = ts - lastTs;
    lastTs = ts;
    time = (time + delta / loopDuration) % 1;

    const w = canvas.width;
    const h = canvas.height;

    // Background
    ctx.fillStyle = palette ? palette.background : '#000';
    ctx.fillRect(0, 0, w, h);

    // Render actual template animation at mini-canvas resolution.
    // Audio templates receive hasAudio:false so they use their fallback path.
    try {
      template.render(ctx, canvas, time, glyphData, palette, noAudioData);
    } catch (e) {
      // Swallow render errors so a broken template doesn't kill all previews
    }

    rafId = requestAnimationFrame(tick);
  }

  function start() {
    if (running) return;
    running = true;
    lastTs = null;
    rafId = requestAnimationFrame(tick);
  }

  function stop() {
    running = false;
    lastTs = null;
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
  }

  // IntersectionObserver for perf — only run RAF for cards in viewport
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) start(); else stop();
    }
  }, { threshold: 0.1 });
  observer.observe(canvas);

  _previewLoops.set(canvas, { start, stop, observer });
}

function stopAllPreviews() {
  for (const [canvas, loop] of _previewLoops) {
    loop.stop();
    loop.observer.disconnect();
  }
  _previewLoops.clear();
}

// ── Template card builder ──────────────────────────────────────────────────
function makeTemplateCard(template, onClick) {
  const card = document.createElement('div');
  card.className = 'home-template-card';
  card.dataset.category = template.category || 'text';

  // Mini canvas preview
  const canvasWrap = document.createElement('div');
  canvasWrap.className = 'home-card-preview';

  const canvas = document.createElement('canvas');
  canvas.width  = 200;
  canvas.height = 120;
  canvas.className = 'home-card-canvas';
  canvasWrap.appendChild(canvas);

  // Category badge
  const badge = document.createElement('span');
  badge.className = `home-card-badge home-card-badge--${template.category || 'text'}`;
  badge.textContent = (template.category || 'text').toUpperCase();
  canvasWrap.appendChild(badge);

  card.appendChild(canvasWrap);

  // Card footer
  const footer = document.createElement('div');
  footer.className = 'home-card-footer';

  const name = document.createElement('div');
  name.className = 'home-card-name';
  name.textContent = template.name;

  const desc = document.createElement('div');
  desc.className = 'home-card-desc';
  desc.textContent = template.description;

  footer.appendChild(name);
  footer.appendChild(desc);
  card.appendChild(footer);

  card.addEventListener('click', () => onClick(template));

  // Start preview after DOM insertion (caller must handle)
  card._startPreview = () => startPreview(canvas, template);

  return card;
}

// ── Saved project card builder ─────────────────────────────────────────────
function makeSavedCard(save, onOpen, onDelete) {
  const card = document.createElement('div');
  card.className = 'home-saved-card';
  card.dataset.id = save.id;

  // Thumbnail
  const thumb = document.createElement('div');
  thumb.className = 'home-saved-thumb';
  if (save.thumbnail) {
    const img = document.createElement('img');
    img.src = save.thumbnail;
    img.alt = save.name;
    thumb.appendChild(img);
  } else {
    thumb.innerHTML = '<span class="home-saved-thumb-empty">No preview</span>';
  }
  card.appendChild(thumb);

  // Card body
  const body = document.createElement('div');
  body.className = 'home-saved-body';

  const nameRow = document.createElement('div');
  nameRow.className = 'home-saved-name-row';

  const nameEl = document.createElement('div');
  nameEl.className = 'home-saved-name';
  nameEl.textContent = save.name;

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'home-saved-delete';
  deleteBtn.title = 'Delete project';
  deleteBtn.textContent = '×';
  deleteBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (confirm(`Delete "${save.name}"?`)) {
      onDelete(save.id);
    }
  });

  nameRow.appendChild(nameEl);
  nameRow.appendChild(deleteBtn);

  const meta = document.createElement('div');
  meta.className = 'home-saved-meta';
  const date = new Date(save.createdAt);
  meta.textContent = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

  body.appendChild(nameRow);
  body.appendChild(meta);
  card.appendChild(body);

  card.addEventListener('click', () => onOpen(save));

  return card;
}

// ── Build home page ────────────────────────────────────────────────────────
export function buildHome(containerEl) {
  stopAllPreviews(); // clean up observers + RAF loops from previous build

  // Always resample on each home build so the preview never shows stale
  // editor text (the glyphSampler has a single-entry cache that the editor
  // can overwrite while the user was on the editor page).
  _sharedGlyphData = sampleGlyphPixels(
    MINI_TEXT, MINI_FONT, MINI_FONT_SIZE, MINI_LETTER_SPACING,
    MINI_W, MINI_H, 1.0,
  );

  containerEl.innerHTML = '';

  // Header
  const header = document.createElement('div');
  header.className = 'home-header';
  header.innerHTML = `
    <div class="home-wordmark">
      <span class="home-logo">AnimTypo</span>
      <span class="home-version">v0.4</span>
    </div>
    <p class="home-tagline">Pick a template to start animating</p>
  `;
  containerEl.appendChild(header);

  // Tabs
  const tabBar = document.createElement('div');
  tabBar.className = 'home-tabs';

  const tabTemplates = document.createElement('button');
  tabTemplates.className = 'home-tab is-active';
  tabTemplates.textContent = 'Templates';

  const tabSaved = document.createElement('button');
  tabSaved.className = 'home-tab';
  tabSaved.textContent = 'Saved';

  tabBar.appendChild(tabTemplates);
  tabBar.appendChild(tabSaved);
  containerEl.appendChild(tabBar);

  // Tab content panels
  const panelTemplates = document.createElement('div');
  panelTemplates.className = 'home-panel';

  const panelSaved = document.createElement('div');
  panelSaved.className = 'home-panel';
  panelSaved.style.display = 'none';

  containerEl.appendChild(panelTemplates);
  containerEl.appendChild(panelSaved);

  // Tab switching
  function showTab(which) {
    if (which === 'templates') {
      tabTemplates.classList.add('is-active');
      tabSaved.classList.remove('is-active');
      panelTemplates.style.display = 'block';
      panelSaved.style.display = 'none';
    } else {
      tabSaved.classList.add('is-active');
      tabTemplates.classList.remove('is-active');
      panelSaved.style.display = 'block';
      panelTemplates.style.display = 'none';
      refreshSavedPanel(panelSaved);
    }
  }

  tabTemplates.addEventListener('click', () => showTab('templates'));
  tabSaved.addEventListener('click', () => showTab('saved'));

  // ── Templates panel ──────────────────────────────────────────────────────

  // Filter pills
  const filterBar = document.createElement('div');
  filterBar.className = 'home-filter-bar';

  let activeFilter = 'all';
  const filters = [
    { id: 'all', label: 'All' },
    { id: 'text', label: 'Text' },
    { id: 'geometry', label: 'Geometry' },
    { id: 'audio', label: 'Audio' },
  ];

  const pills = filters.map(f => {
    const pill = document.createElement('button');
    pill.className = 'home-filter-pill' + (f.id === 'all' ? ' is-active' : '');
    pill.textContent = f.label;
    pill.dataset.filter = f.id;
    pill.addEventListener('click', () => {
      activeFilter = f.id;
      filterBar.querySelectorAll('.home-filter-pill').forEach(p => {
        p.classList.toggle('is-active', p.dataset.filter === f.id);
      });
      // Show/hide cards
      templateGrid.querySelectorAll('.home-template-card').forEach(card => {
        const cat = card.dataset.category;
        card.style.display = (f.id === 'all' || cat === f.id) ? '' : 'none';
      });
    });
    filterBar.appendChild(pill);
    return pill;
  });

  panelTemplates.appendChild(filterBar);

  // Template grid
  const templateGrid = document.createElement('div');
  templateGrid.className = 'home-template-grid';

  TEMPLATES.forEach(tmpl => {
    const card = makeTemplateCard(tmpl, (t) => {
      stopAllPreviews();
      navigate(`#/editor?template=${t.id}`);
    });
    templateGrid.appendChild(card);
    // Kick off previews after appended
    requestAnimationFrame(() => card._startPreview());
  });

  panelTemplates.appendChild(templateGrid);

  // ── Saved panel ──────────────────────────────────────────────────────────
  refreshSavedPanel(panelSaved);
}

function refreshSavedPanel(panelEl) {
  panelEl.innerHTML = '';
  const saves = loadSaves();

  if (saves.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'home-empty-state';
    empty.innerHTML = `
      <div class="home-empty-icon">✦</div>
      <p class="home-empty-title">No saved projects yet</p>
      <p class="home-empty-sub">Create one from a template.</p>
    `;
    panelEl.appendChild(empty);
    return;
  }

  const grid = document.createElement('div');
  grid.className = 'home-saved-grid';

  saves.forEach(save => {
    const card = makeSavedCard(
      save,
      (s) => navigate(`#/editor?saved=${s.id}`),
      (id) => {
        deleteSave(id);
        refreshSavedPanel(panelEl);
      }
    );
    grid.appendChild(card);
  });

  panelEl.appendChild(grid);
}
