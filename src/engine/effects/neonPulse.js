/**
 * NeonPulseEffect — bloom/glow with pulsing intensity, hard-edged CRT look.
 * Composites multiple softened copies of the canvas with additive blending
 * to simulate the bloom/halation of a CRT phosphor display.
 * Pulse is driven by a sine wave — 100% seamlessly looping.
 */
export class NeonPulseEffect {
  constructor() {
    this.enabled = false;
    this.params = {
      intensity: 0.7,    // 0–1 bloom strength
      pulseSpeed: 1.0,   // 0.1–3
      blurRadius: 12,    // 4–40 px (CSS blur on offscreen)
      glowColor: '#00ff88',
      hardEdge: true,    // CRT scanline-style hard edge on glow
    };
    this._offscreen = null;
    this._cachedW = 0;
    this._cachedH = 0;
  }

  _ensureBuffer(w, h) {
    if (this._cachedW !== w || this._cachedH !== h) {
      this._offscreen = new OffscreenCanvas(w, h);
      this._cachedW = w;
      this._cachedH = h;
    }
    return this._offscreen;
  }

  apply(ctx, canvas, time) {
    if (!this.enabled) return;

    const { intensity, pulseSpeed, blurRadius, glowColor, hardEdge } = this.params;
    const w = canvas.width;
    const h = canvas.height;

    // Pulsing factor — seamlessly loops
    const pulse = 0.6 + 0.4 * Math.sin(time * pulseSpeed * Math.PI * 2);
    const bloomAlpha = intensity * pulse;

    if (bloomAlpha < 0.01) return;

    // Take snapshot of current canvas
    const off = this._ensureBuffer(w, h);
    const offCtx = off.getContext('2d');
    offCtx.clearRect(0, 0, w, h);
    offCtx.drawImage(canvas, 0, 0);

    // Draw blurred bloom layers with additive blending
    // We simulate blur by drawing the snapshot multiple times with offsets
    // (true CSS filter blur isn't available on OffscreenCanvas in all browsers)
    ctx.save();
    ctx.globalCompositeOperation = 'screen';

    const steps = 6;
    const stepAlpha = bloomAlpha / steps;

    for (let i = 0; i < steps; i++) {
      const r = (blurRadius / steps) * (i + 1);
      const numSamples = 8;
      for (let s = 0; s < numSamples; s++) {
        const angle = (s / numSamples) * Math.PI * 2;
        const ox = Math.cos(angle) * r;
        const oy = Math.sin(angle) * r;
        ctx.globalAlpha = stepAlpha / numSamples;
        ctx.drawImage(off, ox, oy);
      }
    }

    // Optional: tint the glow layer
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = bloomAlpha * 0.2;
    ctx.fillStyle = glowColor;
    ctx.fillRect(0, 0, w, h);

    ctx.restore();

    // Hard-edge CRT vignette (darkens corners, creates tube-screen feel)
    if (hardEdge) {
      ctx.save();
      const vigGrad = ctx.createRadialGradient(w/2, h/2, h * 0.3, w/2, h/2, h * 0.75);
      vigGrad.addColorStop(0, 'rgba(0,0,0,0)');
      vigGrad.addColorStop(1, 'rgba(0,0,0,0.55)');
      ctx.fillStyle = vigGrad;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }
  }
}
