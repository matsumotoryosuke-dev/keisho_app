/**
 * TextLayer — renders text onto the canvas with support for letter spacing.
 * Uses character-by-character rendering for precise spacing control.
 */
export class TextLayer {
  constructor() {
    this.text = 'LOOP';
    this.font = 'Space Grotesk';
    this.size = 180;
    this.color = '#ffffff';
    this.letterSpacing = 12;
    this.align = 'center'; // 'left' | 'center' | 'right'
  }

  /**
   * Render text onto ctx. Call this first before any effects.
   * @param {CanvasRenderingContext2D} ctx
   * @param {HTMLCanvasElement} canvas
   * @param {number} time - normalized [0,1] loop time (unused here, available for future use)
   */
  render(ctx, canvas, time) {
    ctx.save();

    const fontString = `${this.size}px '${this.font}'`;
    ctx.font = fontString;
    ctx.fillStyle = this.color;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';

    const lines = this.text.split('\n');
    const lineHeight = this.size * 1.15;
    const totalHeight = lines.length * lineHeight;
    const startY = (canvas.height - totalHeight) / 2 + lineHeight / 2;

    lines.forEach((line, lineIdx) => {
      const chars = line.split('');
      const y = startY + lineIdx * lineHeight;

      // Measure total width including custom letter spacing
      let totalWidth = 0;
      const widths = chars.map(ch => {
        const w = ctx.measureText(ch).width;
        totalWidth += w;
        return w;
      });
      if (chars.length > 1) {
        totalWidth += this.letterSpacing * (chars.length - 1);
      }

      // Starting x based on alignment
      let startX;
      if (this.align === 'center') {
        startX = (canvas.width - totalWidth) / 2;
      } else if (this.align === 'right') {
        startX = canvas.width - totalWidth - 40;
      } else {
        startX = 40;
      }

      // Draw character by character
      let curX = startX;
      chars.forEach((ch, i) => {
        ctx.fillText(ch, curX, y);
        curX += widths[i] + this.letterSpacing;
      });
    });

    ctx.restore();
  }
}
