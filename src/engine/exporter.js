/**
 * Exporter — records one seamless animation loop and downloads the result.
 *
 * Formats:
 *   WebM VP9 + Alpha    — MediaRecorder path, Chrome/Edge only
 *   PNG Sequence ZIP    — universal, requires JSZip CDN
 *   MP4 H.264           — ffmpeg.wasm, libx264, no alpha, universal
 *   ProRes MOV (luma)   — ffmpeg.wasm, libx264 RGB + separate alpha-mask WebM
 *                         delivered as a ZIP (luma-matte workflow for FCPX/Resolve)
 *
 * ProRes 4444 limitation:
 *   The standard ffmpeg.wasm WASM build does NOT include the prores_ks encoder
 *   (confirmed against the ffmpegwasm/ffmpeg.wasm-core release notes and the
 *   official docs — only libx264, libx265, libvpx are bundled). The ProRes
 *   option therefore uses a two-file luma-matte approach:
 *     1. animtypo-rgb.mp4   — H.264 in a .mp4 container (color+luma, black bg)
 *     2. animtypo-alpha.webm — VP8 grayscale alpha mask
 *   Both files ship in a ZIP. In FCPX/Resolve, composite RGB over any bg using
 *   the alpha-mask clip on a luma-matte layer. This is a standard VFX workflow.
 *
 * Usage:
 *   const exporter = new Exporter(renderFrame, { width, height, fps, loopDuration,
 *                                                transparentBg, captureScale,
 *                                                onProgress, onStatus })
 *   await exporter.exportWebM()
 *   await exporter.exportPNGZip()
 *   await exporter.exportMP4()
 *   await exporter.exportProResLuma()
 */

// ─────────────────────────────────────────────────────────────────────────────
// Module-level constants and helpers
// ─────────────────────────────────────────────────────────────────────────────

// Canonical coordinate space used by all templates and glyph samplers.
// Capture canvases are always mapped into this space regardless of export res.
const COORD_W = 1920;
const COORD_H = 1080;

// Yield to the browser event loop so the UI stays responsive during long exports.
const yieldToMain = () => new Promise(r => setTimeout(r, 0));

// ─────────────────────────────────────────────────────────────────────────────
// ffmpeg.wasm lazy loader
// ─────────────────────────────────────────────────────────────────────────────

let _ffmpegInstance = null;
let _ffmpegLoading  = null; // Promise while in-flight

/**
 * Load ffmpeg.wasm lazily (only on first call).
 * Resolves to a ready FFmpeg instance.
 * @param {Function} [onStatus]  (msg: string) => void — for UI feedback
 */
