/**
 * NoiseEffect — per-row horizontal wave displacement.
 * Each row of pixels is shifted by a sine wave that loops perfectly.
 */
export class NoiseEffect {
  constructor() {
    this.enabled = false;
    this.params = {
      amplitude: 18,   // 0–50 px
      frequency: 1.5,  // 0.5–5
      speed: 0.6,      // 0.1–2
    };
  }

  /**
   * Apply wave distortion in-place to ctx.
   * @param {CanvasRenderingContext2D} ctx
   * @param {HTMLCanvasElement} canvas
   * @param {number} time - normalized [0,1]
   */
  apply(ctx, canvas, time) {
    if (!this.enabled) return;

    const { amplitude, frequency, speed } = this.params;
    if (amplitude === 0) return;

    const w = canvas.width;
    const h = canvas.height;
    if (w === 0 || h === 0) return;
    const TAU = Math.PI * 2;

    // Read current pixel data
    const imageData = ctx.getImageData(0, 0, w, h);
    const src = imageData.data;
    const dst = new Uint8ClampedArray(src.length);

    const phase = time * speed * TAU;

    for (let y = 0; y < h; y++) {
      // Horizontal shift for this row — seamlessly looping
      const dx = Math.round(amplitude * Math.sin(y * frequency * 0.05 + phase));
      const srcRow = y * w * 4;

      for (let x = 0; x < w; x++) {
        const srcX = ((x - dx) % w + w) % w; // wrap around
        const srcPixel = srcRow + srcX * 4;
        const dstPixel = srcRow + x * 4;

        dst[dstPixel]     = src[srcPixel];
        dst[dstPixel + 1] = src[srcPixel + 1];
        dst[dstPixel + 2] = src[srcPixel + 2];
        dst[dstPixel + 3] = src[srcPixel + 3];
      }
    }

    // Write back
    const outData = new ImageData(dst, w, h);
    ctx.putImageData(outData, 0, 0);
  }
}
