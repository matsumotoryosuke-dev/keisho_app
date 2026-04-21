/**
 * GlyphSampler — renders text offscreen and extracts pixel positions where
 * the letterforms are opaque. Returns a point cloud that templates animate.
 *
 * Cache: sampling is expensive (getImageData on 1920×1080). We cache the
 * last result and only re-sample when text, font, fontSize, or letterSpacing changes.
 */

// ── Cache ──────────────────────────────────────────────────────────────────
let _cache = null; // { key, result }

function cacheKey(text, font, fontSize, letterSpacing, canvasW, canvasH, density) {
  return `${text}|${font}|${fontSize}|${letterSpacing}|${canvasW}|${canvasH}|${density}`;
}

// ── Offscreen canvas (reused) ──────────────────────────────────────────────
let _offscreen = null;
let _offCtx    = null;
let _offW      = 0;
let _offH      = 0;

function ensureOffscreen(w, h) {
  if (_offscreen && _offW === w && _offH === h) return;
  _offscreen = new OffscreenCanvas(w, h);
  _offCtx    = _offscreen.getContext('2d', { willReadFrequently: true });
  _offW      = w;
  _offH      = h;
}

// ── Per-character layout helper ────────────────────────────────────────────
/**
 * Compute where each character lands on the canvas using the same layout logic
 * as TextLayer.render(), returning [{char, x, y, width}].
 */
function computeCharLayout(ctx, text, fontSize, letterSpacing, canvasW, canvasH) {
  const layout = [];
  const lines   = text.split('\n');
  const lineHeight = fontSize * 1.15;
  const totalHeight = lines.length * lineHeight;
  const startY = (canvasH - totalHeight) / 2 + lineHeight / 2;

  lines.forEach((line, lineIdx) => {
    const chars  = line.split('');
    const y      = startY + lineIdx * lineHeight;
    const widths = chars.map(ch => ctx.measureText(ch).width);

    let totalWidth = widths.reduce((a, b) => a + b, 0);
    if (chars.length > 1) totalWidth += letterSpacing * (chars.length - 1);

    const startX = (canvasW - totalWidth) / 2; // center align

    let curX = startX;
    chars.forEach((ch, i) => {
      layout.push({ char: ch, x: curX, y, width: widths[i], lineIdx });
      curX += widths[i] + letterSpacing;
    });
  });

  return layout;
}

// ── Main export ────────────────────────────────────────────────────────────
/**
 * Sample glyph pixels from an offscreen canvas.
 *
 * @param {string}  text
 * @param {string}  font           — font family name (e.g. 'Space Grotesk')
 * @param {number}  fontSize       — px
 * @param {number}  letterSpacing  — extra px between chars
 * @param {number}  canvasW        — target canvas width (1920)
 * @param {number}  canvasH        — target canvas height (1080)
 * @param {number}  [density=0.25] — fraction of opaque pixels to keep (0–1)
 *
 * @returns {{
 *   allPoints:  Array<{x:number, y:number}>,
 *   perChar:    Array<{char:string, points:Array<{x:number,y:number}>, bbox:{x:number,y:number,w:number,h:number}}>,
 *   totalBbox:  {x:number, y:number, w:number, h:number}
 * }}
 */
export function sampleGlyphPixels(
  text, font, fontSize, letterSpacing, canvasW, canvasH, density = 0.25
) {
  const key = cacheKey(text, font, fontSize, letterSpacing, canvasW, canvasH, density);
  if (_cache && _cache.key === key) return _cache.result;

  ensureOffscreen(canvasW, canvasH);
  const ctx = _offCtx;

  // ── Draw text offscreen ────────────────────────────────────────────────
  ctx.clearRect(0, 0, canvasW, canvasH);
  const fontString = `${fontSize}px '${font}'`;
  ctx.font        = fontString;
  ctx.fillStyle   = '#ffffff';
  ctx.textBaseline = 'middle';
  ctx.textAlign   = 'left';

  // Compute layout first (needs ctx.measureText)
  const charLayout = computeCharLayout(ctx, text, fontSize, letterSpacing, canvasW, canvasH);

  // Draw every character
  charLayout.forEach(({ char, x, y }) => {
    ctx.fillText(char, x, y);
  });

  // ── Extract all opaque pixels ──────────────────────────────────────────
  const imageData = ctx.getImageData(0, 0, canvasW, canvasH);
  const data      = imageData.data;

  // Subsample step: keep every Nth opaque pixel
  // density=0.25 → keep ~25% of opaque pixels
  // We use a deterministic grid skip rather than random, to avoid noise.
  const step = Math.max(1, Math.round(1 / density));

  // Build per-character pixel lists using bbox tests
  // First compute per-char bboxes from the layout
  // Bbox: from x to x+width, from y-fontSize/2 to y+fontSize/2
  const halfH = fontSize * 0.6; // slightly generous vertical extent

  const perCharData = charLayout.map(({ char, x, y, width }) => ({
    char,
    bbox: { x: Math.floor(x), y: Math.floor(y - halfH), w: Math.ceil(width), h: Math.ceil(halfH * 2) },
    points: [],
  }));

  const allPoints = [];
  let pixelIdx = 0;

  for (let py = 0; py < canvasH; py++) {
    for (let px = 0; px < canvasW; px++) {
      const i = (py * canvasW + px) * 4;
      const alpha = data[i + 3];
      if (alpha < 128) continue;

      pixelIdx++;
      if (pixelIdx % step !== 0) continue;

      const pt = { x: px, y: py };
      allPoints.push(pt);

      // Assign to character by bbox overlap
      for (const cd of perCharData) {
        const { bbox } = cd;
        if (px >= bbox.x && px <= bbox.x + bbox.w &&
            py >= bbox.y && py <= bbox.y + bbox.h) {
          cd.points.push(pt);
          break; // assign to first matching char only
        }
      }
    }
  }

  // Compute total bounding box
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const pt of allPoints) {
    if (pt.x < minX) minX = pt.x;
    if (pt.y < minY) minY = pt.y;
    if (pt.x > maxX) maxX = pt.x;
    if (pt.y > maxY) maxY = pt.y;
  }

  const totalBbox = allPoints.length > 0
    ? { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
    : { x: 0, y: 0, w: canvasW, h: canvasH };

  const result = {
    allPoints,
    perChar: perCharData,
    totalBbox,
  };

  _cache = { key, result };
  return result;
}

/**
 * Force-invalidate the cache (call when text/font/size changes).
 * The sampler auto-invalidates by cache key, so this is only needed
 * if you want to free the memory immediately.
 */
export function invalidateGlyphCache() {
  _cache = null;
}
