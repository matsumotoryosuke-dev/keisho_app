/**
 * Animation Templates — text-first, letterform-driven animations.
 *
 * Each template is an object with:
 *   id, name, description, paletteId, font, textSize, letterSpacing,
 *   loopDuration, density (glyph sample density),
 *   render(ctx, canvas, time, glyphData, palette) — draws one frame
 *
 * glyphData = { allPoints, perChar, totalBbox } from glyphSampler.
 * palette   = { background, primary, secondary, accent, text }
 *
 * Rules:
 *   - Background is NOT drawn here — main.js handles bg.
 *   - Old post-process effects (glitch, chromatic, scanlines) remain
 *     as optional overlays applied AFTER template.render().
 *   - No decorative background geometry unless it IS the letterform.
 */

// ── Easing helpers ─────────────────────────────────────────────────────────
function easeInOut(t) { return t < 0.5 ? 2*t*t : -1 + (4 - 2*t)*t; }
function easeOut(t)   { return 1 - (1-t)*(1-t); }
function easeIn(t)    { return t*t; }
function lerp(a, b, t){ return a + (b-a)*t; }
function clamp(v, lo, hi){ return v < lo ? lo : v > hi ? hi : v; }

// Parse "#rrggbb" or "#rgb" → [r,g,b]
export function hexToRGB(hex) {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2]; // expand shorthand
  if (h.length !== 6) return [0, 0, 0]; // safe fallback for wrong length
  const r = parseInt(h.substring(0,2), 16);
  const g = parseInt(h.substring(2,4), 16);
  const b = parseInt(h.substring(4,6), 16);
  // Guard against invalid hex digits producing NaN
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return [0, 0, 0];
  return [r, g, b];
}

function lerpColor(hexA, hexB, t) {
  const [r1,g1,b1] = hexToRGB(hexA);
  const [r2,g2,b2] = hexToRGB(hexB);
  const r = Math.round(lerp(r1,r2,t));
  const g = Math.round(lerp(g1,g2,t));
  const b = Math.round(lerp(b1,b2,t));
  return `rgb(${r},${g},${b})`;
}

// ── 1. Particle Field ──────────────────────────────────────────────────────
// Each glyph pixel becomes a dot. Dots breathe with sine-wave offset from home.
const particleField = {
  id: 'particle-field',
  name: 'Particle Field',
  description: 'Letterforms made of breathing, pulsing dots',
  category: 'text',
  defaultPalette: 'cyberpunk',
  paletteId: 'cyberpunk',
  font: 'Space Grotesk',
  textSize: 220,
  letterSpacing: 24,
  loopDuration: 3000,
  density: 0.35,

  render(ctx, canvas, time, glyphData, palette) {
    if (!glyphData || glyphData.allPoints.length === 0) return;
    const { allPoints, totalBbox } = glyphData;
    const w = canvas.width;
    const h = canvas.height;
    const cx = totalBbox.x + totalBbox.w / 2;
    const cy = totalBbox.y + totalBbox.h / 2;

    ctx.save();
    const TAU = Math.PI * 2;
    const phase = time * TAU;

    for (let i = 0; i < allPoints.length; i++) {
      const pt = allPoints[i];
      // Distance from center of letterform, normalized
      const dx = pt.x - cx;
      const dy = pt.y - cy;
      const dist = Math.sqrt(dx*dx + dy*dy);
      const maxDist = Math.max(totalBbox.w, totalBbox.h) / 2;
      const distNorm = clamp(dist / maxDist, 0, 1);

      // Breathing offset — unique per point using index as phase seed
      const ptPhase = (i * 0.00731) % 1; // quasi-random phase per point
      const breathAmt = 4 + distNorm * 8; // outer points move more
      const offsetX = Math.sin(phase + ptPhase * TAU) * breathAmt;
      const offsetY = Math.cos(phase * 0.7 + ptPhase * TAU) * breathAmt;

      const x = pt.x + offsetX;
      const y = pt.y + offsetY;

      // Color gradient: primary at center → accent at edges
      const col = lerpColor(palette.primary, palette.accent, distNorm);

      // Size pulses slightly
      const sz = 1.5 + 0.8 * Math.sin(phase * 1.3 + ptPhase * TAU);

      ctx.globalAlpha = 0.85 + 0.15 * Math.sin(phase + ptPhase * TAU);
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(x, y, sz, 0, TAU);
      ctx.fill();
    }

    ctx.restore();
  },
};

// ── 2. Scatter & Reform ───────────────────────────────────────────────────
// Dots scatter to random positions then flow back to form the word.
// Loop: scatter → travel → form → hold → scatter
const scatterReform = {
  id: 'scatter-reform',
  name: 'Scatter & Reform',
  description: 'Dots explode apart then flow back into letters',
  category: 'text',
  defaultPalette: 'aurora',
  paletteId: 'aurora',
  font: 'Impact',
  textSize: 240,
  letterSpacing: 28,
  loopDuration: 4000,
  density: 0.3,

  // Scatter destinations are seeded per-point deterministically
  _getScatter(pt, i, w, h) {
    // Pseudo-random but stable per point index
    const seed1 = Math.sin(i * 127.1 + 311.7) * 43758.5453;
    const seed2 = Math.sin(i * 269.5 + 183.3) * 43758.5453;
    const rx = (seed1 - Math.floor(seed1));
    const ry = (seed2 - Math.floor(seed2));
    return { x: rx * w, y: ry * h };
  },

  render(ctx, canvas, time, glyphData, palette) {
    if (!glyphData || glyphData.allPoints.length === 0) return;
    const { allPoints } = glyphData;
    const w = canvas.width;
    const h = canvas.height;
    const TAU = Math.PI * 2;

    // Loop phases: [0–0.2] scatter out, [0.2–0.55] travel in, [0.55–0.8] hold, [0.8–1] scatter
    ctx.save();

    for (let i = 0; i < allPoints.length; i++) {
      const pt = allPoints[i];
      // Per-point phase offset for organic stagger
      const ptOffset = (i * 0.00317) % 0.15;
      const t = (time + ptOffset) % 1;

      const scatter = this._getScatter(pt, i, w, h);

      let x, y, alpha;

      if (t < 0.25) {
        // Scatter out: home → scatter
        const p = easeIn(t / 0.25);
        x = lerp(pt.x, scatter.x, p);
        y = lerp(pt.y, scatter.y, p);
        alpha = 1 - p * 0.7;
      } else if (t < 0.55) {
        // Reform: scatter → home
        const p = easeOut((t - 0.25) / 0.30);
        x = lerp(scatter.x, pt.x, p);
        y = lerp(scatter.y, pt.y, p);
        alpha = 0.3 + p * 0.7;
      } else if (t < 0.80) {
        // Hold at home
        x = pt.x;
        y = pt.y;
        alpha = 1;
      } else {
        // Begin scatter (fade start)
        const p = easeIn((t - 0.80) / 0.20);
        x = lerp(pt.x, scatter.x, p * 0.3);
        y = lerp(pt.y, scatter.y, p * 0.3);
        alpha = 1 - p * 0.4;
      }

      const distNorm = clamp(Math.sqrt(
        (x - w/2)*(x - w/2) + (y - h/2)*(y - h/2)
      ) / (w * 0.5), 0, 1);

      ctx.globalAlpha = clamp(alpha * 0.9, 0, 1);
      ctx.fillStyle = lerpColor(palette.text, palette.accent, distNorm);
      ctx.beginPath();
      ctx.arc(x, y, 2, 0, TAU);
      ctx.fill();
    }

    ctx.restore();
  },
};

// ── 3. Outline Flow ───────────────────────────────────────────────────────
// Dots travel clockwise along the EDGE of each letter's silhouette.
const outlineFlow = {
  id: 'outline-flow',
  name: 'Outline Flow',
  description: 'Animated dots trace the edges of each letterform',
  category: 'text',
  defaultPalette: 'vaporwave',
  paletteId: 'vaporwave',
  font: 'Space Grotesk',
  textSize: 220,
  letterSpacing: 24,
  loopDuration: 3500,
  density: 0.15, // lower density — we extract edge pixels only

  // Extract edge pixels from allPoints (pixels adjacent to background)
  // We detect edges by looking for gaps in pixel grid.
  _extractEdges(allPoints, canvasW) {
    // Build a Set of occupied positions for fast lookup
    const occupied = new Set();
    for (const pt of allPoints) {
      occupied.add(pt.y * canvasW + pt.x);
    }
    // A pixel is an edge pixel if any of its 4 neighbours is NOT in the set
    const edge = [];
    for (const pt of allPoints) {
      const { x, y } = pt;
      if (!occupied.has((y-1)*canvasW + x)  ||
          !occupied.has((y+1)*canvasW + x)  ||
          !occupied.has(y*canvasW + (x-1))  ||
          !occupied.has(y*canvasW + (x+1))) {
        edge.push(pt);
      }
    }
    return edge;
  },

  _edgeCache: null,
  _edgeCacheKey: null,

  render(ctx, canvas, time, glyphData, palette) {
    if (!glyphData || glyphData.allPoints.length === 0) return;
    const { allPoints, perChar } = glyphData;
    const w = canvas.width;
    const h = canvas.height;
    const TAU = Math.PI * 2;

    // Cache edges — use object identity so different texts with the same
    // point count don't share a stale cache.
    const dataKey = allPoints;
    if (this._edgeCacheKey !== dataKey) {
      this._edgeCache = this._extractEdges(allPoints, w);
      this._edgeCacheKey = dataKey;
    }
    const edges = this._edgeCache;
    if (!edges || edges.length === 0) return;

    ctx.save();

    // Draw dots travelling along the edge — stagger per character
    const numChars = perChar.length;

    for (let ci = 0; ci < numChars; ci++) {
      const charData = perChar[ci];
      if (charData.points.length === 0) continue;

      // Extract edge pixels for this character
      const { bbox } = charData;
      const charEdges = edges.filter(pt =>
        pt.x >= bbox.x && pt.x <= bbox.x + bbox.w &&
        pt.y >= bbox.y && pt.y <= bbox.y + bbox.h
      );
      if (charEdges.length < 4) continue;

      // Speed varies per character
      const charSpeed = 0.8 + (ci * 0.13) % 0.6;
      const charOffset = ci / numChars;
      const localTime = (time * charSpeed + charOffset) % 1;

      // Spawn N dots travelling around the edge
      const numDots = Math.min(8, Math.max(3, Math.floor(charEdges.length / 20)));
      for (let d = 0; d < numDots; d++) {
        const dotPhase = (localTime + d / numDots) % 1;
        const edgeIdx = Math.floor(dotPhase * charEdges.length);
        const pt = charEdges[edgeIdx];
        if (!pt) continue;

        // Glow: draw 3 circles, decreasing opacity
        for (let g = 2; g >= 0; g--) {
          const sz = (g + 1) * 1.5;
          const alpha = (1 - g * 0.3) * (0.9 - d * 0.05);
          ctx.globalAlpha = clamp(alpha, 0, 1);
          ctx.fillStyle = g === 0 ? '#ffffff' : (ci % 2 === 0 ? palette.accent : palette.primary);
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, sz, 0, TAU);
          ctx.fill();
        }
      }
    }

    ctx.restore();
  },
};

