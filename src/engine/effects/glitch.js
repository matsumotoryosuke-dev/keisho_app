/**
 * GlitchEffect — digital glitch slice effect.
 * Slices the canvas horizontally and offsets strips by a time-deterministic amount.
 * Uses seeded pseudo-random so the loop is perfectly seamless.
 */
export class GlitchEffect {
  constructor() {
    this.enabled = false;
    this.params = {
      intensity: 0.5,   // 0–1
      sliceCount: 8,    // 3–20
      speed: 1.2,       // 0.1–3
    };
  }

  /**
   * Simple seeded LCG pseudo-random (deterministic per seed).
   */
  _rand(seed) {
    const x = Math.sin(seed + 1) * 43758.5453123;
    return x - Math.floor(x);
  }

  /**
   * Apply glitch slices in-place to ctx.
   * @param {CanvasRenderingContext2D} ctx
   * @param {HTMLCanvasElement} canvas
   * @param {number} time - normalized [0,1]
   */
  apply(ctx, canvas, time) {
    if (!this.enabled) return;

    const { intensity, sliceCount, speed } = this.params;
    if (intensity === 0) return;

    const w = canvas.width;
    const h = canvas.height;
    if (w === 0 || h === 0) return;

    ctx.save();
    const maxOffset = 80 * intensity;
    const TAU = Math.PI * 2;

    // Snapshot current canvas state for reading slices
    const snapshot = ctx.getImageData(0, 0, w, h);

    // Generate slice positions deterministically based on a slow-changing seed
    // The seed changes slowly so slices jump occasionally but smoothly loop
    const sliceSeed = Math.floor(time * speed * 7) * 0.137;

    for (let i = 0; i < Math.floor(sliceCount); i++) {
      // Deterministic y position for this slice
      const sliceY = Math.floor(this._rand(i * 3.7 + sliceSeed) * (h - 20));
      const sliceH = Math.floor(this._rand(i * 5.1 + sliceSeed) * 12 + 2); // 2–14px

      // Offset: smoothly animated, loops seamlessly
      const phase = i * 0.7 + sliceSeed * 0.3;
      const offset = Math.round(maxOffset * Math.sin(time * speed * TAU + phase));

      if (offset === 0) continue;

      // Extract the slice from snapshot
      const sliceData = ctx.createImageData(w, sliceH);
      const srcOffset = sliceY * w * 4;
      const srcEnd = Math.min(srcOffset + sliceH * w * 4, snapshot.data.length);
      const copyLen = srcEnd - srcOffset;
      sliceData.data.set(snapshot.data.subarray(srcOffset, srcOffset + copyLen));

      // Put it back shifted horizontally (wrap around)
      // We re-draw to a temp canvas then blit with offset
      ctx.save();
      ctx.globalCompositeOperation = 'source-over';

      // Temporarily put slice data to read from
      const tempCanvas = new OffscreenCanvas(w, sliceH);
      const tempCtx = tempCanvas.getContext('2d');
      tempCtx.putImageData(sliceData, 0, 0);

      // Draw shifted
      ctx.clearRect(0, sliceY, w, sliceH);
      ctx.drawImage(tempCanvas, offset, sliceY);
      // Also draw wrap-around portion
      if (offset > 0) {
        ctx.drawImage(tempCanvas, offset - w, sliceY);
      } else {
        ctx.drawImage(tempCanvas, offset + w, sliceY);
      }

      // Occasionally invert a slice based on intensity
      if (this._rand(i * 2.3 + sliceSeed) < intensity * 0.3) {
        ctx.globalCompositeOperation = 'difference';
        ctx.fillStyle = 'rgba(255,255,255,0.8)';
        ctx.fillRect(0, sliceY, w, sliceH);
      }

      ctx.restore();
    }

    ctx.restore();
  }
}
