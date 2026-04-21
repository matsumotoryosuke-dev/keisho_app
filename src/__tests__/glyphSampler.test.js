/**
 * glyphSampler.test.js
 *
 * OffscreenCanvas does not exist in jsdom, so we mock it globally before
 * importing the module. The mock context returns all-opaque pixels
 * (alpha=255) by default, which means the sampler WILL find "opaque" pixels
 * and build allPoints. However, the pixel loop runs over (canvasW * canvasH)
 * pixels which would be enormous at 1920x1080. We use a tiny canvas size in
 * tests (e.g. 40x20) to keep runtime fast.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';

// ── OffscreenCanvas mock ──────────────────────────────────────────────────────
// Must be set on `global` BEFORE the module is imported.
function makeOffscreenCanvasMock() {
  return class MockOffscreenCanvas {
    constructor(w, h) {
      this.width  = w;
      this.height = h;
    }

    getContext() {
      return {
        clearRect:    vi.fn(),
        fillRect:     vi.fn(),
        fillText:     vi.fn(),
        // measureText: each character → 8px wide (deterministic)
        measureText:  vi.fn((ch) => ({ width: 8 })),
        // getImageData: returns ALL pixels opaque (alpha=255, white)
        getImageData: vi.fn((x, y, w, h) => ({
          data: new Uint8ClampedArray(w * h * 4).fill(255),
          width: w,
          height: h,
        })),
        font:         '',
        fillStyle:    '',
        textBaseline: '',
        textAlign:    '',
      };
    }
  };
}

// Register mock BEFORE module import
global.OffscreenCanvas = makeOffscreenCanvasMock();

// Now import the module under test
import { sampleGlyphPixels, invalidateGlyphCache } from '../engine/glyphSampler.js';

// Small canvas size to keep tests fast
const W = 40;
const H = 20;

// Helper: call with fixed args
function sample(text = 'AB', density = 1.0) {
  return sampleGlyphPixels(text, 'TestFont', 12, 2, W, H, density);
}

describe('sampleGlyphPixels — return shape', () => {
  beforeAll(() => {
    // Start with a clean cache
    invalidateGlyphCache();
  });

  it('returns an object with allPoints, perChar, and totalBbox', () => {
    const result = sample('HI');
    expect(result).toHaveProperty('allPoints');
    expect(result).toHaveProperty('perChar');
    expect(result).toHaveProperty('totalBbox');
  });

  it('allPoints is an array', () => {
    const { allPoints } = sample('AB');
    expect(Array.isArray(allPoints)).toBe(true);
  });

  it('allPoints contains {x, y} objects when pixels are opaque', () => {
    // Our mock fills every pixel with alpha=255, so allPoints should be non-empty
    const { allPoints } = sample('X', 1.0);
    expect(allPoints.length).toBeGreaterThan(0);
    expect(allPoints[0]).toHaveProperty('x');
    expect(allPoints[0]).toHaveProperty('y');
  });

  it('perChar length matches the number of characters in the text', () => {
    const text = 'HELLO';
    const { perChar } = sample(text);
    expect(perChar).toHaveLength(text.length);
  });

  it('perChar length for multi-line text matches total character count', () => {
    const text = 'AB\nCD';
    const { perChar } = sample(text);
    // 'AB\nCD' split by chars: A, B, \n, C, D — but computeCharLayout splits
    // by line and then by char within the line, so \n itself is NOT added.
    // It splits lines: ['AB', 'CD'] → A, B, C, D = 4 chars in layout
    expect(perChar).toHaveLength(4);
  });

  it('totalBbox has x, y, w, h properties', () => {
    const { totalBbox } = sample('T');
    expect(totalBbox).toHaveProperty('x');
    expect(totalBbox).toHaveProperty('y');
    expect(totalBbox).toHaveProperty('w');
    expect(totalBbox).toHaveProperty('h');
  });

  it('totalBbox dimensions are non-negative numbers', () => {
    const { totalBbox } = sample('A');
    expect(totalBbox.w).toBeGreaterThanOrEqual(0);
    expect(totalBbox.h).toBeGreaterThanOrEqual(0);
  });
});

describe('sampleGlyphPixels — caching', () => {
  it('returns the same object reference on identical calls (cache hit)', () => {
    invalidateGlyphCache();
    const result1 = sampleGlyphPixels('CACHE', 'Font', 14, 0, W, H, 0.5);
    const result2 = sampleGlyphPixels('CACHE', 'Font', 14, 0, W, H, 0.5);
    expect(result1).toBe(result2); // strict reference equality
  });

  it('returns a different object when text changes (cache miss)', () => {
    invalidateGlyphCache();
    const result1 = sampleGlyphPixels('AAA', 'Font', 14, 0, W, H, 0.5);
    const result2 = sampleGlyphPixels('BBB', 'Font', 14, 0, W, H, 0.5);
    expect(result1).not.toBe(result2);
  });

  it('returns a different object when fontSize changes (cache miss)', () => {
    invalidateGlyphCache();
    const result1 = sampleGlyphPixels('TEXT', 'Font', 12, 0, W, H, 0.5);
    const result2 = sampleGlyphPixels('TEXT', 'Font', 16, 0, W, H, 0.5);
    expect(result1).not.toBe(result2);
  });

  it('returns a different object when font family changes (cache miss)', () => {
    invalidateGlyphCache();
    const result1 = sampleGlyphPixels('TEXT', 'FontA', 12, 0, W, H, 0.5);
    const result2 = sampleGlyphPixels('TEXT', 'FontB', 12, 0, W, H, 0.5);
    expect(result1).not.toBe(result2);
  });

  it('returns a different object when letterSpacing changes (cache miss)', () => {
    invalidateGlyphCache();
    const result1 = sampleGlyphPixels('TEXT', 'Font', 12, 0, W, H, 0.5);
    const result2 = sampleGlyphPixels('TEXT', 'Font', 12, 8, W, H, 0.5);
    expect(result1).not.toBe(result2);
  });

  it('invalidateGlyphCache forces a fresh sample on next call', () => {
    const r1 = sampleGlyphPixels('HELLO', 'Font', 12, 0, W, H, 0.5);
    invalidateGlyphCache();
    const r2 = sampleGlyphPixels('HELLO', 'Font', 12, 0, W, H, 0.5);
    // After invalidation, a new object is created even with same args
    expect(r1).not.toBe(r2);
  });
});

describe('sampleGlyphPixels — density / subsampling', () => {
  it('density=1.0 keeps all opaque pixels (step=1)', () => {
    invalidateGlyphCache();
    const { allPoints: all } = sampleGlyphPixels('A', 'Font', 12, 0, W, H, 1.0);
    // All W*H pixels are opaque in our mock; step=max(1,round(1/1.0))=1
    // pixelIdx % 1 === 0 always → every pixel kept
    expect(all.length).toBe(W * H);
  });

  it('density=0.5 keeps approximately half the pixels (step=2)', () => {
    invalidateGlyphCache();
    const { allPoints: all } = sampleGlyphPixels('A', 'Font', 12, 0, W, H, 0.5);
    // step=max(1,round(1/0.5))=2; pixelIdx % 2 === 0 → every other pixel
    // pixelIdx starts at 0, increments only for opaque. With all opaque:
    // pixels 1,2,...W*H → pixelIdx 1..800. Keep when pixelIdx%2===0 → 400 kept
    expect(all.length).toBe(Math.floor(W * H / 2));
  });
});

describe('sampleGlyphPixels — empty allPoints fallback bbox', () => {
  it('returns totalBbox {x:0, y:0, w:canvasW, h:canvasH} when all pixels are transparent', () => {
    // Override OffscreenCanvas mock to return all-transparent pixels (alpha=0).
    // Use a unique canvas size (99x77) so the sampler's internal offscreen-canvas
    // cache is forced to reinitialize with this transparent-returning context,
    // rather than reusing the opaque-pixel context set up by earlier tests.
    const origOffscreenCanvas = global.OffscreenCanvas;
    global.OffscreenCanvas = class MockTransparentOffscreenCanvas {
      constructor(w, h) {
        this.width  = w;
        this.height = h;
      }
      getContext() {
        return {
          clearRect:    vi.fn(),
          fillRect:     vi.fn(),
          fillText:     vi.fn(),
          measureText:  vi.fn((ch) => ({ width: 8 })),
          // All pixels transparent (alpha=0)
          getImageData: vi.fn((x, y, w, h) => ({
            data: new Uint8ClampedArray(w * h * 4), // all zeros → alpha=0
            width: w,
            height: h,
          })),
          font:         '',
          fillStyle:    '',
          textBaseline: '',
          textAlign:    '',
        };
      }
    };

    invalidateGlyphCache();
    // Use a unique canvas size so ensureOffscreen creates a fresh context
    const canvasW = 99;
    const canvasH = 77;
    const { allPoints, totalBbox } = sampleGlyphPixels('AB', 'TestFont', 12, 2, canvasW, canvasH, 1.0);

    expect(allPoints).toHaveLength(0);
    expect(totalBbox).toEqual({ x: 0, y: 0, w: canvasW, h: canvasH });

    // Restore
    global.OffscreenCanvas = origOffscreenCanvas;
    invalidateGlyphCache();
  });
});

describe('sampleGlyphPixels — density in cache key (P2-05)', () => {
  it('same args + same density returns the exact same cached object reference', () => {
    invalidateGlyphCache();
    const r1 = sampleGlyphPixels('LOOP', 'Font', 14, 2, W, H, 0.25);
    const r2 = sampleGlyphPixels('LOOP', 'Font', 14, 2, W, H, 0.25);
    expect(r1).toBe(r2); // strict reference equality — cache hit
  });

  it('changing density from 0.25 to 0.35 (same text/font/size) returns a NEW object', () => {
    invalidateGlyphCache();
    const r1 = sampleGlyphPixels('LOOP', 'Font', 14, 2, W, H, 0.25);
    const r2 = sampleGlyphPixels('LOOP', 'Font', 14, 2, W, H, 0.35);
    expect(r1).not.toBe(r2); // different density → cache miss → new object
  });

  it('changing density from 0.15 to 0.25 returns a NEW object', () => {
    invalidateGlyphCache();
    const r1 = sampleGlyphPixels('TEXT', 'Font', 12, 0, W, H, 0.15);
    const r2 = sampleGlyphPixels('TEXT', 'Font', 12, 0, W, H, 0.25);
    expect(r1).not.toBe(r2);
  });
});