// ── 4. Per-Char Blur ──────────────────────────────────────────────────────
// Each character animates independently: blur in → clear → blur out, staggered.
const perCharBlur = {
  id: 'per-char-blur',
  name: 'Per-Char Blur',
  description: 'Each letter blurs in and clears, staggered by position',
  category: 'text',
  defaultPalette: 'storm',
  paletteId: 'storm',
  font: 'Space Grotesk',
  textSize: 220,
  letterSpacing: 28,
  loopDuration: 3500,
  density: 0.1, // low — we draw text not points

  render(ctx, canvas, time, glyphData, palette) {
    if (!glyphData || glyphData.perChar.length === 0) return;
    const { perChar } = glyphData;
    const TAU = Math.PI * 2;
    const numChars = perChar.length;

    ctx.save();

    for (let ci = 0; ci < numChars; ci++) {
      const cd = perChar[ci];
      if (!cd.char || cd.char.trim() === '') continue;
      const { bbox } = cd;

      // Stagger: each character's animation starts later
      const stagger = ci / numChars;
      const localT = (time - stagger * 0.6 + 1) % 1;

      // Phase: 0→0.3 blur in, 0.3→0.65 clear, 0.65→0.9 hold, 0.9→1 blur out
      let blurPx, alpha;
      if (localT < 0.3) {
        const p = localT / 0.3;
        blurPx = lerp(18, 0, easeOut(p));
        alpha  = easeOut(p);
      } else if (localT < 0.65) {
        blurPx = 0;
        alpha  = 1;
      } else if (localT < 0.9) {
        const p = (localT - 0.65) / 0.25;
        blurPx = lerp(0, 18, easeIn(p));
        alpha  = 1 - easeIn(p) * 0.5;
      } else {
        blurPx = 18;
        alpha  = 0.5 + (1 - (localT - 0.9) / 0.1) * 0.5;
      }

      // Clip to character bbox, draw with filter
      ctx.save();
      ctx.globalAlpha = clamp(alpha, 0, 1);
      if (blurPx > 0.5) {
        ctx.filter = `blur(${blurPx.toFixed(1)}px)`;
      }

      // Draw the character at its computed position
      // We use the bbox center Y and left X from glyphSampler layout
      const charX = bbox.x;
      const charY = bbox.y + bbox.h / 2;

      ctx.font        = `${Math.round(bbox.h / 1.2)}px '${this.font}'`;
      ctx.fillStyle   = palette.text;
      ctx.textBaseline = 'middle';
      ctx.textAlign    = 'left';
      ctx.fillText(cd.char, charX, charY);

      ctx.restore();
    }

    ctx.restore();
  },
};

// ── 5. 3D Flip ────────────────────────────────────────────────────────────
// Each character flips on its Y axis (fake 3D via scaleX), sequentially.
const flip3D = {
  id: '3d-flip',
  name: '3D Flip',
  description: 'Letters flip one-by-one on their Y axis in fake perspective',
  category: 'text',
  defaultPalette: 'klimt',
  paletteId: 'klimt',
  font: 'Impact',
  textSize: 240,
  letterSpacing: 30,
  loopDuration: 4000,
  density: 0.1,

  render(ctx, canvas, time, glyphData, palette) {
    if (!glyphData || glyphData.perChar.length === 0) return;
    const { perChar } = glyphData;
    const numChars = perChar.length;
    if (numChars === 0) return;

    // Each character gets a time window: they flip sequentially
    const windowPerChar = 0.6 / numChars; // each char uses this fraction of the loop

    ctx.save();

    for (let ci = 0; ci < numChars; ci++) {
      const cd = perChar[ci];
      if (!cd.char || cd.char.trim() === '') continue;
      const { bbox } = cd;

      const charStart = ci * windowPerChar;
      const charEnd   = charStart + windowPerChar;
      const localT    = clamp((time - charStart) / windowPerChar, 0, 1);

      // flip angle 0 → π → 2π (one full rotation), but display only needs 0→π scaleX trick
      // scaleX: 1 → 0 → 1 (through π)
      const flipAngle = localT < 1 ? localT * Math.PI * 2 : 0;
      const scaleX    = Math.cos(flipAngle);
      const isBack    = scaleX < 0;

      // Center of character bbox
      const cx = bbox.x + bbox.w / 2;
      const cy = bbox.y + bbox.h / 2;
      const charFontSize = Math.round(bbox.h / 1.2);

      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(Math.abs(scaleX), 1);
      ctx.translate(-cx, -cy);

      ctx.font        = `${charFontSize}px '${this.font}'`;
      ctx.textBaseline = 'middle';
      ctx.textAlign    = 'left';

      if (isBack) {
        // Show accent color on the "back face"
        ctx.fillStyle = palette.accent;
        ctx.globalAlpha = 0.9;
      } else {
        ctx.fillStyle = palette.text;
        ctx.globalAlpha = 1;
      }

      ctx.fillText(cd.char, bbox.x, cy);
      ctx.restore();
    }

    ctx.restore();
  },
};

// ── 6. Neon Trace ─────────────────────────────────────────────────────────
// Letterform outlines drawn as glowing stroked paths. Trace animates 0%→100%.
const neonTrace = {
  id: 'neon-trace',
  name: 'Neon Trace',
  description: 'Glowing outline strokes trace each letter from start to finish',
  category: 'text',
  defaultPalette: 'vaporwave',
  paletteId: 'vaporwave',
  font: 'Space Grotesk',
  textSize: 220,
  letterSpacing: 24,
  loopDuration: 4000,
  density: 0.12,

  _extractEdgeSorted(allPoints, canvasW, bbox) {
    // Get edge pixels within the bbox, do a rough sort by angle from center
    const occupied = new Set();
    for (const pt of allPoints) {
      const inBox = pt.x >= bbox.x && pt.x <= bbox.x + bbox.w &&
                    pt.y >= bbox.y && pt.y <= bbox.y + bbox.h;
      if (inBox) occupied.add(pt.y * canvasW + pt.x);
    }
    const cx = bbox.x + bbox.w / 2;
    const cy = bbox.y + bbox.h / 2;
    const edgePts = [];
    for (const pt of allPoints) {
      if (pt.x < bbox.x || pt.x > bbox.x + bbox.w) continue;
      if (pt.y < bbox.y || pt.y > bbox.y + bbox.h) continue;
      // Edge test
      if (!occupied.has((pt.y-1)*canvasW + pt.x) ||
          !occupied.has((pt.y+1)*canvasW + pt.x) ||
          !occupied.has(pt.y*canvasW + (pt.x-1)) ||
          !occupied.has(pt.y*canvasW + (pt.x+1))) {
        edgePts.push(pt);
      }
    }
    // Sort by angle from bbox center for travelling effect
    edgePts.sort((a, b) => {
      const angA = Math.atan2(a.y - cy, a.x - cx);
      const angB = Math.atan2(b.y - cy, b.x - cx);
      return angA - angB;
    });
    return edgePts;
  },

  _charEdges: null,
  _charEdgesKey: null,

  render(ctx, canvas, time, glyphData, palette) {
    if (!glyphData || glyphData.allPoints.length === 0) return;
    const { allPoints, perChar } = glyphData;
    const w = canvas.width;
    const TAU = Math.PI * 2;
    const numChars = perChar.length;

    // Build per-char edge cache — use object identity so different texts with
    // the same point count don't share a stale cache.
    const dataKey = allPoints;
    if (this._charEdgesKey !== dataKey) {
      this._charEdges = perChar.map(cd =>
        this._extractEdgeSorted(allPoints, w, cd.bbox)
      );
      this._charEdgesKey = dataKey;
    }

    ctx.save();

    for (let ci = 0; ci < numChars; ci++) {
      const edges = this._charEdges[ci];
      if (!edges || edges.length < 4) continue;

      const charOffset = ci / Math.max(numChars, 1);
      // Each char animates on a slightly different phase
      const localT = (time + charOffset * 0.4) % 1;

      // Trace progress: 0→0.6 draw from 0%→100%, 0.6→1 fade out
      let traceEnd, alpha;
      if (localT < 0.6) {
        traceEnd = easeInOut(localT / 0.6);
        alpha = 1;
      } else {
        traceEnd = 1;
        alpha = 1 - easeIn((localT - 0.6) / 0.4);
      }

      const numPts = Math.floor(traceEnd * edges.length);
      if (numPts < 2) continue;

      // Draw glow: 3 passes with decreasing opacity, increasing lineWidth
      const glowPasses = [
        { lw: 8, alpha: 0.15 },
        { lw: 4, alpha: 0.35 },
        { lw: 1.5, alpha: 1.0 },
      ];

      for (const pass of glowPasses) {
        ctx.save();
        ctx.globalAlpha = clamp(alpha * pass.alpha, 0, 1);
        ctx.strokeStyle = ci % 2 === 0 ? palette.accent : palette.primary;
        ctx.lineWidth   = pass.lw;
        ctx.lineCap     = 'round';
        ctx.lineJoin    = 'round';
        ctx.beginPath();
        ctx.moveTo(edges[0].x, edges[0].y);
        for (let ei = 1; ei < numPts; ei++) {
          ctx.lineTo(edges[ei].x, edges[ei].y);
        }
        ctx.stroke();
        ctx.restore();
      }

      // Bright head dot at the trace front
      if (numPts > 0) {
        const head = edges[numPts - 1];
        ctx.save();
        ctx.globalAlpha = clamp(alpha * 0.9, 0, 1);
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(head.x, head.y, 3, 0, TAU);
        ctx.fill();
        ctx.restore();
      }
    }

    ctx.restore();
  },
};

