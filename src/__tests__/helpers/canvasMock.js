/**
 * canvasMock.js — shared Canvas 2D context mock for Vitest tests.
 *
 * jsdom does not implement Canvas 2D, so every ctx method would throw or
 * be undefined. These mocks let template render() functions run to completion
 * without errors, while remaining inspectable via vi.fn().
 */

/**
 * Returns a fresh mock CanvasRenderingContext2D-compatible object.
 * All drawing methods are vi.fn() stubs. Stateful properties
 * (globalAlpha, fillStyle, etc.) are simple assignable values.
 */
export function makeMockCtx() {
  const ctx = {
    // ── State properties ───────────────────────────────────────
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    fillStyle: '#000000',
    strokeStyle: '#000000',
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    font: '10px sans-serif',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    filter: 'none',

    // ── Drawing methods ────────────────────────────────────────
    save: vi.fn(),
    restore: vi.fn(),
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    beginPath: vi.fn(),
    closePath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    fillText: vi.fn(),
    strokeText: vi.fn(),
    translate: vi.fn(),
    scale: vi.fn(),
    rotate: vi.fn(),
    setTransform: vi.fn(),
    resetTransform: vi.fn(),
    drawImage: vi.fn(),

    // measureText returns an object with a width property
    measureText: vi.fn((text) => ({ width: text.length * 10 })),

    // createRadialGradient returns a minimal gradient stub
    createRadialGradient: vi.fn(() => ({
      addColorStop: vi.fn(),
    })),

    // createLinearGradient returns a minimal gradient stub
    createLinearGradient: vi.fn(() => ({
      addColorStop: vi.fn(),
    })),

    // getImageData — returns a blank (transparent) image
    getImageData: vi.fn((x, y, w, h) => ({
      data: new Uint8ClampedArray(w * h * 4), // all zeros (transparent)
      width: w,
      height: h,
    })),

    putImageData: vi.fn(),

    // createImageData — returns a blank ImageData-like object
    createImageData: vi.fn((w, h) => ({
      data: new Uint8ClampedArray(w * h * 4),
      width: w,
      height: h,
    })),

    // rect — path building (used by some templates)
    rect: vi.fn(),
    clip: vi.fn(),

    // ellipse — used by tubing-text and other templates
    ellipse: vi.fn(),
  };

  return ctx;
}

/**
 * Returns a minimal mock canvas element.
 * @param {number} [w=1920]
 * @param {number} [h=1080]
 */
export function makeMockCanvas(w = 1920, h = 1080) {
  return {
    width: w,
    height: h,
    getContext: vi.fn(() => makeMockCtx()),
    toDataURL: vi.fn(() => 'data:image/png;base64,MOCK'),
    style: {},
  };
}
