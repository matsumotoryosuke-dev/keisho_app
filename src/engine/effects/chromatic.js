/**
 * ChromaticEffect — RGB channel split (chromatic aberration).
 * Draws the canvas content three times with R/G/B channel isolation
 * and animated positional offsets.
 */
export class ChromaticEffect {
  constructor() {
    this.enabled = false;
    this.transparentBg = false;
    this.params = {
      spread: 4,    // 0–20 px
      angle: 0,     // 0–360 degrees
      speed: 0.8,   // 0.1–2
    };
    // Cached offscreen buffers — created once per canvas size
    this._offscreen = null;
    this._rOff = null;
    this._gOff = null;
    this._bOff = null;
    this._cachedW = 0;
    this._cachedH = 0;
  }

  _ensureBuffers(w, h) {
    if (this._cachedW !== w || this._cachedH !== h) {
      this._offscreen = new OffscreenCanvas(w, h);
      this._rOff = new OffscreenCanvas(w, h);
      this._gOff = new OffscreenCanvas(w, h);
      this._bOff = new OffscreenCanvas(w, h);
      this._cachedW = w;
      this._cachedH = h;
    }
    return {
      offscreen: this._offscreen,
      rOff: this._rOff,
      gOff: this._gOff,
      bOff: this._bOff,
    };
  }

  _ensureOffscreen(w, h) {
    this._ensureBuffers(w, h);
    return this._offscreen;
  }

  /**
   * Apply chromatic aberration in-place.
   * @param {CanvasRenderingContext2D} ctx
   * @param {HTMLCanvasElement} canvas
   * @param {number} time - normalized [0,1]
   */
  apply(ctx, canvas, time) {
    if (!this.enabled) return;

    const { spread, angle, speed } = this.params;
    if (spread === 0) return;

    const w = canvas.width;
    const h = canvas.height;
    const TAU = Math.PI * 2;

    // Animate spread with a pulsing factor
    const pulse = Math.sin(time * speed * TAU);
    const currentSpread = spread * (0.7 + 0.3 * pulse);

    const angleRad = (angle * Math.PI) / 180;
    const dx = Math.cos(angleRad) * currentSpread;
    const dy = Math.sin(angleRad) * currentSpread;

    // Snapshot current canvas
    const offscreen = this._ensureOffscreen(w, h);
    const offCtx = offscreen.getContext('2d');
    offCtx.clearRect(0, 0, w, h);
    offCtx.drawImage(canvas, 0, 0);

    // Clear the main canvas
    ctx.clearRect(0, 0, w, h);

    // Draw black background only when not using transparent BG
    if (!this.transparentBg) {
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, w, h);
    }

    // Pixel-level channel split
    const imgData = offCtx.getImageData(0, 0, w, h);
    const orig = imgData.data;

    // Create three channel images
    const rData = new Uint8ClampedArray(orig.length);
    const gData = new Uint8ClampedArray(orig.length);
    const bData = new Uint8ClampedArray(orig.length);

    for (let i = 0; i < orig.length; i += 4) {
      // R channel
      rData[i]     = orig[i];
      rData[i + 1] = 0;
      rData[i + 2] = 0;
      rData[i + 3] = orig[i + 3];

      // G channel
      gData[i]     = 0;
      gData[i + 1] = orig[i + 1];
      gData[i + 2] = 0;
      gData[i + 3] = orig[i + 3];

      // B channel
      bData[i]     = 0;
      bData[i + 1] = 0;
      bData[i + 2] = orig[i + 2];
      bData[i + 3] = orig[i + 3];
    }

    // Write each channel to cached offscreen buffers
    const { rOff, gOff, bOff } = this._ensureBuffers(w, h);

    rOff.getContext('2d').putImageData(new ImageData(rData, w, h), 0, 0);
    gOff.getContext('2d').putImageData(new ImageData(gData, w, h), 0, 0);
    bOff.getContext('2d').putImageData(new ImageData(bData, w, h), 0, 0);

    // Composite: R shifted +dx/+dy, G centered, B shifted -dx/-dy
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.drawImage(rOff, dx, dy);
    ctx.drawImage(gOff, 0, 0);
    ctx.drawImage(bOff, -dx, -dy);
    ctx.restore();
  }
}