// ── 7. Wave Morph ─────────────────────────────────────────────────────────
// Sampled points displaced by a scrolling sine wave field. Letters warp/flow.
const waveMorph = {
  id: 'wave-morph',
  name: 'Wave Morph',
  description: 'A sine wave field scrolls through the letterforms, warping them',
  category: 'text',
  defaultPalette: 'aurora',
  paletteId: 'aurora',
  font: 'Space Grotesk',
  textSize: 220,
  letterSpacing: 24,
  loopDuration: 4000,
  density: 0.28,

  render(ctx, canvas, time, glyphData, palette) {
    if (!glyphData || glyphData.allPoints.length === 0) return;
    const { allPoints } = glyphData;
    const w = canvas.width;
    const h = canvas.height;
    const TAU = Math.PI * 2;

    // Wave field parameters
    const waveSpeed  = time * TAU;          // scrolls with time
    const waveFreqX  = TAU / (w * 0.22);   // spatial frequency
    const waveFreqY  = TAU / (h * 0.28);
    const amplitude  = 14;                  // max displacement px

    ctx.save();

    for (let i = 0; i < allPoints.length; i++) {
      const pt = allPoints[i];

      // Two wave components (X and Y displacement)
      const waveX = Math.sin(pt.x * waveFreqX - waveSpeed) * amplitude
                  + Math.sin(pt.y * waveFreqY + waveSpeed * 0.7) * amplitude * 0.5;
      const waveY = Math.cos(pt.y * waveFreqY - waveSpeed * 0.8) * amplitude
                  + Math.cos(pt.x * waveFreqX + waveSpeed * 0.5) * amplitude * 0.5;

      const x = pt.x + waveX;
      const y = pt.y + waveY;

      // Color from displacement amount
      const dispNorm = clamp((Math.abs(waveX) + Math.abs(waveY)) / (amplitude * 2), 0, 1);
      ctx.fillStyle   = lerpColor(palette.text, palette.accent, dispNorm);
      ctx.globalAlpha = 0.8 + dispNorm * 0.2;

      ctx.beginPath();
      ctx.arc(x, y, 1.8, 0, TAU);
      ctx.fill();
    }

    ctx.restore();
  },
};

// ── 8. Gravity Fall ───────────────────────────────────────────────────────
// Per-character points fall with simulated gravity, bounce at a floor, reset.
const gravityFall = {
  id: 'gravity-fall',
  name: 'Gravity Fall',
  description: 'Letter dots drip downward with gravity, bounce, then reset',
  category: 'text',
  defaultPalette: 'retro',
  paletteId: 'retro',
  font: 'Space Grotesk',
  textSize: 220,
  letterSpacing: 24,
  loopDuration: 3000,
  density: 0.25,

  render(ctx, canvas, time, glyphData, palette) {
    if (!glyphData || glyphData.perChar.length === 0) return;
    const { perChar } = glyphData;
    const h   = canvas.height;
    const TAU = Math.PI * 2;
    const floor = h - h * 0.12; // floor at 88% down

    ctx.save();

    const numChars = perChar.length;

    for (let ci = 0; ci < numChars; ci++) {
      const cd = perChar[ci];
      if (cd.points.length === 0) continue;

      // Phase offset per character — characters fall at different times
      const charOffset = (ci / Math.max(numChars, 1)) * 0.5;
      const localT = (time + charOffset) % 1;

      // Physics: fall phase [0–0.55] fall + bounce, [0.55–0.75] bounce settle,
      //          [0.75–1.0] teleport back to home (instant reset)
      for (let pi = 0; pi < cd.points.length; pi++) {
        const pt = cd.points[pi];

        // Per-point micro-offset for organic look
        const ptOff = (pi * 0.00713) % 0.12;
        const t = (localT + ptOff) % 1;

        let x, y, alpha;

        if (t < 0.55) {
          // Fall phase: parabolic drop
          const fallT  = t / 0.55;
          // Gravity: y = home + g * t² — clamp to non-negative so descenders don't fly up
          const fallDist = Math.max(0, floor - pt.y) * fallT * fallT;
          x = pt.x;
          y = pt.y + fallDist;
          alpha = 1;
          // Clamp at floor
          if (y > floor) { y = floor; }
        } else if (t < 0.75) {
          // Bounce: compressed sine settle
          const bounceT = (t - 0.55) / 0.20;
          const bounceH = (floor - pt.y) * 0.12 * Math.abs(Math.sin(bounceT * Math.PI * 2)) * (1 - bounceT);
          x = pt.x;
          y = floor - bounceH;
          alpha = 1;
        } else {
          // Reset — teleport back, fade in
          const resetT = (t - 0.75) / 0.25;
          // Don't lerp below the floor for descender pixels
          const homY = Math.min(pt.y, floor);
          x = pt.x;
          y = lerp(floor, homY, easeOut(resetT));
          alpha = easeOut(resetT);
        }

        const colT = clamp((y - pt.y) / (floor - pt.y + 1), 0, 1);
        ctx.fillStyle   = lerpColor(palette.text, palette.secondary, colT);
        ctx.globalAlpha = clamp(alpha * 0.9, 0, 1);

        ctx.beginPath();
        ctx.arc(x, y, 2, 0, TAU);
        ctx.fill();
      }
    }

    ctx.restore();
  },
};

// ── 9. Typewriter ────────────────────────────────────────────────────────────
// Characters reveal one-by-one left-to-right as if being typed. Then fade out.
const typewriter = {
  id: 'typewriter',
  name: 'Typewriter',
  category: 'text',
  description: 'Characters appear one by one as if being typed, cursor blinking',
  defaultPalette: 'storm',
  paletteId: 'storm',
  font: 'Courier New',
  textSize: 200,
  letterSpacing: 12,
  loopDuration: 5000,
  density: 0.1,

  render(ctx, canvas, time, glyphData, palette) {
    if (!glyphData || glyphData.perChar.length === 0) return;
    const { perChar } = glyphData;
    const numChars = perChar.length;
    const TAU = Math.PI * 2;

    // Phase: 0–0.5 type in, 0.5–0.75 hold, 0.75–1.0 delete
    const typeInEnd   = 0.5;
    const holdEnd     = 0.75;

    ctx.save();

    let visibleCount;
    if (time < typeInEnd) {
      visibleCount = Math.floor(easeInOut(time / typeInEnd) * numChars);
    } else if (time < holdEnd) {
      visibleCount = numChars;
    } else {
      const deleteT = (time - holdEnd) / (1 - holdEnd);
      visibleCount = Math.floor((1 - easeIn(deleteT)) * numChars);
    }

    // Draw visible characters
    for (let ci = 0; ci < visibleCount; ci++) {
      const cd = perChar[ci];
      if (!cd.char || cd.char.trim() === '') { continue; }
      const { bbox } = cd;
      const charX = bbox.x;
      const charY = bbox.y + bbox.h / 2;

      ctx.font        = `${Math.round(bbox.h / 1.2)}px '${this.font}'`;
      ctx.fillStyle   = palette.text;
      ctx.globalAlpha = 1;
      ctx.textBaseline = 'middle';
      ctx.textAlign    = 'left';
      ctx.fillText(cd.char, charX, charY);
    }

    // Cursor blink — position after last visible char
    const cursorBlink = Math.sin(time * TAU * 4) > 0;
    if (cursorBlink && visibleCount <= numChars) {
      let cursorX;
      if (visibleCount > 0 && visibleCount <= numChars) {
        const lastCd = perChar[Math.min(visibleCount - 1, numChars - 1)];
        cursorX = lastCd.bbox.x + lastCd.bbox.w + 4;
        if (time < typeInEnd && visibleCount < numChars) {
          const nextCd = perChar[visibleCount];
          cursorX = nextCd ? nextCd.bbox.x : cursorX;
        }
      } else {
        cursorX = perChar[0].bbox.x;
      }
      const refCd = perChar[0];
      const cursorH = Math.round(refCd.bbox.h / 1.0);
      const cursorY = refCd.bbox.y + refCd.bbox.h / 2 - cursorH / 2;
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = palette.accent;
      ctx.fillRect(cursorX, cursorY, 3, cursorH);
    }

    ctx.restore();
  },
};

// ── 10. Char Orbit ────────────────────────────────────────────────────────────
// Each character orbits around the text centroid on a unique ellipse path.
const charOrbit = {
  id: 'char-orbit',
  name: 'Char Orbit',
  category: 'text',
  description: 'Each letter orbits the center on its own elliptical path',
  defaultPalette: 'aurora',
  paletteId: 'aurora',
  font: 'Space Grotesk',
  textSize: 200,
  letterSpacing: 20,
  loopDuration: 5000,
  density: 0.1,

  render(ctx, canvas, time, glyphData, palette) {
    if (!glyphData || glyphData.perChar.length === 0) return;
    const { perChar, totalBbox } = glyphData;
    const numChars = perChar.length;
    const TAU = Math.PI * 2;
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;

    ctx.save();

    for (let ci = 0; ci < numChars; ci++) {
      const cd = perChar[ci];
      if (!cd.char || cd.char.trim() === '') continue;
      const { bbox } = cd;

      // Each char has unique orbit params
      const orbitPhase = (ci / numChars) * TAU;
      let radiusX = totalBbox.w * (0.25 + (ci * 0.137) % 0.35);
      let radiusY = totalBbox.h * (0.15 + (ci * 0.223) % 0.25);
      // Clamp so characters don't orbit off-canvas for long text strings
      radiusX = Math.min(radiusX, canvas.width  * 0.42);
      radiusY = Math.min(radiusY, canvas.height * 0.42);
      const speed   = 1 + (ci * 0.0831) % 0.8;
      const tilt    = (ci * 0.314) % Math.PI;

      const angle = time * TAU * speed + orbitPhase;
      const rx = Math.cos(angle) * radiusX;
      const ry = Math.sin(angle) * radiusY;
      // Apply tilt rotation
      const orbX = cx + rx * Math.cos(tilt) - ry * Math.sin(tilt);
      const orbY = cy + rx * Math.sin(tilt) + ry * Math.cos(tilt);

      // Depth illusion: scale by Y position
      const depthScale = 0.6 + 0.4 * ((ry + radiusY) / (radiusY * 2));
      const alpha = 0.5 + 0.5 * depthScale;
      const fontSize = Math.round((bbox.h / 1.2) * depthScale);

      const col = lerpColor(palette.primary, palette.accent, (ci / numChars));

      ctx.save();
      ctx.globalAlpha = clamp(alpha, 0, 1);
      ctx.fillStyle = col;
      ctx.font = `${fontSize}px '${this.font}'`;
      ctx.textBaseline = 'middle';
      ctx.textAlign    = 'center';
      ctx.fillText(cd.char, orbX, orbY);
      ctx.restore();
    }

    ctx.restore();
  },
};