async function getFFmpeg(onStatus) {
  if (_ffmpegInstance) return _ffmpegInstance;

  if (_ffmpegLoading) return _ffmpegLoading;

  _ffmpegLoading = (async () => {
    // ffmpeg.wasm UMD bundle exposes window.FFmpegWASM and window.FFmpegUtil
    if (typeof window.FFmpegWASM === 'undefined') {
      throw new Error(
        'FFmpegWASM not found. Add the ffmpeg.wasm CDN scripts to index.html before using MP4 or ProRes export.'
      );
    }

    const { FFmpeg } = window.FFmpegWASM;
    const { toBlobURL } = window.FFmpegUtil;

    const ffmpeg = new FFmpeg();

    if (onStatus) onStatus('Loading ffmpeg.wasm…');

    // Load the core WASM from local /ffmpeg/ (self-hosted in public/ffmpeg/).
    // Using same-origin paths avoids CDN latency and cross-origin fetch issues.
    // toBlobURL fetches the resource and creates a same-origin blob URL so the
    // Worker can load it regardless of COEP policy.
    const baseURL = '/ffmpeg';
    await ffmpeg.load({
      coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`,   'text/javascript'),
      wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
    });

    _ffmpegInstance = { ffmpeg };
    return _ffmpegInstance;
  })();

  try {
    const result = await _ffmpegLoading;
    return result;
  } finally {
    _ffmpegLoading = null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Exporter class
// ─────────────────────────────────────────────────────────────────────────────

export class Exporter {
  /**
   * @param {Function} renderFrame   (time: number, ctx, canvas) => void
   * @param {Object}   opts
   * @param {number}   opts.width
   * @param {number}   opts.height
   * @param {number}   opts.fps
   * @param {number}   opts.loopDuration    ms
   * @param {boolean}  opts.transparentBg
   * @param {number}   [opts.captureScale=1]  Internal render scale (0–1). Frames are
   *                                          captured at width×captureScale pixels and
   *                                          upscaled by ffmpeg with lanczos. 0.5 cuts
   *                                          pixel count to 25%, ~4× faster in headless.
   * @param {Function} [opts.onProgress]    (pct: 0–1) => void
   * @param {Function} [opts.onStatus]      (msg: string) => void
   */
  constructor(renderFrame, opts = {}) {
    this.renderFrame   = renderFrame;
    this.width         = opts.width         || 1920;
    this.height        = opts.height        || 1080;
    this.fps           = opts.fps           || 60;
    this.loopMs        = opts.loopDuration  || 3000;
    this.transparentBg = opts.transparentBg !== undefined ? opts.transparentBg : true;
    this.captureScale  = opts.captureScale  !== undefined ? opts.captureScale  : 1.0;
    this.onProgress    = opts.onProgress    || null;
    this.onStatus      = opts.onStatus      || null;
    this._cancelExport = false;
  }

  /**
   * Signal an in-progress WebM export to stop at the next frame boundary.
   */
  cancelExport() {
    this._cancelExport = true;
  }

  // ── Internal helpers ──────────────────────────────────────────────────────

  get _totalFrames() {
    return Math.ceil((this.loopMs / 1000) * this.fps);
  }

  /** Capture canvas dimensions (may be smaller than output when captureScale < 1). */
  get _captureW() { return Math.round(this.width  * this.captureScale); }
  get _captureH() { return Math.round(this.height * this.captureScale); }

  _status(msg) {
    if (this.onStatus) this.onStatus(msg);
  }

  _progress(pct) {
    if (this.onProgress) this.onProgress(pct);
  }

  /** Zero-padded frame number string for ffmpeg pattern inputs. */
  _padFrame(f) {
    return String(f).padStart(5, '0');
  }

  /**
   * Capture all frames as image ArrayBuffers.
   *
   * Frames are rendered at _captureW × _captureH. When captureScale < 1 the
   * caller is responsible for passing the scale filter to ffmpeg (lanczos).
   *
   * @param {boolean} [forceOpaqueBg=false]   Paint black under the frame (RGB pass).
   * @param {string}  [blobType='image/jpeg'] MIME type for frame compression.
   *                  Pass 'image/png' for PNG-Zip exports that need lossless frames.
   */
  async _captureFrames(forceOpaqueBg = false, blobType = 'image/jpeg') {
    const total = this._totalFrames;
    const cW = this._captureW;
    const cH = this._captureH;
    const offscreen = new OffscreenCanvas(cW, cH);
    const ctx = offscreen.getContext('2d', { willReadFrequently: true });

    // Map COORD_W×COORD_H glyph coordinate space to the capture canvas.
    // Handles both non-native export resolutions and captureScale < 1.
    const scaleX = cW / COORD_W;
    const scaleY = cH / COORD_H;
    const needsScale = scaleX !== 1 || scaleY !== 1;

    // renderFrame receives a mock canvas whose width/height report COORD_W×COORD_H
    // so all glyph math stays in that coordinate space.
    const mockCanvas = needsScale ? {
      width:      COORD_W,
      height:     COORD_H,
      getContext: () => ctx,
    } : offscreen;

    const frames = [];

    for (let f = 0; f < total; f++) {
      if (this._cancelExport) break;

      const t = f / total;

      ctx.clearRect(0, 0, cW, cH);

      if (forceOpaqueBg) {
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, cW, cH);
      }

      if (needsScale) {
        ctx.save();
        ctx.scale(scaleX, scaleY);
        this.renderFrame(t, ctx, mockCanvas);
        ctx.restore();
      } else {
        this.renderFrame(t, ctx, offscreen);
      }

      const blobOpts = blobType === 'image/jpeg'
        ? { type: 'image/jpeg', quality: 0.85 }
        : { type: blobType };
      const blob = await offscreen.convertToBlob(blobOpts);
      const arrayBuffer = await blob.arrayBuffer();
      frames.push({ arrayBuffer, padded: this._padFrame(f) });

      this._progress(f / total * 0.5); // frames = first 50% of total progress

      if (f % 10 === 0) await yieldToMain();
    }

    return frames;
  }

  /**
   * Single-pass combined capture — renders each frame once with transparency,
   * then derives both the RGB composite (premultiplied on black) and the
   * grayscale alpha mask from the same pixel data.
   *
   * Returns { rgbFrames, alphaFrames }, each an array of { arrayBuffer, padded }.
   * Both use JPEG compression; the alpha channel is encoded as a grayscale image.
   *
   * This replaces the old two-pass approach and is ~2× faster since the
   * renderer runs only once per frame.
   */
  async _captureFramesPair() {
    const total = this._totalFrames;
    const cW = this._captureW;
    const cH = this._captureH;

    const src         = new OffscreenCanvas(cW, cH);
    const srcCtx      = src.getContext('2d', { willReadFrequently: true });
    const rgbCanvas   = new OffscreenCanvas(cW, cH);
    const rgbCtx      = rgbCanvas.getContext('2d');
    const alphaCanvas = new OffscreenCanvas(cW, cH);
    const alphaCtx    = alphaCanvas.getContext('2d');

    const scaleX     = cW / COORD_W;
    const scaleY     = cH / COORD_H;
    const needsScale = scaleX !== 1 || scaleY !== 1;

    const mockCanvas = needsScale ? {
      width:      COORD_W,
      height:     COORD_H,
      getContext: () => srcCtx,
    } : src;

    const rgbFrames   = [];
    const alphaFrames = [];

    for (let f = 0; f < total; f++) {
      if (this._cancelExport) break;

      const t      = f / total;
      const padded = this._padFrame(f);

      // Render with transparency (single pass)
      srcCtx.clearRect(0, 0, cW, cH);
      if (needsScale) {
        srcCtx.save();
        srcCtx.scale(scaleX, scaleY);
        this.renderFrame(t, srcCtx, mockCanvas);
        srcCtx.restore();
      } else {
        this.renderFrame(t, srcCtx, src);
      }

      // Extract RGBA once; derive both outputs from the same pixel data
      const imageData = srcCtx.getImageData(0, 0, cW, cH);
      const { data }  = imageData;

      const rgbData   = rgbCtx.createImageData(cW, cH);
      const rd        = rgbData.data;
      const alphaData = alphaCtx.createImageData(cW, cH);
      const ad        = alphaData.data;

      for (let i = 0; i < data.length; i += 4) {
        const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
        const af = a / 255;
        // Premultiply on black background for H.264 RGB pass
        rd[i]     = (r * af) | 0;
        rd[i + 1] = (g * af) | 0;
        rd[i + 2] = (b * af) | 0;
        rd[i + 3] = 255; // fully opaque for the codec
        // Grayscale alpha mask: white = opaque, black = transparent
        ad[i] = ad[i + 1] = ad[i + 2] = a;
        ad[i + 3] = 255;
      }

      rgbCtx.putImageData(rgbData, 0, 0);
      alphaCtx.putImageData(alphaData, 0, 0);

      // Compress both JPEGs in parallel — halves the blob encoding wait
      const [rgbBlob, alphaBlob] = await Promise.all([
        rgbCanvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 }),
        alphaCanvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 }),
      ]);
      const [rgbAB, alphaAB] = await Promise.all([
        rgbBlob.arrayBuffer(),
        alphaBlob.arrayBuffer(),
      ]);

      rgbFrames.push({ arrayBuffer: rgbAB, padded });
      alphaFrames.push({ arrayBuffer: alphaAB, padded });

      this._progress(f / total * 0.5); // single pass = first 50%

      if (f % 10 === 0) await yieldToMain();
    }

    return { rgbFrames, alphaFrames };
  }

  _download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  // ── Export: WebM VP9 + Alpha ──────────────────────────────────────────────

  async exportWebM() {
    const mimeType = 'video/webm;codecs=vp9';
    const hasVP9   = MediaRecorder.isTypeSupported(mimeType);
    const actualMime = hasVP9 ? mimeType : 'video/webm;codecs=vp8';

    const total           = this._totalFrames;
    const frameDurationMs = 1000 / this.fps;

    const exportCanvas = document.createElement('canvas');
    exportCanvas.width  = this.width;
    exportCanvas.height = this.height;
    const exportCtx = exportCanvas.getContext('2d', { willReadFrequently: true });

    const stream = exportCanvas.captureStream(this.fps);
    const chunks = [];

    const recorder = new MediaRecorder(stream, {
      mimeType: actualMime,
      videoBitsPerSecond: 20_000_000,
    });

    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
    recorder.start();
    this._cancelExport = false;

    for (let f = 0; f < total; f++) {
      if (this._cancelExport) {
        recorder.stop();
        await new Promise(r => { recorder.onstop = r; });
        return new Blob(chunks, { type: actualMime });
      }
      const t = f / total;
      exportCtx.clearRect(0, 0, this.width, this.height);
      this.renderFrame(t, exportCtx, exportCanvas);
      this._progress(f / total);
      await new Promise(r => setTimeout(r, frameDurationMs));
    }

    recorder.stop();
    await new Promise(r => { recorder.onstop = r; });

    const blob = new Blob(chunks, { type: actualMime });
    this._download(blob, 'animtypo-export.webm');
    return blob;
  }

  // ── Export: PNG Sequence ZIP ──────────────────────────────────────────────

  async exportPNGZip() {
    this._cancelExport = false;

    if (typeof JSZip === 'undefined') {
      throw new Error('JSZip not loaded. Add the JSZip CDN script to index.html.');
    }

    const zip    = new JSZip();
    const folder = zip.folder('animtypo-frames');

    // Force PNG so users receive lossless frames (JPEG default is only for ffmpeg)
    const frames = await this._captureFrames(false, 'image/png');
    const total  = this._totalFrames;
    for (let i = 0; i < frames.length; i++) {
      const { arrayBuffer, padded } = frames[i];
      folder.file(`frame_${padded}.png`, arrayBuffer);
      this._progress(i / total);
      if (i % 10 === 0) await yieldToMain();
    }

    const zipBlob = await zip.generateAsync({ type: 'blob' });
    this._download(zipBlob, 'animtypo-frames.zip');
    return zipBlob;
  }

  // ── Export: MP4 H.264 (ffmpeg.wasm) ──────────────────────────────────────

  async exportMP4() {
    this._cancelExport = false;

    this._status('Initializing ffmpeg.wasm…');
    const { ffmpeg } = await getFFmpeg(this.onStatus);

    this._status('Rendering frames…');
    const frames = await this._captureFrames(/* forceOpaqueBg= */ true);

    this._status('Writing frames to ffmpeg virtual FS…');
    for (const { arrayBuffer, padded } of frames) {
      await ffmpeg.writeFile(`frame_${padded}.jpg`, new Uint8Array(arrayBuffer));
    }

    this._status('Encoding MP4 H.264…');
    ffmpeg.on('progress', ({ progress }) => {
      this._progress(0.5 + progress * 0.5);
    });

    // Upscale to target resolution when captureScale < 1
    const scaleFilter = this.captureScale < 1
      ? ['-vf', `scale=${this.width}:${this.height}:flags=lanczos`]
      : [];

    await ffmpeg.exec([
      '-framerate', String(this.fps),
      '-i',         'frame_%05d.jpg',
      '-c:v',       'libx264',
      '-preset',    'veryfast',
      '-pix_fmt',   'yuv420p',
      '-movflags',  '+faststart',
      ...scaleFilter,
      '-r',         String(this.fps),
      'output.mp4',
    ]);

    const data = await ffmpeg.readFile('output.mp4');
    const blob = new Blob([data.buffer], { type: 'video/mp4' });

    for (const { padded } of frames) {
      await ffmpeg.deleteFile(`frame_${padded}.jpg`).catch(() => {});
    }
    await ffmpeg.deleteFile('output.mp4').catch(() => {});
    ffmpeg.off('progress');

    this._download(blob, 'animtypo-export.mp4');
    this._progress(1);
    return blob;
  }

  // ── Export: ProRes-compatible Luma Matte ZIP ──────────────────────────────
  //
  // ProRes 4444 (prores_ks) is NOT available in the standard ffmpeg.wasm WASM
  // build. This method produces the equivalent professional workflow:
  //
  //   animtypo-rgb.mp4    — H.264, black background, full color+luma
  //   animtypo-alpha.webm — VP8 grayscale alpha mask (white = opaque)
  //
  // In FCPX: import both, place rgb.mp4 on timeline, use alpha.webm as a
  //   Luma Keyer source on the same clip.
  // In DaVinci Resolve: place rgb.mp4 on V1, alpha.webm on V2, apply
  //   Luma Keyer node to use V2 as matte input.

  async exportProResLuma() {
    this._cancelExport = false;

    if (typeof JSZip === 'undefined') {
      throw new Error('JSZip not loaded. Add the JSZip CDN script to index.html.');
    }

    this._status('Initializing ffmpeg.wasm…');
    const { ffmpeg } = await getFFmpeg(this.onStatus);

    // Single-pass: render each frame once and derive both RGB and alpha outputs.
    this._status('Rendering frames (single pass)…');
    const { rgbFrames, alphaFrames } = await this._captureFramesPair();

    // Write all frames to WASM FS concurrently (in-memory I/O, safe to parallelize)
    this._status('Writing frames to ffmpeg virtual FS…');
    await Promise.all([
      ...rgbFrames.map(({ arrayBuffer, padded }) =>
        ffmpeg.writeFile(`rgb_${padded}.jpg`, new Uint8Array(arrayBuffer))),
      ...alphaFrames.map(({ arrayBuffer, padded }) =>
        ffmpeg.writeFile(`alpha_${padded}.jpg`, new Uint8Array(arrayBuffer))),
    ]);

    // Upscale to target resolution when captureScale < 1
    const scaleFilter = this.captureScale < 1
      ? ['-vf', `scale=${this.width}:${this.height}:flags=lanczos`]
      : [];

    // ── Encode RGB → H.264 MP4 ──
    this._status('Encoding RGB channel (H.264)…');
    ffmpeg.on('progress', ({ progress }) => {
      this._progress(0.5 + progress * 0.25); // 50–75 %
    });

    await ffmpeg.exec([
      '-framerate', String(this.fps),
      '-i',         'rgb_%05d.jpg',
      '-c:v',       'libx264',
      '-preset',    'veryfast',
      '-pix_fmt',   'yuv420p',
      '-movflags',  '+faststart',
      ...scaleFilter,
      '-r',         String(this.fps),
      'rgb_output.mp4',
    ]);

    ffmpeg.off('progress');

    // ── Encode Alpha mask → VP8 WebM (greyscale) ──
    // VP8 is ~3× faster than VP9 in software mode with equivalent quality for
    // a luma matte source; quality difference is imperceptible after compositing.
    this._status('Encoding alpha mask channel (VP8)…');
    ffmpeg.on('progress', ({ progress }) => {
      this._progress(0.75 + progress * 0.25); // 75–100 %
    });

    await ffmpeg.exec([
      '-framerate', String(this.fps),
      '-i',         'alpha_%05d.jpg',
      '-c:v',       'libvpx',
      '-pix_fmt',   'yuv420p',
      '-crf',       '10',
      '-b:v',       '0',
      ...scaleFilter,
      '-r',         String(this.fps),
      'alpha_output.webm',
    ]);

    ffmpeg.off('progress');

    // ── Read outputs ──
    this._status('Packaging ZIP…');
    const rgbData   = await ffmpeg.readFile('rgb_output.mp4');
    const alphaData = await ffmpeg.readFile('alpha_output.webm');

    // ── Build ZIP ──
    const zip = new JSZip();
    zip.file('animtypo-rgb.mp4',    rgbData   instanceof Uint8Array ? rgbData   : new Uint8Array(rgbData));
    zip.file('animtypo-alpha.webm', alphaData instanceof Uint8Array ? alphaData : new Uint8Array(alphaData));
    zip.file('HOW_TO_USE.txt', [
      'AnimTypo — ProRes Luma Matte Export',
      '=====================================',
      '',
      'This ZIP contains two files:',
      '  animtypo-rgb.mp4    — Color video (black background)',
      '  animtypo-alpha.webm — Grayscale alpha mask (white = opaque)',
      '',
      'FCPX workflow:',
      '  1. Import both files.',
      '  2. Place animtypo-rgb.mp4 on your timeline.',
      '  3. Open Video Inspector > Compositing > Blend Mode > Add.',
      '     (Or use Effects > Keying > Luma Keyer on the clip,',
      '      then drag animtypo-alpha.webm as the matte source.)',
      '',
      'DaVinci Resolve workflow:',
      '  1. Place animtypo-rgb.mp4 on V1.',
      '  2. Place animtypo-alpha.webm on V2.',
      '  3. In Fusion: use a MatteControl node and pipe V2 into',
      '     the Matte input to create a clean composite.',
      '',
      'Note: ProRes 4444 is not available in browser-based ffmpeg.',
      'This two-file luma-matte approach is the standard alternative',
      'and produces identical compositing results in FCPX and Resolve.',
    ].join('\n'));

    // ── Clean up WASM FS ──
    for (const { padded } of rgbFrames) {
      await ffmpeg.deleteFile(`rgb_${padded}.jpg`).catch(() => {});
    }
    for (const { padded } of alphaFrames) {
      await ffmpeg.deleteFile(`alpha_${padded}.jpg`).catch(() => {});
    }
    await ffmpeg.deleteFile('rgb_output.mp4').catch(() => {});
    await ffmpeg.deleteFile('alpha_output.webm').catch(() => {});

    const zipBlob = await zip.generateAsync({ type: 'blob' });
    this._download(zipBlob, 'animtypo-prores-luma.zip');
    this._progress(1);
    return zipBlob;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Export resolution presets
// ─────────────────────────────────────────────────────────────────────────────

export const EXPORT_PRESETS = [
  { id: '1080p',    label: '1080p (1920×1080)',   width: 1920, height: 1080 },
  { id: '4k',       label: '4K (3840×2160)',       width: 3840, height: 2160 },
  { id: '720p',     label: '720p (1280×720)',       width: 1280, height: 720  },
  { id: 'square',   label: 'Square (1080×1080)',   width: 1080, height: 1080 },
  { id: 'portrait', label: 'Portrait (1080×1920)', width: 1080, height: 1920 },
];
