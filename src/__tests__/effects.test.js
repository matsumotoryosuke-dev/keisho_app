/**
 * effects.test.js
 *
 * Tests for post-process effect classes:
 *   GlitchEffect, NoiseEffect, ChromaticEffect, ScanlinesEffect
 *
 * Covers:
 *   - enabled = false early return (no canvas methods called)
 *   - zero-canvas guard (w === 0 || h === 0 returns without throwing)
 *   - normal render path (expected canvas methods are called)
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { GlitchEffect }    from '../engine/effects/glitch.js';
import { NoiseEffect }     from '../engine/effects/noise.js';
import { ChromaticEffect } from '../engine/effects/chromatic.js';
import { ScanlinesEffect } from '../engine/effects/scanlines.js';
import { makeMockCtx, makeMockCanvas } from './helpers/canvasMock.js';

// ── Browser API stubs ─────────────────────────────────────────────────────────
// jsdom does not implement OffscreenCanvas or ImageData. Stub both so effect
// code can run to completion in the test environment.

function makeOffscreenCanvasStub(w, h) {
  const ctx = makeMockCtx();
  return {
    width:      w,
    height:     h,
    getContext: () => ctx,
  };
}

// ImageData stub: just a plain object with data, width, height.
function ImageDataStub(dataOrWidth, widthOrHeight, height) {
  if (dataOrWidth instanceof Uint8ClampedArray) {
    this.data   = dataOrWidth;
    this.width  = widthOrHeight;
    this.height = height;
  } else {
    // ImageData(width, height) constructor
    const w = dataOrWidth;
    const h = widthOrHeight;
    this.data   = new Uint8ClampedArray(w * h * 4);
    this.width  = w;
    this.height = h;
  }
}

beforeEach(() => {
  vi.stubGlobal('OffscreenCanvas', function (w, h) {
    return makeOffscreenCanvasStub(w, h);
  });
  vi.stubGlobal('ImageData', ImageDataStub);
});

// ── enabled = false early-return ──────────────────────────────────────────────

describe('Effects — enabled = false early return', () => {
  it('GlitchEffect disabled — does not call getImageData', () => {
    const effect = new GlitchEffect();
    effect.enabled = false;
    const canvas = makeMockCanvas(1920, 1080);
    const ctx = makeMockCtx();
    effect.apply(ctx, canvas, 0.5);
    expect(ctx.getImageData).not.toHaveBeenCalled();
  });

  it('NoiseEffect disabled — does not call getImageData', () => {
    const effect = new NoiseEffect();
    effect.enabled = false;
    const canvas = makeMockCanvas(1920, 1080);
    const ctx = makeMockCtx();
    effect.apply(ctx, canvas, 0.5);
    expect(ctx.getImageData).not.toHaveBeenCalled();
  });

  it('ChromaticEffect disabled — does not call drawImage', () => {
    const effect = new ChromaticEffect();
    effect.enabled = false;
    const canvas = makeMockCanvas(1920, 1080);
    const ctx = makeMockCtx();
    effect.apply(ctx, canvas, 0.5);
    expect(ctx.drawImage).not.toHaveBeenCalled();
  });

  it('ScanlinesEffect disabled — does not call fillRect', () => {
    const effect = new ScanlinesEffect();
    effect.enabled = false;
    const canvas = makeMockCanvas(1920, 1080);
    const ctx = makeMockCtx();
    effect.apply(ctx, canvas, 0.5);
    expect(ctx.fillRect).not.toHaveBeenCalled();
  });
});

// ── zero canvas guard ─────────────────────────────────────────────────────────

describe('Effects — zero canvas guard', () => {
  it('GlitchEffect — does not throw on zero-width canvas', () => {
    const effect = new GlitchEffect();
    effect.enabled = true;
    const canvas = makeMockCanvas(0, 0);
    const ctx = makeMockCtx();
    expect(() => effect.apply(ctx, canvas, 0.5)).not.toThrow();
  });

  it('GlitchEffect — does not call getImageData on zero-width canvas', () => {
    const effect = new GlitchEffect();
    effect.enabled = true;
    const canvas = makeMockCanvas(0, 1080);
    const ctx = makeMockCtx();
    effect.apply(ctx, canvas, 0.5);
    expect(ctx.getImageData).not.toHaveBeenCalled();
  });

  it('NoiseEffect — does not throw on zero-height canvas', () => {
    const effect = new NoiseEffect();
    effect.enabled = true;
    const canvas = makeMockCanvas(1920, 0);
    const ctx = makeMockCtx();
    expect(() => effect.apply(ctx, canvas, 0.5)).not.toThrow();
  });

  it('NoiseEffect — does not call getImageData on zero-sized canvas', () => {
    const effect = new NoiseEffect();
    effect.enabled = true;
    const canvas = makeMockCanvas(0, 0);
    const ctx = makeMockCtx();
    effect.apply(ctx, canvas, 0.5);
    expect(ctx.getImageData).not.toHaveBeenCalled();
  });
});

// ── normal render ─────────────────────────────────────────────────────────────

describe('Effects — normal render', () => {
  it('GlitchEffect enabled with intensity > 0 — calls getImageData', () => {
    const effect = new GlitchEffect();
    effect.enabled = true;
    effect.params.intensity = 0.5;
    const canvas = makeMockCanvas(200, 100);
    const ctx = makeMockCtx();
    effect.apply(ctx, canvas, 0.5);
    expect(ctx.getImageData).toHaveBeenCalled();
  });

  it('GlitchEffect enabled — wraps in ctx.save / ctx.restore', () => {
    const effect = new GlitchEffect();
    effect.enabled = true;
    effect.params.intensity = 0.5;
    const canvas = makeMockCanvas(200, 100);
    const ctx = makeMockCtx();
    effect.apply(ctx, canvas, 0.5);
    // Outer save/restore pair added by the defensive wrapper
    expect(ctx.save).toHaveBeenCalled();
    expect(ctx.restore).toHaveBeenCalled();
  });

  it('ScanlinesEffect enabled with opacity > 0 — calls fillRect', () => {
    const effect = new ScanlinesEffect();
    effect.enabled = true;
    effect.params.opacity = 0.25;
    const canvas = makeMockCanvas(1920, 1080);
    const ctx = makeMockCtx();
    effect.apply(ctx, canvas, 0.5);
    expect(ctx.fillRect).toHaveBeenCalled();
  });

  it('NoiseEffect enabled with amplitude > 0 — calls getImageData and putImageData', () => {
    const effect = new NoiseEffect();
    effect.enabled = true;
    effect.params.amplitude = 18;
    const canvas = makeMockCanvas(10, 10);
    const ctx = makeMockCtx();
    effect.apply(ctx, canvas, 0.5);
    expect(ctx.getImageData).toHaveBeenCalled();
    expect(ctx.putImageData).toHaveBeenCalled();
  });
});