// ── 11. Shatter ────────────────────────────────────────────────────────────
// Letters explode into shards outward from their center, then reassemble.
const shatter = {
  id: 'shatter',
  name: 'Shatter',
  category: 'text',
  description: 'Letters fragment into pixel shards, fly out, then reassemble',
  defaultPalette: 'cyberpunk',
  paletteId: 'cyberpunk',
  font: 'Impact',
  textSize: 240,
  letterSpacing: 28,
  loopDuration: 4000,
  density: 0.2,

  render(ctx, canvas, time, glyphData, palette) {
    if (!glyphData || glyphData.allPoints.length === 0) return;
    const { allPoints, totalBbox } = glyphData;
    const TAU = Math.PI * 2;
    const cx = totalBbox.x + totalBbox.w / 2;
    const cy = totalBbox.y + totalBbox.h / 2;
    const maxDist = Math.max(totalBbox.w, totalBbox.h);

    // Phase: 0–0.15 hold, 0.15–0.5 explode, 0.5–0.65 far hold, 0.65–1.0 implode
    ctx.save();

    for (let i = 0; i < allPoints.length; i++) {
      const pt = allPoints[i];
      const ptSeed = Math.sin(i * 71.3 + 13.7) * 43758.5453;
      const ptAngle = (ptSeed - Math.floor(ptSeed)) * TAU;
      const ptSpeed = 0.6 + (Math.sin(i * 127.1) * 0.5 + 0.5) * 0.8;

      const ptOff = (i * 0.00512) % 0.1;
      const t = (time + ptOff) % 1;

      let x, y, alpha, sz;

      if (t < 0.15) {
        x = pt.x; y = pt.y; alpha = 1; sz = 2;
      } else if (t < 0.5) {
        const p = easeIn((t - 0.15) / 0.35);
        const dist = p * maxDist * 0.5 * ptSpeed;
        x = pt.x + Math.cos(ptAngle) * dist;
        y = pt.y + Math.sin(ptAngle) * dist;
        alpha = 1 - p * 0.6;
        sz = 2 + p * 2;
      } else if (t < 0.65) {
        const p = (t - 0.5) / 0.15;
        const dist = maxDist * 0.5 * ptSpeed;
        x = pt.x + Math.cos(ptAngle) * dist;
        y = pt.y + Math.sin(ptAngle) * dist;
        alpha = 0.4 + p * 0.3;
        sz = 4;
      } else {
        const p = easeOut((t - 0.65) / 0.35);
        const dist = (1 - p) * maxDist * 0.5 * ptSpeed;
        x = pt.x + Math.cos(ptAngle) * dist;
        y = pt.y + Math.sin(ptAngle) * dist;
        alpha = 0.4 + p * 0.6;
        sz = 4 - p * 2;
      }

      const dx = pt.x - cx;
      const dy = pt.y - cy;
      const distNorm = clamp(Math.sqrt(dx*dx + dy*dy) / (maxDist * 0.5), 0, 1);
      ctx.fillStyle   = lerpColor(palette.primary, palette.accent, distNorm);
      ctx.globalAlpha = clamp(alpha, 0, 1);
      ctx.beginPath();
      ctx.arc(x, y, Math.max(0.5, sz), 0, TAU);
      ctx.fill();
    }

    ctx.restore();
  },
};

// ── 12. Aurora Wave Lines ─────────────────────────────────────────────────
// Stacked horizontal sine-wave lines that phase-shift and color-shift — aurora borealis feel.
const auroraWave = {
  id: 'aurora-wave',
  name: 'Aurora Wave',
  category: 'geometry',
  description: 'Stacked sine-wave ribbons shimmer like an aurora borealis',
  defaultPalette: 'aurora',
  paletteId: 'aurora',
  font: 'Space Grotesk',
  textSize: 220,
  letterSpacing: 24,
  loopDuration: 6000,
  density: 0.1,

  render(ctx, canvas, time, glyphData, palette) {
    const w = canvas.width;
    const h = canvas.height;
    const TAU = Math.PI * 2;
    const t = time * TAU;

    const numLines = 32;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    for (let li = 0; li < numLines; li++) {
      const yBase  = h * 0.2 + (li / numLines) * h * 0.6;
      const freq1  = 0.003 + li * 0.00007;
      const freq2  = 0.002 + li * 0.00005;
      const amp1   = 60 + li * 2.5;
      const amp2   = 30 + li * 1.5;
      const speed1 = 1 + li * 0.03;
      const speed2 = 0.7 + li * 0.02;
      const phaseOff = li * 0.31;

      const colorT = li / numLines;
      const col = lerpColor(palette.primary, palette.secondary, colorT);

      ctx.beginPath();
      for (let px = 0; px <= w; px += 4) {
        const y = yBase
          + Math.sin(px * freq1 + t * speed1 + phaseOff) * amp1
          + Math.sin(px * freq2 - t * speed2 + phaseOff * 2) * amp2;
        if (px === 0) ctx.moveTo(px, y);
        else ctx.lineTo(px, y);
      }
      ctx.strokeStyle = col;
      ctx.lineWidth   = 1.2;
      ctx.globalAlpha = 0.18 + 0.08 * Math.sin(t * 0.5 + phaseOff);
      ctx.stroke();
    }

    ctx.restore();
  },
};

// ── 13. Voronoi Cell Field ─────────────────────────────────────────────────
// Animated Voronoi cells that drift and pulse. Sites move slowly.
const voronoiField = {
  id: 'voronoi-field',
  name: 'Voronoi Field',
  category: 'geometry',
  description: 'Drifting Voronoi cells pulse with color — organic cell structure',
  defaultPalette: 'jungle',
  paletteId: 'jungle',
  font: 'Space Grotesk',
  textSize: 220,
  letterSpacing: 24,
  loopDuration: 8000,
  density: 0.1,

  _sites: null,
  _lastW: 0,
  _lastH: 0,
  _initSites(w, h) {
    const n = 28;
    const sites = [];
    for (let i = 0; i < n; i++) {
      const sx = Math.sin(i * 127.1 + 311.7) * 43758.5453;
      const sy = Math.sin(i * 269.5 + 183.3) * 43758.5453;
      sites.push({
        x: (sx - Math.floor(sx)) * w,
        y: (sy - Math.floor(sy)) * h,
        phase: (Math.sin(i * 31.7) * 0.5 + 0.5),
      });
    }
    return sites;
  },

  render(ctx, canvas, time, glyphData, palette) {
    const w = canvas.width;
    const h = canvas.height;
    const TAU = Math.PI * 2;

    if (!this._sites || this._lastW !== w || this._lastH !== h) {
      this._sites = this._initSites(w, h);
      this._lastW = w;
      this._lastH = h;
    }

    // Move sites
    const sites = this._sites.map((s, i) => ({
      x: s.x + Math.sin(time * TAU + s.phase * TAU) * w * 0.08,
      y: s.y + Math.cos(time * TAU * 0.7 + s.phase * TAU) * h * 0.06,
      phase: s.phase,
    }));

    // Sample-based Voronoi: iterate a downsampled pixel grid
    const step = 8;
    for (let py = 0; py < h; py += step) {
      for (let px = 0; px < w; px += step) {
        let minDist = Infinity;
        let secondDist = Infinity;
        let nearest = 0;
        for (let si = 0; si < sites.length; si++) {
          const dx = px - sites[si].x;
          const dy = py - sites[si].y;
          const d = dx*dx + dy*dy;
          if (d < minDist) { secondDist = minDist; minDist = d; nearest = si; }
          else if (d < secondDist) { secondDist = d; }
        }

        // Edge detection: distance to second site
        const edgeDist = Math.sqrt(secondDist) - Math.sqrt(minDist);
        const isEdge = edgeDist < 6;
        const colorT  = (nearest / sites.length + time * 0.1 + sites[nearest].phase) % 1;
        const cellPulse = 0.3 + 0.15 * Math.sin(time * TAU * 2 + sites[nearest].phase * TAU);

        ctx.fillStyle   = isEdge ? palette.accent : lerpColor(palette.primary, palette.secondary, colorT);
        ctx.globalAlpha = isEdge ? 0.7 : cellPulse;
        ctx.fillRect(px, py, step, step);
      }
    }
  },
};

// ── 14. Flow Field ─────────────────────────────────────────────────────────
// Particles follow a curl-noise-like flow field — streamlines sweep the canvas.
const flowField = {
  id: 'flow-field',
  name: 'Flow Field',
  category: 'geometry',
  description: 'Thousands of streamline particles follow a shifting curl-noise field',
  defaultPalette: 'vaporwave',
  paletteId: 'vaporwave',
  font: 'Space Grotesk',
  textSize: 220,
  letterSpacing: 24,
  loopDuration: 6000,
  density: 0.1,

  _particles: null,
  _lastW: 0,
  _lastH: 0,
  _initParticles(w, h, n) {
    const particles = [];
    for (let i = 0; i < n; i++) {
      const sx = Math.sin(i * 127.1) * 43758.5453;
      const sy = Math.sin(i * 269.5) * 43758.5453;
      particles.push({
        x:     (sx - Math.floor(sx)) * w,
        y:     (sy - Math.floor(sy)) * h,
        life:  (Math.sin(i * 31.7) * 0.5 + 0.5),
        maxLife: 0.3 + (Math.sin(i * 53.3) * 0.5 + 0.5) * 0.7,
        speed: 1.5 + (Math.sin(i * 71.1) * 0.5 + 0.5) * 2.5,
        colorT: (i / n),
      });
    }
    return particles;
  },

  render(ctx, canvas, time, glyphData, palette) {
    const w = canvas.width;
    const h = canvas.height;
    const TAU = Math.PI * 2;

    if (!this._particles || this._lastW !== w || this._lastH !== h) {
      this._particles = this._initParticles(w, h, 800);
      this._lastW = w;
      this._lastH = h;
    }

    // Very subtle trail fade
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.04)';
    ctx.fillRect(0, 0, w, h);

    // Flow field: angle = sin(x*freq + t) * cos(y*freq + t*0.7)
    const freqX = TAU / (w * 0.3);
    const freqY = TAU / (h * 0.4);
    const t = time * TAU;

    for (const p of this._particles) {
      // Field angle at particle position
      const angle = Math.sin(p.x * freqX + t) * Math.PI
                  + Math.cos(p.y * freqY + t * 0.7) * Math.PI * 0.5
                  + Math.sin((p.x + p.y) * freqX * 0.5 - t * 0.3) * Math.PI * 0.3;

      const speed = p.speed * (1 + 0.3 * Math.sin(t + p.colorT * TAU));
      p.x += Math.cos(angle) * speed;
      p.y += Math.sin(angle) * speed;
      p.life += 0.008;

      // Wrap or reset
      if (p.x < 0 || p.x > w || p.y < 0 || p.y > h || p.life > p.maxLife) {
        const seed1 = Math.sin(p.life * 127.1 + p.colorT * 311.7) * 43758.5453;
        const seed2 = Math.sin(p.life * 269.5 + p.colorT * 183.3) * 43758.5453;
        p.x = (seed1 - Math.floor(seed1)) * w;
        p.y = (seed2 - Math.floor(seed2)) * h;
        p.life = 0;
      }

      const lifeT = p.life / p.maxLife;
      const alpha = Math.sin(lifeT * Math.PI) * 0.7;
      const col = lerpColor(palette.primary, palette.accent, p.colorT);

      ctx.globalAlpha = clamp(alpha, 0, 1);
      ctx.fillStyle   = col;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 1.5, 0, TAU);
      ctx.fill();
    }

    ctx.restore();
  },
};

