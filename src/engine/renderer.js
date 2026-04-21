/**
 * Renderer — owns the RAF loop, normalized loop time, and canvas sizing.
 * Canvas is always 1920×1080 internally. CSS scales it to fit the container.
 */
export class Renderer {
  constructor(canvasEl) {
    this.canvas = canvasEl;
    this.ctx = canvasEl.getContext('2d', { willReadFrequently: true });
    this.loopDuration = 3000; // ms per loop
    this.time = 0;           // normalized [0, 1]
    this.fps = 0;
    this.running = false;

    this.onFrame = null; // (time, ctx, canvas) => void

    this._rafId = null;
    this._lastTs = null;
    this._fpsAccum = 0;
    this._fpsFrames = 0;
    this._fpsTimer = 0;

    // Bind once in constructor so start() doesn't create a new function each call
    this._tick = this._tick.bind(this);

    // Fixed internal resolution
    this.canvas.width = 1920;
    this.canvas.height = 1080;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this._lastTs = null;
    this._rafId = requestAnimationFrame(this._tick);
  }

  stop() {
    this.running = false;
    if (this._rafId) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
    this._lastTs = null;
  }

  pause() {
    this.running = false;
    if (this._rafId) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
  }

  _tick(ts) {
    if (!this.running) return;

    if (this._lastTs === null) this._lastTs = ts;
    const delta = ts - this._lastTs;
    this._lastTs = ts;

    // Advance loop time
    this.time = (this.time + delta / this.loopDuration) % 1;

    // FPS tracking (rolling average over 30 frames)
    this._fpsFrames++;
    this._fpsTimer += delta;
    if (this._fpsTimer >= 500) {
      this.fps = Math.round((this._fpsFrames / this._fpsTimer) * 1000);
      this._fpsFrames = 0;
      this._fpsTimer = 0;
    }

    if (this.onFrame) {
      this.onFrame(this.time, this.ctx, this.canvas);
    }

    this._rafId = requestAnimationFrame(this._tick);
  }
}
