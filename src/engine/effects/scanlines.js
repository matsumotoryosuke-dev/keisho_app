/**
 * ScanlinesEffect — CRT scanline overlay.
 * Alternating semi-transparent dark strips. Optional scrolling.
 */
export class ScanlinesEffect {
  constructor() {
    this.enabled = false;
    this.params = {
      lineHeight: 3,   // 2–8 px
      opacity: 0.25,   // 0–0.8
      speed: 0,        // 0–1 (0 = static)
    };
  }

  /**
   * Overlay scanlines on top of current canvas content.
   * @param {CanvasRenderingContext2D} ctx
   * @param {HTMLCanvasElement} canvas
   * @param {number} time - normalized [0,1]
   */
  apply(ctx, canvas, time) {
    if (!this.enabled) return;

    const { lineHeight, opacity, speed } = this.params;
    if (opacity === 0) return;

    const w = canvas.width;
    const h = canvas.height;
    const step = lineHeight * 2;

    // Scroll offset — loops perfectly since we use modulo
    const scrollOffset = Math.round(time * speed * h) % step;

    ctx.save();
    ctx.fillStyle = `rgba(0, 0, 0, ${opacity})`;

    // Draw alternating dark lines
    for (let y = -step + scrollOffset; y < h + step; y += step) {
      ctx.fillRect(0, y, w, lineHeight);
    }

    ctx.restore();
  }
}