// ── 15. Kaleidoscope ──────────────────────────────────────────────────────
// Radially symmetric geometry rotated N times around the center.
const kaleidoscope = {
  id: 'kaleidoscope',
  name: 'Kaleidoscope',
  category: 'geometry',
  description: 'Radially mirrored geometry rotates and morphs around the center',
  defaultPalette: 'warhol',
  paletteId: 'warhol',
  font: 'Space Grotesk',
  textSize: 220,
  letterSpacing: 24,
  loopDuration: 7000,
  density: 0.1,

  render(ctx, canvas, time, glyphData, palette) {
    const w = canvas.width;
    const h = canvas.height;
    const TAU = Math.PI * 2;
    const t = time * TAU;
    const cx = w / 2;
    const cy = h / 2;
    const symmetry = 8;
    const sliceAngle = TAU / symmetry;

    ctx.save();
    ctx.translate(cx, cy);

    for (let s = 0; s < symmetry; s++) {
      ctx.save();
      ctx.rotate(s * sliceAngle + t * 0.15);
      // Mirror every other slice
      if (s % 2 === 1) ctx.scale(-1, 1);

      // Draw several layered shapes in one slice
      const numShapes = 6;
      for (let si = 0; si < numShapes; si++) {
        const phaseOff = si * 0.4 + s * 0.1;
        const radius = 80 + si * 70 + Math.sin(t * (0.5 + si * 0.3) + phaseOff) * 50;
        const innerR = radius * (0.3 + 0.2 * Math.sin(t * 0.7 + phaseOff));
        const colorT = ((si / numShapes) + time * 0.2 + s * 0.05) % 1;
        const col = lerpColor(palette.primary, palette.accent, colorT);
        const alpha = 0.12 + 0.08 * Math.sin(t * 1.1 + phaseOff);

        ctx.beginPath();
        ctx.moveTo(0, innerR);
        ctx.lineTo(radius * Math.sin(sliceAngle * 0.5), radius * Math.cos(sliceAngle * 0.5));
        ctx.lineTo(0, radius);
        ctx.closePath();

        ctx.fillStyle   = col;
        ctx.globalAlpha = alpha;
        ctx.fill();

        // Overlay a circle for depth
        ctx.beginPath();
        ctx.arc(0, radius * 0.6, radius * 0.15, 0, TAU);
        ctx.fillStyle   = palette.secondary;
        ctx.globalAlpha = alpha * 0.5;
        ctx.fill();
      }

      ctx.restore();
    }

    ctx.restore();
  },
};

// ── 16. Concentric Pulse Rings ─────────────────────────────────────────────
// Rings expand from center, fade out. Multiple simultaneous waves.
const concentricPulse = {
  id: 'concentric-pulse',
  name: 'Concentric Pulse',
  category: 'geometry',
  description: 'Expanding rings radiate outward from the center in layered waves',
  defaultPalette: 'cyberpunk',
  paletteId: 'cyberpunk',
  font: 'Space Grotesk',
  textSize: 220,
  letterSpacing: 24,
  loopDuration: 4000,
  density: 0.1,

  render(ctx, canvas, time, glyphData, palette) {
    const w = canvas.width;
    const h = canvas.height;
    const TAU = Math.PI * 2;
    const cx  = w / 2;
    const cy  = h / 2;
    const maxR = Math.sqrt(cx*cx + cy*cy);

    const numWaves = 5;
    const numRingsPerWave = 8;

    ctx.save();

    for (let wi = 0; wi < numWaves; wi++) {
      const wavePhase  = wi / numWaves;
      const waveTime   = (time + wavePhase) % 1;
      const waveSpeed  = 0.8 + wi * 0.15;
      const col = lerpColor(palette.primary, palette.accent, wi / numWaves);

      for (let ri = 0; ri < numRingsPerWave; ri++) {
        const ringPhase = ri / numRingsPerWave;
        const ringTime  = (waveTime * waveSpeed + ringPhase) % 1;
        const radius    = easeOut(ringTime) * maxR;
        const alpha     = (1 - ringTime) * 0.4;
        const lineWidth = (1 - ringTime) * 3 + 0.5;

        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, TAU);
        ctx.strokeStyle = col;
        ctx.globalAlpha = clamp(alpha, 0, 1);
        ctx.lineWidth   = lineWidth;
        ctx.stroke();
      }
    }

    // Center core glow
    const glowR = 30 + 15 * Math.sin(time * TAU * 2);
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowR);
    grad.addColorStop(0, palette.accent);
    grad.addColorStop(1, 'transparent');
    ctx.globalAlpha = 0.6 + 0.3 * Math.sin(time * TAU * 3);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, glowR, 0, TAU);
    ctx.fill();

    ctx.restore();
  },
};

// ── 17. Fractal Noise Field ────────────────────────────────────────────────
// Layered Perlin-like sine noise field rendered as a pixel grid. Slowly animates.
const fractalNoise = {
  id: 'fractal-noise',
  name: 'Fractal Noise',
  category: 'geometry',
  description: 'Layered sine-noise field creates a living fractal texture',
  defaultPalette: 'storm',
  paletteId: 'storm',
  font: 'Space Grotesk',
  textSize: 220,
  letterSpacing: 24,
  loopDuration: 8000,
  density: 0.1,

  render(ctx, canvas, time, glyphData, palette) {
    const w = canvas.width;
    const h = canvas.height;
    const TAU = Math.PI * 2;
    const t = time * TAU;

    // Render at lower resolution for performance, scale up
    const res = 6; // pixels per block
    const cols = Math.ceil(w / res);
    const rows = Math.ceil(h / res);

    const [r1, g1, b1] = hexToRGB(palette.primary);
    const [r2, g2, b2] = hexToRGB(palette.secondary);
    const [ra, ga, ba] = hexToRGB(palette.accent);

    ctx.save();
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const nx = col / cols;
        const ny = row / rows;

        // 4 octaves of sine noise
        let v = 0;
        v += Math.sin(nx * TAU * 2 + t * 0.5) * 0.4;
        v += Math.sin(ny * TAU * 3 - t * 0.7) * 0.3;
        v += Math.sin((nx + ny) * TAU * 5 + t * 1.1) * 0.15;
        v += Math.sin((nx - ny) * TAU * 8 - t * 0.9) * 0.1;
        v += Math.sin(nx * ny * TAU * 10 + t * 0.3) * 0.05;
        // v in [-1, 1], normalize to [0, 1]
        const vn = clamp((v + 1) / 2, 0, 1);

        let rr, gg, bb;
        if (vn < 0.5) {
          rr = Math.round(lerp(r1, r2, vn * 2));
          gg = Math.round(lerp(g1, g2, vn * 2));
          bb = Math.round(lerp(b1, b2, vn * 2));
        } else {
          rr = Math.round(lerp(r2, ra, (vn - 0.5) * 2));
          gg = Math.round(lerp(g2, ga, (vn - 0.5) * 2));
          bb = Math.round(lerp(b2, ba, (vn - 0.5) * 2));
        }

        ctx.globalAlpha = 0.5 + 0.35 * vn;
        ctx.fillStyle = `rgb(${rr},${gg},${bb})`;
        ctx.fillRect(col * res, row * res, res, res);
      }
    }
    ctx.restore();
  },
};

// ── 18. Truchet Tiles ─────────────────────────────────────────────────────
// Grid of quarter-circle arcs, each randomly oriented. Rotates slowly over time.
const truchetTiles = {
  id: 'truchet-tiles',
  name: 'Truchet Tiles',
  category: 'geometry',
  description: 'Animated Truchet quarter-arc tiles form shifting maze-like patterns',
  defaultPalette: 'bauhaus',
  paletteId: 'bauhaus',
  font: 'Space Grotesk',
  textSize: 220,
  letterSpacing: 24,
  loopDuration: 6000,
  density: 0.1,

  _grid: null,
  _initGrid(cols, rows) {
    const grid = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const v = Math.sin(r * 73.1 + c * 127.3 + r * c * 0.1) * 43758.5453;
        grid.push((v - Math.floor(v)) > 0.5 ? 0 : 1);
      }
    }
    return grid;
  },

  render(ctx, canvas, time, glyphData, palette) {
    const w = canvas.width;
    const h = canvas.height;
    const TAU = Math.PI * 2;
    const t = time;

    const tileSize = 80;
    const cols = Math.ceil(w / tileSize) + 1;
    const rows = Math.ceil(h / tileSize) + 1;

    if (!this._grid || this._grid.length !== cols * rows) {
      this._grid = this._initGrid(cols, rows);
    }

    // Offset the grid slowly to create movement
    const offsetX = (time * tileSize * 0.3) % tileSize;
    const offsetY = (time * tileSize * 0.15) % tileSize;

    ctx.save();
    ctx.translate(-offsetX, -offsetY);
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const idx = r * cols + c;
        const variant = this._grid[idx];
        const x = c * tileSize;
        const y = r * tileSize;
        const hs = tileSize / 2;

        // Color cycle per tile with time
        const colorPhase = ((c * 0.13 + r * 0.17 + t) % 1);
        const col = lerpColor(palette.primary, palette.accent, colorPhase);
        ctx.strokeStyle = col;
        ctx.globalAlpha = 0.6 + 0.2 * Math.sin(TAU * (t + c * 0.1 + r * 0.07));

        ctx.beginPath();
        if (variant === 0) {
          // Arc from top-center to right-center
          ctx.arc(x, y, hs, 0, Math.PI / 2);
          ctx.moveTo(x + tileSize, y + tileSize);
          ctx.arc(x + tileSize, y + tileSize, hs, Math.PI, Math.PI * 1.5);
        } else {
          // Arc from top-center to left-center
          ctx.arc(x + tileSize, y, hs, Math.PI / 2, Math.PI);
          ctx.moveTo(x, y + tileSize);
          ctx.arc(x, y + tileSize, hs, Math.PI * 1.5, TAU);
        }
        ctx.stroke();
      }
    }

    ctx.restore();
  },
};

