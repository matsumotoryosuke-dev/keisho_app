/**
 * templates.test.js
 *
 * Tests the TEMPLATES array from src/engine/templates.js.
 *
 * Canvas context is mocked so render() functions can run without a real
 * browser rendering engine. OffscreenCanvas is not needed here because
 * render() does not call the sampler directly.
 *
 * Note: templates.js imports no other project modules (it's self-contained),
 * so no additional mocking of dependencies is required.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TEMPLATES, hexToRGB } from '../engine/templates.js';
import { makeMockCtx, makeMockCanvas } from './helpers/canvasMock.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

/** A valid palette object covering all fields templates might read */
const MOCK_PALETTE = {
  background: '#0d0d1a',
  primary:    '#ff006e',
  secondary:  '#00f5ff',
  accent:     '#ffbe0b',
  text:       '#ffffff',
};

/**
 * Empty glyphData — used for text templates when we want to exercise the
 * "nothing to draw" early-return path without crashing.
 */
const EMPTY_GLYPH_DATA = {
  allPoints: [],
  perChar:   [],
  totalBbox: { x: 0, y: 0, w: 0, h: 0 },
};

/**
 * Minimal glyphData with a couple of points — lets some text templates
 * pass their `length === 0` guards and actually execute render logic.
 */
function makeMinimalGlyphData(charCount = 2) {
  const perChar = Array.from({ length: charCount }, (_, i) => ({
    char:   String.fromCharCode(65 + i), // 'A', 'B', ...
    points: [{ x: 100 + i * 50, y: 200 }],
    bbox:   { x: 100 + i * 50, y: 160, w: 40, h: 80 },
  }));

  const allPoints = perChar.flatMap(c => c.points);

  return {
    allPoints,
    perChar,
    totalBbox: { x: 100, y: 160, w: charCount * 50, h: 80 },
  };
}

// ── Structural tests ──────────────────────────────────────────────────────────