// ── Audio helpers ─────────────────────────────────────────────────────────
// Safely read from audioData, returning a fallback when hasAudio is false.
function safeAudio(audioData) {
  if (!audioData || !audioData.hasAudio) {
    return {
      waveform:  null,
      frequency: null,
      bass:      0,
      mid:       0,
      treble:    0,
      amplitude: 0,
      hasAudio:  false,
    };
  }
  return audioData;
}

// ── 19. Frequency Bars ─────────────────────────────────────────────────────
// Classic spectrum analyser with 64 bars. Falls back to sine-wave pattern.
const frequencyBars = {
  id: 'frequency-bars',
  name: 'Frequency Bars',
  description: 'Classic spectrum analyser — bars pulse with audio frequency data',
  category: 'audio',
  needsGlyphs: false,
  defaultPalette: 'cyberpunk',
  paletteId: 'cyberpunk',
  font: 'Space Grotesk',
  textSize: 220,
  letterSpacing: 24,
  loopDuration: 4000,
  density: 0.1,

  render(ctx, canvas, time, glyphData, palette, audioData) {
    const w = canvas.width;
    const h = canvas.height;
    const TAU = Math.PI * 2;
    const ad = safeAudio(audioData);

    const NUM_BARS = 64;
    const barW = (w / NUM_BARS) * 0.75;
    const gap  = w / NUM_BARS;

    for (let i = 0; i < NUM_BARS; i++) {
      let heightFrac;
      if (ad.hasAudio && ad.frequency) {
        // Map bar index to frequency bin (frequency is Uint8Array[1024])
        const binIdx = Math.floor(i * 8);
        heightFrac = ad.frequency[binIdx] / 255;
      } else {
        // Procedural fallback: staggered sine wave
        const phase = (i / NUM_BARS) * Math.PI * 2;
        heightFrac = 0.15 + 0.45 * (0.5 + 0.5 * Math.sin(time * TAU * 2 + phase));
      }

      const barH = heightFrac * h * 0.8;
      const x = i * gap + (gap - barW) / 2;
      const y = h - barH;

      // Gradient from primary (bottom/short) to accent (top/tall)
      const grad = ctx.createLinearGradient(x, h, x, y);
      grad.addColorStop(0, palette.primary);
      grad.addColorStop(1, palette.accent);

      ctx.fillStyle = grad;
      ctx.globalAlpha = 0.9;

      // Rounded top cap — draw as filled rect + two top-corner arcs
      const radius = Math.min(barW / 2, 6);
      ctx.beginPath();
      if (barH > radius * 2) {
        // Bottom: straight rect portion
        ctx.rect(x, y + radius, barW, barH - radius);
        // Top: semicircle
        ctx.arc(x + barW / 2, y + radius, barW / 2, Math.PI, 0);
      } else {
        ctx.rect(x, y, barW, barH);
      }
      ctx.closePath();
      ctx.fill();
    }

    ctx.globalAlpha = 1;
  },
};

// ── 20. Oscilloscope ──────────────────────────────────────────────────────
// Waveform line — glowing, color-shifting. Falls back to a sine wave.
const oscilloscope = {
  id: 'oscilloscope',
  name: 'Oscilloscope',
  description: 'Raw audio waveform drawn as a glowing neon line across the canvas',
  category: 'audio',
  needsGlyphs: false,
  defaultPalette: 'vaporwave',
  paletteId: 'vaporwave',
  font: 'Space Grotesk',
  textSize: 220,
  letterSpacing: 24,
  loopDuration: 4000,
  density: 0.1,

  render(ctx, canvas, time, glyphData, palette, audioData) {
    const w = canvas.width;
    const h = canvas.height;
    const TAU = Math.PI * 2;
    const ad = safeAudio(audioData);
    const cy = h / 2;

    // Color shift over time cycling through primary and accent
    const colorT = (Math.sin(time * TAU) * 0.5 + 0.5);
    const [r1,g1,b1] = hexToRGB(palette.primary);
    const [r2,g2,b2] = hexToRGB(palette.accent);
    const lineColor = `rgb(${Math.round(lerp(r1,r2,colorT))},${Math.round(lerp(g1,g2,colorT))},${Math.round(lerp(b1,b2,colorT))})`;

    const SAMPLES = Math.max(2, ad.hasAudio && ad.waveform ? ad.waveform.length : 512);

    // Build path points
    const pts = [];
    for (let i = 0; i < SAMPLES; i++) {
      const x = (i / (SAMPLES - 1)) * w;
      let norm; // -1..1
      if (ad.hasAudio && ad.waveform) {
        norm = (ad.waveform[i] - 128) / 128;
      } else {
        // 2 Hz sine fallback
        norm = Math.sin(time * TAU * 2 + (i / SAMPLES) * TAU * 4) * 0.6;
      }
      const y = cy + norm * (h * 0.35);
      pts.push({ x, y });
    }

    // Draw 3 glow passes
    const passes = [
      { lw: 12, alpha: 0.08 },
      { lw:  6, alpha: 0.2  },
      { lw:  3, alpha: 1.0  },
    ];

    for (const pass of passes) {
      ctx.save();
      ctx.globalAlpha = pass.alpha;
      ctx.strokeStyle = lineColor;
      ctx.lineWidth = pass.lw;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.filter = pass.lw > 4 ? `blur(${pass.lw * 0.5}px)` : 'none';

      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) {
        ctx.lineTo(pts[i].x, pts[i].y);
      }
      ctx.stroke();
      ctx.restore();
    }
  },
};

// ── 21. Bass Pulse Text ────────────────────────────────────────────────────
// Glyph dots swell on bass hits. Falls back to breathing animation.
const bassPulseText = {
  id: 'bass-pulse-text',
  name: 'Bass Pulse Text',
  description: 'Letterform dots swell with bass hits — text that breathes with the music',
  category: 'audio',
  defaultPalette: 'aurora',
  paletteId: 'aurora',
  font: 'Space Grotesk',
  textSize: 220,
  letterSpacing: 24,
  loopDuration: 3000,
  density: 0.35,

  render(ctx, canvas, time, glyphData, palette, audioData) {
    if (!glyphData || glyphData.allPoints.length === 0) return;
    const { allPoints, totalBbox } = glyphData;
    const TAU = Math.PI * 2;
    const ad = safeAudio(audioData);

    const bass      = ad.hasAudio ? ad.bass : 0.3 + 0.3 * Math.sin(time * TAU);
    const amplitude = ad.hasAudio ? ad.amplitude : 0.2 + 0.2 * Math.sin(time * TAU * 1.3);

    const cx = totalBbox.x + totalBbox.w / 2;
    const cy = totalBbox.y + totalBbox.h / 2;

    ctx.save();

    for (let i = 0; i < allPoints.length; i++) {
      const pt = allPoints[i];
      const dx = pt.x - cx;
      const dy = pt.y - cy;
      const dist = Math.sqrt(dx*dx + dy*dy);
      const maxDist = Math.max(totalBbox.w, totalBbox.h) / 2;
      const distNorm = clamp(dist / maxDist, 0, 1);

      // Dot radius pulses with bass
      const baseSize = 1.5;
      const sz = baseSize * (1 + bass * 3);

      // Jitter from amplitude — seeded per point
      const jitterSeed = Math.sin(i * 127.1 + 311.7) * 43758.5453;
      const jitterSeed2 = Math.sin(i * 269.5 + 183.3) * 43758.5453;
      const jAngle = (jitterSeed - Math.floor(jitterSeed)) * TAU;
      const jMag   = (jitterSeed2 - Math.floor(jitterSeed2));

      const x = pt.x + Math.cos(jAngle) * jMag * amplitude * 8;
      const y = pt.y + Math.sin(jAngle) * jMag * amplitude * 8;

      const col = lerpColor(palette.primary, palette.accent, distNorm);
      ctx.fillStyle = col;
      ctx.globalAlpha = 0.85 + 0.15 * bass;

      ctx.beginPath();
      ctx.arc(x, y, Math.max(0.5, sz), 0, TAU);
      ctx.fill();
    }

    ctx.restore();
  },
};

// ── 22. Frequency Rings ────────────────────────────────────────────────────
// 8 concentric rings whose radii react to frequency bands.
const frequencyRings = {
  id: 'frequency-rings',
  name: 'Frequency Rings',
  description: 'Concentric rings whose radii pulse with audio frequency bands',
  category: 'audio',
  needsGlyphs: false,
  defaultPalette: 'klimt',
  paletteId: 'klimt',
  font: 'Space Grotesk',
  textSize: 220,
  letterSpacing: 24,
  loopDuration: 5000,
  density: 0.1,

  render(ctx, canvas, time, glyphData, palette, audioData) {
    const w = canvas.width;
    const h = canvas.height;
    const TAU = Math.PI * 2;
    const cx = w / 2;
    const cy = h / 2;
    const ad = safeAudio(audioData);

    const amplitude = ad.hasAudio ? ad.amplitude : 0.3 + 0.2 * Math.sin(time * TAU);
    const baseRadius = Math.min(w, h) * 0.07;
    const NUM_RINGS = 8;

    // Palette colors array for interpolation across rings
    const colors = [palette.primary, palette.secondary, palette.accent, palette.text];

    ctx.save();

    for (let ri = 0; ri < NUM_RINGS; ri++) {
      let freqBoost;
      if (ad.hasAudio && ad.frequency) {
        const binIdx = ri * 32;
        freqBoost = (ad.frequency[Math.min(binIdx, ad.frequency.length - 1)] / 255) * 80;
      } else {
        // Staggered sine fallback
        const fallbackPhase = (ri / NUM_RINGS) * TAU;
        freqBoost = 30 + 30 * Math.sin(time * TAU * 1.5 + fallbackPhase);
      }

      const radius = baseRadius * (ri + 1) + freqBoost;

      // Slow rotation, modulated by amplitude
      const rotSpeed = 0.3 + ri * 0.05;
      const rotation = time * TAU * rotSpeed * (1 + amplitude * 2);

      // Color by ring index
      const colorT = ri / (NUM_RINGS - 1);
      const colIdx = colorT * (colors.length - 1);
      const colA = colors[Math.floor(colIdx)];
      const colB = colors[Math.min(Math.ceil(colIdx), colors.length - 1)];
      const ringColor = lerpColor(colA, colB, colIdx - Math.floor(colIdx));

      const lineWidth = 2 + freqBoost * 0.05;
      ctx.beginPath();
      ctx.arc(cx, cy, Math.max(1, radius), rotation, rotation + TAU * 0.95);
      ctx.strokeStyle = ringColor;
      ctx.lineWidth = lineWidth;
      ctx.globalAlpha = 0.6 + 0.4 * (ri / NUM_RINGS);
      ctx.lineCap = 'round';
      ctx.stroke();
    }

    ctx.restore();
  },
};

// ── 23. Waveform Typography ────────────────────────────────────────────────
// Glyph dots displaced in Y by the audio waveform. Falls back to procedural sine.
const waveformTypography = {
  id: 'waveform-typography',
  name: 'Waveform Typography',
  description: 'Letter dots ripple with audio waveform displacement',
  category: 'audio',
  defaultPalette: 'storm',
  paletteId: 'storm',
  font: 'Space Grotesk',
  textSize: 220,
  letterSpacing: 24,
  loopDuration: 4000,
  density: 0.35,

  render(ctx, canvas, time, glyphData, palette, audioData) {
    if (!glyphData || glyphData.allPoints.length === 0) return;
    const { allPoints, totalBbox } = glyphData;
    const TAU = Math.PI * 2;
    const ad = safeAudio(audioData);
    const w = canvas.width;

    const amplitude = ad.hasAudio ? ad.amplitude : 0.5;
    const waveform  = ad.hasAudio ? ad.waveform : null;
    // Read the actual buffer length rather than hardcoding 1024 — the engine
    // returns fftSize (2048) samples, so hardcoding caused the upper half of
    // the waveform buffer to be silently ignored.
    const WAVEFORM_LEN = waveform ? waveform.length : 2048;

    ctx.save();

    const cx = totalBbox.x + totalBbox.w / 2;
    const cy = totalBbox.y + totalBbox.h / 2;

    for (let i = 0; i < allPoints.length; i++) {
      const pt = allPoints[i];

      // Map point X to waveform sample index (clamped for safety)
      const waveIdx = Math.min(WAVEFORM_LEN - 1, Math.floor((pt.x / w) * WAVEFORM_LEN));
      let yOffset;
      if (waveform) {
        const sample = (waveform[waveIdx] - 128) / 128; // -1..1
        yOffset = sample * amplitude * 60;
      } else {
        // Procedural sine fallback: scrolling ripple
        yOffset = Math.sin(time * TAU * 2 + (pt.x / w) * TAU * 4) * 30;
      }

      const x = pt.x;
      const y = pt.y + yOffset;

      const dx = pt.x - cx;
      const dy = pt.y - cy;
      const distNorm = clamp(Math.sqrt(dx*dx + dy*dy) / (Math.max(totalBbox.w, totalBbox.h) / 2), 0, 1);

      ctx.fillStyle = lerpColor(palette.primary, palette.accent, distNorm);
      ctx.globalAlpha = 0.85;

      ctx.beginPath();
      ctx.arc(x, y, 1.8, 0, TAU);
      ctx.fill();
    }

    ctx.restore();
  },
};

// ── Shared edge-extraction helper (used by tubing-text and neon-wireframe) ──
function extractEdgePoints(allPoints, canvasW) {
  const occupied = new Set();
  for (const pt of allPoints) {
    occupied.add(pt.y * canvasW + pt.x);
  }
  const edge = [];
  for (const pt of allPoints) {
    const { x, y } = pt;
    if (!occupied.has((y - 1) * canvasW + x) ||
        !occupied.has((y + 1) * canvasW + x) ||
        !occupied.has(y * canvasW + (x - 1)) ||
        !occupied.has(y * canvasW + (x + 1))) {
      edge.push(pt);
    }
  }
  return edge;
}