describe('TEMPLATES array — structure', () => {
  it('contains exactly 29 templates', () => {
    expect(TEMPLATES).toHaveLength(29);
  });

  it('every template has required fields: id, name, category, render', () => {
    const required = ['id', 'name', 'category', 'render'];
    for (const tpl of TEMPLATES) {
      for (const field of required) {
        expect(tpl, `template "${tpl.id}" is missing field "${field}"`).toHaveProperty(field);
      }
    }
  });

  it('every template has a render function', () => {
    for (const tpl of TEMPLATES) {
      expect(typeof tpl.render, `template "${tpl.id}" render is not a function`).toBe('function');
    }
  });

  it('all template ids are unique', () => {
    const ids = TEMPLATES.map(t => t.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it('all template categories are either "text", "geometry", or "audio"', () => {
    const validCategories = new Set(['text', 'geometry', 'audio']);
    for (const tpl of TEMPLATES) {
      expect(
        validCategories.has(tpl.category),
        `template "${tpl.id}" has invalid category "${tpl.category}"`
      ).toBe(true);
    }
  });

  it('every template has loopDuration as a positive number', () => {
    for (const tpl of TEMPLATES) {
      expect(typeof tpl.loopDuration).toBe('number');
      expect(tpl.loopDuration).toBeGreaterThan(0);
    }
  });

  it('every template has a paletteId string', () => {
    for (const tpl of TEMPLATES) {
      expect(typeof tpl.paletteId).toBe('string');
      expect(tpl.paletteId.length).toBeGreaterThan(0);
    }
  });
});

// ── Render smoke tests ────────────────────────────────────────────────────────

describe('TEMPLATES — render() does not throw', () => {
  let ctx;
  let canvas;

  beforeEach(() => {
    ctx    = makeMockCtx();
    canvas = makeMockCanvas(1920, 1080);
  });

  const geometryTemplates = ['aurora-wave', 'voronoi-field', 'flow-field', 'kaleidoscope', 'concentric-pulse', 'fractal-noise', 'truchet-tiles', 'ascii-grid', 'halftone'];
  const textTemplates     = TEMPLATES.filter(t => t.category === 'text').map(t => t.id);

  it.each(geometryTemplates)(
    'geometry template "%s" — render(ctx, canvas, 0.5, null, palette) does not throw',
    (id) => {
      const tpl = TEMPLATES.find(t => t.id === id);
      expect(tpl).toBeDefined();
      expect(() => tpl.render(ctx, canvas, 0.5, null, MOCK_PALETTE)).not.toThrow();
    }
  );

  it.each(textTemplates)(
    'text template "%s" — render with empty glyphData does not throw',
    (id) => {
      const tpl = TEMPLATES.find(t => t.id === id);
      expect(tpl).toBeDefined();
      expect(() => tpl.render(ctx, canvas, 0.5, EMPTY_GLYPH_DATA, MOCK_PALETTE)).not.toThrow();
    }
  );

  it.each(textTemplates)(
    'text template "%s" — render with minimal glyphData does not throw',
    (id) => {
      const tpl = TEMPLATES.find(t => t.id === id);
      expect(tpl).toBeDefined();
      // Use 3 chars for a bit more coverage
      expect(() => tpl.render(ctx, canvas, 0.5, makeMinimalGlyphData(3), MOCK_PALETTE)).not.toThrow();
    }
  );

  it.each(textTemplates)(
    'text template "%s" — render at time=0 does not throw',
    (id) => {
      const tpl = TEMPLATES.find(t => t.id === id);
      expect(() => tpl.render(ctx, canvas, 0, makeMinimalGlyphData(2), MOCK_PALETTE)).not.toThrow();
    }
  );

  it.each(textTemplates)(
    'text template "%s" — render at time=0.99 does not throw',
    (id) => {
      const tpl = TEMPLATES.find(t => t.id === id);
      expect(() => tpl.render(ctx, canvas, 0.99, makeMinimalGlyphData(2), MOCK_PALETTE)).not.toThrow();
    }
  );

  it.each(geometryTemplates)(
    'geometry template "%s" — render at time=0 does not throw',
    (id) => {
      const tpl = TEMPLATES.find(t => t.id === id);
      expect(() => tpl.render(ctx, canvas, 0, null, MOCK_PALETTE)).not.toThrow();
    }
  );

  it.each(geometryTemplates)(
    'geometry template "%s" — render at time=0.99 does not throw',
    (id) => {
      const tpl = TEMPLATES.find(t => t.id === id);
      expect(() => tpl.render(ctx, canvas, 0.99, null, MOCK_PALETTE)).not.toThrow();
    }
  );

  it('every template renders without throw across 3 time steps with typical data', () => {
    const times = [0, 0.5, 1];
    for (const tpl of TEMPLATES) {
      const glyphData = tpl.category === 'text' ? makeMinimalGlyphData(4) : null;
      for (const t of times) {
        const freshCtx    = makeMockCtx();
        const freshCanvas = makeMockCanvas();
        expect(
          () => tpl.render(freshCtx, freshCanvas, t, glyphData, MOCK_PALETTE),
          `template "${tpl.id}" threw at time=${t}`
        ).not.toThrow();
      }
    }
  });
});

// ── hexToRGB — shorthand and fallback (P2-02) ─────────────────────────────────

describe('hexToRGB', () => {
  it('expands shorthand #fff to [255, 255, 255]', () => {
    expect(hexToRGB('#fff')).toEqual([255, 255, 255]);
  });

  it('expands shorthand #000 to [0, 0, 0]', () => {
    expect(hexToRGB('#000')).toEqual([0, 0, 0]);
  });

  it('expands shorthand #abc correctly', () => {
    // #abc → #aabbcc → r=170, g=187, b=204
    expect(hexToRGB('#abc')).toEqual([0xaa, 0xbb, 0xcc]);
  });

  it('parses full 6-char hex #ff0088 correctly', () => {
    expect(hexToRGB('#ff0088')).toEqual([255, 0, 136]);
  });

  it('returns [0,0,0] for an invalid hex like #XXYYZZ', () => {
    expect(hexToRGB('#XXYYZZ')).toEqual([0, 0, 0]);
  });

  it('returns [0,0,0] for a 4-char hex (not 3 or 6)', () => {
    expect(hexToRGB('#ffff')).toEqual([0, 0, 0]);
  });

  it('returns [0,0,0] for empty string after stripping #', () => {
    expect(hexToRGB('#')).toEqual([0, 0, 0]);
  });

  it('produces no NaN values for shorthand hex', () => {
    const [r, g, b] = hexToRGB('#fff');
    expect(Number.isNaN(r)).toBe(false);
    expect(Number.isNaN(g)).toBe(false);
    expect(Number.isNaN(b)).toBe(false);
  });
});

// ── charOrbit with 8-char text does not throw ─────────────────────────────────

describe('charOrbit — large text', () => {
  it('render does not throw with 8-character glyphData', () => {
    const tpl = TEMPLATES.find(t => t.id === 'char-orbit');
    expect(tpl).toBeDefined();
    const ctx    = makeMockCtx();
    const canvas = makeMockCanvas(1920, 1080);
    // 8 characters with bboxes
    const glyphData = makeMinimalGlyphData(8);
    expect(() => tpl.render(ctx, canvas, 0.5, glyphData, MOCK_PALETTE)).not.toThrow();
  });
});

// ── Audio templates have category: 'audio' ────────────────────────────────────

describe('TEMPLATES — audio category', () => {
  const AUDIO_TEMPLATE_IDS = [
    'frequency-bars',
    'oscilloscope',
    'bass-pulse-text',
    'frequency-rings',
    'waveform-typography',
  ];

  it('all 5 audio templates have category "audio"', () => {
    const audioTemplates = TEMPLATES.filter(t => AUDIO_TEMPLATE_IDS.includes(t.id));
    expect(audioTemplates).toHaveLength(AUDIO_TEMPLATE_IDS.length);
    for (const tpl of audioTemplates) {
      expect(tpl.category, `template "${tpl.id}" should have category "audio"`).toBe('audio');
    }
  });

  it('all 5 audio templates have a render function', () => {
    const audioTemplates = TEMPLATES.filter(t => AUDIO_TEMPLATE_IDS.includes(t.id));
    for (const tpl of audioTemplates) {
      expect(typeof tpl.render, `template "${tpl.id}" render is not a function`).toBe('function');
    }
  });
});

// ── Template params structural tests ─────────────────────────────────────────

describe('TEMPLATES — params objects', () => {
  // All templates that should expose adjustable params
  const PARAM_TEMPLATES = [
    { id: 'ascii-grid',     keys: ['cellSize', 'charset'] },
    { id: 'halftone',       keys: ['gridSize', 'scale', 'contrast'] },
    { id: 'tubing-text',    keys: ['tubeRadius', 'rotSpeed', 'bloom', 'colorMode'] },
    { id: 'dot-matrix',     keys: ['cellSize', 'dotRadius'] },
    { id: 'neon-wireframe', keys: ['threshold', 'scanlineSpacing'] },
    { id: 'pixel-rain',     keys: ['fallDistance', 'trailLength'] },
  ];

  it.each(PARAM_TEMPLATES)(
    'template "$id" has a params object with expected keys',
    ({ id, keys }) => {
      const tpl = TEMPLATES.find(t => t.id === id);
      expect(tpl, `template "${id}" not found`).toBeDefined();
      expect(tpl.params, `template "${id}" missing params`).toBeDefined();
      expect(typeof tpl.params).toBe('object');
      for (const key of keys) {
        expect(tpl.params, `template "${id}" params missing key "${key}"`).toHaveProperty(key);
      }
    }
  );

  it.each(PARAM_TEMPLATES)(
    'template "$id" render with mutated params does not throw',
    ({ id }) => {
      const tpl = TEMPLATES.find(t => t.id === id);
      const ctx    = makeMockCtx();
      const canvas = makeMockCanvas(1920, 1080);
      const glyph  = tpl.category === 'text' ? makeMinimalGlyphData(3) : null;
      // Save original params, mutate, render, restore
      const origParams = { ...tpl.params };
      // Set all numeric params to their minimum safe value to exercise edge paths
      Object.keys(tpl.params).forEach(k => {
        if (typeof tpl.params[k] === 'number') tpl.params[k] = 1;
        if (typeof tpl.params[k] === 'boolean') tpl.params[k] = false;
      });
      expect(() => tpl.render(ctx, canvas, 0.5, glyph, MOCK_PALETTE)).not.toThrow();
      // Restore
      Object.assign(tpl.params, origParams);
    }
  );
});

// ── Calling render twice is idempotent (no crash on second call) ──────────────

describe('TEMPLATES — render() is re-entrant', () => {
  it('calling render twice on a text template with the same data does not throw', () => {
    const tpl = TEMPLATES.find(t => t.id === 'particle-field');
    const ctx = makeMockCtx();
    const canvas = makeMockCanvas();
    const glyph = makeMinimalGlyphData(3);
    expect(() => {
      tpl.render(ctx, canvas, 0.3, glyph, MOCK_PALETTE);
      tpl.render(ctx, canvas, 0.6, glyph, MOCK_PALETTE);
    }).not.toThrow();
  });

  it('calling render twice on a geometry template does not throw', () => {
    const tpl = TEMPLATES.find(t => t.id === 'aurora-wave');
    const ctx = makeMockCtx();
    const canvas = makeMockCanvas();
    expect(() => {
      tpl.render(ctx, canvas, 0.1, null, MOCK_PALETTE);
      tpl.render(ctx, canvas, 0.6, null, MOCK_PALETTE);
    }).not.toThrow();
  });
});