// ── 24. ASCII Grid ─────────────────────────────────────────────────────────
// Canvas-filling grid of characters; character opacity driven by animated noise.
const asciiGrid = {
  id: 'ascii-grid',
  name: 'ASCII Grid',
  description: 'Canvas filled with an animated ASCII character grid driven by wave noise',
  category: 'geometry',
  defaultPalette: 'monochrome',
  paletteId: 'monochrome',
  font: 'Space Grotesk',
  textSize: 220,
  letterSpacing: 24,
  loopDuration: 6000,
  density: 0.1,

  params: {
    cellSize: 12,
    charset: 'standard', // 'standard' | 'dense' | 'blocks' | 'minimal'
  },

  _charsets: {
    standard: ' .:-=+*#%@',
    dense:    ' .:;i1tfLCG08@',
    blocks:   ' \u2591\u2592\u2593\u2588',
    minimal:  ' . * #',
  },

  render(ctx, canvas, time, glyphData, palette) {
    const w = canvas.width;
    const h = canvas.height;
    const TAU = Math.PI * 2;
    const cellSize = this.params.cellSize;
    const charset = this._charsets[this.params.charset] || this._charsets.standard;
    const numChars = charset.length;
    const freq = 0.008;

    ctx.save();
    ctx.font = `${Math.floor(cellSize * 0.9)}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const cols = Math.ceil(w / cellSize);
    const rows = Math.ceil(h / cellSize);

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const cx = col * cellSize + cellSize * 0.5;
        const cy = row * cellSize + cellSize * 0.5;

        // Layered sine noise field — scrolls with time
        const noise = Math.sin(col * freq * cellSize + time * TAU) *
                      Math.cos(row * freq * cellSize * 0.7 + time * TAU * 0.8);

        // Map noise [-1,1] → char index
        const norm = (noise + 1) / 2; // 0..1
        const charIdx = Math.floor(norm * (numChars - 1));
        const char = charset[charIdx];

        // Brighter (higher norm) = more opaque
        const alpha = clamp(norm * 0.9 + 0.05, 0.05, 0.95);

        ctx.globalAlpha = alpha;
        ctx.fillStyle = palette.primary;
        ctx.fillText(char, cx, cy);
      }
    }

    ctx.restore();
  },
};

// ── 25. Halftone ───────────────────────────────────────────────────────────
// Classic halftone printing pattern with dot radius driven by a scrolling noise field.
const halftone = {
  id: 'halftone',
  name: 'Halftone',
  description: 'Grid of circles whose radius pulses in undulating halftone waves',
  category: 'geometry',
  defaultPalette: 'monochrome',
  paletteId: 'monochrome',
  font: 'Space Grotesk',
  textSize: 220,
  letterSpacing: 24,
  loopDuration: 5000,
  density: 0.1,

  params: {
    gridSize: 18,   // px between grid points
    scale: 0.015,   // pattern scale
    contrast: 1.5,
  },

  render(ctx, canvas, time, glyphData, palette) {
    const w = canvas.width;
    const h = canvas.height;
    const TAU = Math.PI * 2;
    const { gridSize, scale, contrast } = this.params;

    ctx.save();
    ctx.fillStyle = palette.primary;

    const cols = Math.ceil(w / gridSize);
    const rows = Math.ceil(h / gridSize);

    for (let row = 0; row <= rows; row++) {
      for (let col = 0; col <= cols; col++) {
        const cx = col * gridSize;
        const cy = row * gridSize;

        // Primary wave
        const val = 0.5 + 0.5 * Math.sin(cx * scale + time * TAU) *
                                 Math.cos(cy * scale * 0.8 + time * TAU * 0.6);
        // Second wave for more complexity
        const val2 = 0.5 * Math.sin((cx + cy) * scale * 0.5 + time * TAU * 1.3);
        const v = clamp(val + val2 * 0.4, 0, 1);

        const radius = v * gridSize * 0.55 * contrast;
        if (radius < 0.5) continue;

        ctx.globalAlpha = 0.85;
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, TAU);
        ctx.fill();
      }
    }

    ctx.restore();
  },
};

// ── 26. Tubing Text ────────────────────────────────────────────────────────
// Letterform edges rendered as 3D tubes — rings of dots with perspective flattening.
const tubingText = {
  id: 'tubing-text',
  name: 'Tubing Text',
  description: 'Letterform edges rendered as rotating 3D neon-wireframe tubes',
  category: 'text',
  defaultPalette: 'vaporwave',
  paletteId: 'vaporwave',
  font: 'Space Grotesk',
  textSize: 220,
  letterSpacing: 24,
  loopDuration: 4000,
  density: 0.08,

  params: {
    tubeRadius: 8,
    rotSpeed: 0.8,
    bloom: true,
    colorMode: 'gradient', // 'gradient' | 'solid' | 'per-char'
  },

  _edgeCache: null,
  _edgeCacheKey: null,

  render(ctx, canvas, time, glyphData, palette) {
    if (!glyphData || glyphData.allPoints.length === 0) return;
    const { allPoints, perChar } = glyphData;
    const w = canvas.width;
    const TAU = Math.PI * 2;

    // Cache edges keyed by object identity
    if (this._edgeCacheKey !== allPoints) {
      this._edgeCache = extractEdgePoints(allPoints, w);
      this._edgeCacheKey = allPoints;
    }
    const edges = this._edgeCache;
    if (!edges || edges.length === 0) return;

    const { tubeRadius, rotSpeed, bloom, colorMode } = this.params;
    const numChars = perChar.length;

    ctx.save();

    for (let ei = 0; ei < edges.length; ei++) {
      const pt = edges[ei];

      // Rotation angle unique per edge point — animated with time
      const rotAngle = time * TAU * rotSpeed + pt.x * 0.03 + pt.y * 0.02;

      // Ellipse dimensions: width = tubeRadius*2, height foreshortened by |cos(angle)|
      const ellipseW = tubeRadius;
      const ellipseH = tubeRadius * Math.abs(Math.cos(rotAngle));

      // Stroke direction approximation — local angle using position hash
      const strokeAngle = Math.sin(pt.x * 0.05 + pt.y * 0.03) * Math.PI;

      // Pick color
      let col;
      if (colorMode === 'gradient') {
        col = lerpColor(palette.primary, palette.accent, pt.x / w);
      } else if (colorMode === 'per-char') {
        // Find which character this edge point belongs to
        let charIdx = 0;
        for (let ci = 0; ci < numChars; ci++) {
          const { bbox } = perChar[ci];
          if (pt.x >= bbox.x && pt.x <= bbox.x + bbox.w) { charIdx = ci; break; }
        }
        col = lerpColor(palette.primary, palette.accent, charIdx / Math.max(numChars - 1, 1));
      } else {
        col = palette.primary;
      }

      // Bloom: draw 3 ellipses at increasing size and decreasing opacity
      if (bloom) {
        for (let g = 2; g >= 0; g--) {
          const scale = 1 + g * 0.7;
          const alpha = g === 0 ? 0.75 : 0.08 + g * 0.05;
          ctx.save();
          ctx.globalAlpha = alpha;
          ctx.fillStyle = g === 0 ? col : palette.accent;
          ctx.translate(pt.x, pt.y);
          ctx.rotate(strokeAngle);
          ctx.beginPath();
          ctx.ellipse(0, 0, Math.max(0.5, ellipseW * scale), Math.max(0.5, ellipseH * scale), 0, 0, TAU);
          ctx.fill();
          ctx.restore();
        }
      } else {
        ctx.save();
        ctx.globalAlpha = 0.75;
        ctx.fillStyle = col;
        ctx.translate(pt.x, pt.y);
        ctx.rotate(strokeAngle);
        ctx.beginPath();
        ctx.ellipse(0, 0, Math.max(0.5, ellipseW), Math.max(0.5, ellipseH), 0, 0, TAU);
        ctx.fill();
        ctx.restore();
      }

      // Center spine dot — gives the wire look
      ctx.globalAlpha = 1.0;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 1.5, 0, TAU);
      ctx.fill();
    }

    ctx.restore();
  },
};

// ── 27. Dot Matrix ─────────────────────────────────────────────────────────
// Glyph pixels snapped to a regular LED matrix grid; dots pulse left-to-right.
const dotMatrix = {
  id: 'dot-matrix',
  name: 'Dot Matrix',
  description: 'Letterforms as a pulsing LED dot-matrix display',
  category: 'text',
  defaultPalette: 'retro',
  paletteId: 'retro',
  font: 'Space Grotesk',
  textSize: 220,
  letterSpacing: 24,
  loopDuration: 3000,
  density: 0.35,
  params: { cellSize: 6, dotRadius: 2.5 },

  render(ctx, canvas, time, glyphData, palette) {
    if (!glyphData || glyphData.allPoints.length === 0) return;
    const { allPoints, totalBbox } = glyphData;
    const w = canvas.width;
    const h = canvas.height;
    const TAU = Math.PI * 2;
    const CELL = this.params.cellSize;
    const DOT_R = this.params.dotRadius;

    ctx.save();

    // Build a Set of occupied cells (snap each point to cell grid)
    const occupied = new Set();
    for (const pt of allPoints) {
      const col = Math.round(pt.x / CELL);
      const row = Math.round(pt.y / CELL);
      occupied.add(row * 100000 + col);
    }

    const cols = Math.ceil(w / CELL);
    const rows = Math.ceil(h / CELL);

    for (let row = 0; row <= rows; row++) {
      for (let col = 0; col <= cols; col++) {
        const cx = col * CELL;
        const cy = row * CELL;
        const key = row * 100000 + col;

        if (occupied.has(key)) {
          // Active LED: pulsing brightness ripple left-to-right
          const alpha = 0.7 + 0.3 * Math.sin(time * TAU + cx * 0.04);
          ctx.globalAlpha = clamp(alpha, 0, 1);
          ctx.fillStyle = palette.primary;
          ctx.beginPath();
          ctx.arc(cx, cy, DOT_R, 0, TAU);
          ctx.fill();
        } else {
          // Inactive LED: dim background dot
          ctx.globalAlpha = 0.15;
          ctx.fillStyle = palette.primary;
          ctx.beginPath();
          ctx.arc(cx, cy, DOT_R * 0.7, 0, TAU);
          ctx.fill();
        }
      }
    }

    ctx.restore();
  },
};

// ── 28. Neon Wireframe ─────────────────────────────────────────────────────
// Edge points connected by thin lines + CRT scanline overlay on letterforms.
const neonWireframe = {
  id: 'neon-wireframe',
  name: 'Neon Wireframe',
  description: '3D wireframe letterforms with glowing edges and CRT scanlines',
  category: 'text',
  defaultPalette: 'cyberpunk',
  paletteId: 'cyberpunk',
  font: 'Space Grotesk',
  textSize: 220,
  letterSpacing: 24,
  loopDuration: 4000,
  density: 0.1,
  params: { threshold: 12, scanlineSpacing: 6 },

  _edgeCache: null,
  _edgeCacheKey: null,

  render(ctx, canvas, time, glyphData, palette) {
    if (!glyphData || glyphData.allPoints.length === 0) return;
    const { allPoints, perChar } = glyphData;
    const w = canvas.width;
    const h = canvas.height;
    const TAU = Math.PI * 2;
    const THRESHOLD = this.params.threshold; // max px between connected edge points

    // Cache edges
    if (this._edgeCacheKey !== allPoints) {
      this._edgeCache = extractEdgePoints(allPoints, w);
      this._edgeCacheKey = allPoints;
    }
    const edges = this._edgeCache;
    if (!edges || edges.length === 0) return;

    ctx.save();

    // Draw connecting lines between nearby edge points (two glow passes)
    const passes = [
      { lw: 2.5, alpha: 0.07 },
      { lw: 0.5, alpha: 0.55 },
    ];

    for (const pass of passes) {
      ctx.save();
      ctx.strokeStyle = palette.accent;
      ctx.lineWidth = pass.lw;
      ctx.lineCap = 'round';

      // Spatial bucketing: group points into grid cells of size THRESHOLD
      // so each point only checks its 3×3 neighborhood instead of all n points.
      const grid = new Map();
      for (let i = 0; i < edges.length; i++) {
        const p = edges[i];
        const key = `${Math.floor(p.x / THRESHOLD)}|${Math.floor(p.y / THRESHOLD)}`;
        if (!grid.has(key)) grid.set(key, []);
        grid.get(key).push(i);
      }

      for (let i = 0; i < edges.length; i++) {
        const a = edges[i];
        const cx = Math.floor(a.x / THRESHOLD);
        const cy = Math.floor(a.y / THRESHOLD);
        for (let nx = cx - 1; nx <= cx + 1; nx++) {
          for (let ny = cy - 1; ny <= cy + 1; ny++) {
            const neighbors = grid.get(`${nx}|${ny}`);
            if (!neighbors) continue;
            for (const j of neighbors) {
              if (j <= i) continue; // preserve i < j deduplication
              const b = edges[j];
              const dx = a.x - b.x;
              const dy = a.y - b.y;
              const dist = Math.sqrt(dx * dx + dy * dy);
              if (dist > THRESHOLD) continue;

              ctx.globalAlpha = pass.alpha * (1 - dist / THRESHOLD);
              ctx.beginPath();
              ctx.moveTo(a.x, a.y);
              ctx.lineTo(b.x, b.y);
              ctx.stroke();
            }
          }
        }
      }
      ctx.restore();
    }

    // CRT scanline overlay — horizontal lines clipped to letter bboxes
    const scanlineSpacing = this.params.scanlineSpacing; // px between scanlines
    const numChars = perChar.length;

    for (let ci = 0; ci < numChars; ci++) {
      const { bbox } = perChar[ci];
      if (bbox.w <= 0 || bbox.h <= 0) continue;

      // Phase-shift per character for independent animation
      const charPhase = ci / Math.max(numChars, 1);
      const scanOffset = (time + charPhase * 0.4) % 1 * scanlineSpacing;

      ctx.save();
      ctx.beginPath();
      ctx.rect(bbox.x, bbox.y, bbox.w, bbox.h);
      ctx.clip();

      ctx.strokeStyle = palette.primary;
      ctx.lineWidth = 0.5;

      const startY = bbox.y + (scanOffset % scanlineSpacing);
      for (let sy = startY; sy <= bbox.y + bbox.h; sy += scanlineSpacing) {
        const alpha = 0.06 + 0.04 * Math.sin(time * TAU * 2 + sy * 0.05);
        ctx.globalAlpha = clamp(alpha, 0, 1);
        ctx.beginPath();
        ctx.moveTo(bbox.x, sy);
        ctx.lineTo(bbox.x + bbox.w, sy);
        ctx.stroke();
      }
      ctx.restore();
    }

    ctx.restore();
  },
};

// ── 29. Pixel Rain ─────────────────────────────────────────────────────────
// Each glyph dot falls like a raindrop, then reforms — with short trail.
const pixelRain = {
  id: 'pixel-rain',
  name: 'Pixel Rain',
  description: 'Glyph pixels fall like rain with trails then reform from above',
  category: 'text',
  defaultPalette: 'storm',
  paletteId: 'storm',
  font: 'Space Grotesk',
  textSize: 220,
  letterSpacing: 24,
  loopDuration: 3500,
  density: 0.3,
  params: { fallDistance: 0.3, trailLength: 3 },

  render(ctx, canvas, time, glyphData, palette) {
    if (!glyphData || glyphData.allPoints.length === 0) return;
    const { allPoints } = glyphData;
    const h = canvas.height;
    const TAU = Math.PI * 2;
    const fallDist = h * this.params.fallDistance;

    ctx.save();

    for (let i = 0; i < allPoints.length; i++) {
      const pt = allPoints[i];

      // Per-point phase offset so drops stagger organically
      const dropPhase = (time + pt.x * 0.001 + pt.y * 0.0005) % 1;

      if (dropPhase >= 0.6) {
        // Resetting — invisible
        continue;
      }

      // Falling: [0, 0.6]
      const fallT = dropPhase / 0.6; // 0..1
      const fallY = pt.y + fallT * fallDist;
      const alpha = 1 - fallT * 0.8; // fades out as it falls

      // Color: primary near top → secondary near bottom of trail
      const col = lerpColor(palette.primary, palette.secondary, fallT);

      // Main dot
      ctx.globalAlpha = clamp(alpha, 0, 1);
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(pt.x, fallY, 2, 0, TAU);
      ctx.fill();

      // Trail: smaller dots above the main dot, decreasing opacity
      const trailStep = fallDist * 0.06;
      for (let tr = 1; tr <= this.params.trailLength; tr++) {
        const trailY = fallY - tr * trailStep;
        const trailAlpha = alpha * (1 - tr * 0.28);
        const trailR = 2 * (1 - tr * 0.25);
        if (trailAlpha <= 0 || trailR <= 0) continue;
        ctx.globalAlpha = clamp(trailAlpha, 0, 1);
        ctx.fillStyle = palette.primary;
        ctx.beginPath();
        ctx.arc(pt.x, trailY, trailR, 0, TAU);
        ctx.fill();
      }
    }

    ctx.restore();
  },
};

// ── Export ─────────────────────────────────────────────────────────────────
export const TEMPLATES = [
  // Text templates
  particleField,
  scatterReform,
  outlineFlow,
  perCharBlur,
  flip3D,
  neonTrace,
  waveMorph,
  gravityFall,
  typewriter,
  charOrbit,
  shatter,
  // Geometry templates
  auroraWave,
  voronoiField,
  flowField,
  kaleidoscope,
  concentricPulse,
  fractalNoise,
  truchetTiles,
  // Audio-reactive templates
  frequencyBars,
  oscilloscope,
  bassPulseText,
  frequencyRings,
  waveformTypography,
  // Geometry templates (new)
  asciiGrid,
  halftone,
  // Text templates (new)
  tubingText,
  dotMatrix,
  neonWireframe,
  pixelRain,
];

export const DEFAULT_TEMPLATE_ID = 'particle-field';
