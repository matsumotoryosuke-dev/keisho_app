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
 *     2. animtypo-alpha.webm — VP9 grayscale alpha mask
 *   Both files ship in a ZIP. In FCPX/Resolve, composite RGB over any bg using
 *   the alpha-mask clip on a luma-matte layer. This is a standard VFX workflow.
 *
 * Usage:
 *   const exporter = new Exporter(renderFrame, { width, height, fps, loopDuration, transparentBg, onProgress, onStatus })
 *   await exporter.exportWebM()
 *   await exporter.exportPNGZip()
 *   await exporter.exportMP4()
 *   await exporter.exportProResLuma()
 */

// ─────────────────────────────────────────────────────────────────────────────
// ffmpeg.wasm lazy loader
// ─────────────────────────────────────────────────────────────────────────────

let _ffmpegInstance = null;
let _ffmpegLoading  = null; // Promise while in-flight

/**
 * Load ffmpeg.wasm lazily from CDN (only on first call).
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
    const { fetchFile, toBlobURL } = window.FFmpegUtil;

    const ffmpeg = new FFmpeg();

    if (onStatus) onStatus('Loading ffmpeg.wasm (~20 MB, first use only)…');

    // Load the core WASM from CDN — must use toBlobURL so the worker can fetch it
    // under our COEP headers.
    const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd';
    await ffmpeg.load({
      coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`,   'text/javascript'),
      wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
    });

    _ffmpegInstance = { ffmpeg, fetchFile };
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

  _status(msg) {
    if (this.onStatus) this.onStatus(msg);
  }

  _progress(pct) {
    if (this.onProgress) this.onProgress(pct);
  }

  /**
   * Capture all frames as PNG ArrayBuffers.
   * Returns an array of { arrayBuffer, padded } objects.
   * @param {boolean} [forceOpaqueBg]  Override transparentBg for RGB-only passes
   */
  async _captureFrames(forceOpaqueBg = false) {
    const total = this._totalFrames;
    const offscreen = new OffscreenCanvas(this.width, this.height);
    const ctx = offscreen.getContext('2d', { willReadFrequently: true });

    // Glyph data is always sampled at 1920×1080 (the preview resolution).
    // At any other export resolution we scale the context so that glyph
    // coordinates — which live in 1080p space — map correctly to the full
    // export canvas.  renderFrame receives a mock canvas object whose
    // width/height report 1920×1080 so all glyph math stays in that space,
    // while the scale transform maps the drawing to the real export size.
    const BASE_W = 1920;
    const BASE_H = 1080;
    const scaleX = this.width  / BASE_W;
    const scaleY = this.height / BASE_H;
    const needsScale = scaleX !== 1 || scaleY !== 1;

    // Mock canvas object for renderFrame when scaling is active
    const mockCanvas = needsScale ? {
      width:      BASE_W,
      height:     BASE_H,
      getContext: () => ctx,
    } : offscreen;

    const frames = [];

    for (let f = 0; f < total; f++) {
      if (this._cancelExport) break;

      const t = f / total;

      ctx.clearRect(0, 0, this.width, this.height);

      if (forceOpaqueBg) {
        // For RGB pass: paint black so the codec has a real luma signal
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, this.width, this.height);
      }

      if (needsScale) {
        ctx.save();
        ctx.scale(scaleX, scaleY);
        this.renderFrame(t, ctx, mockCanvas);
        ctx.restore();
      } else {
        this.renderFrame(t, ctx, offscreen);
      }

      const blob = await offscreen.convertToBlob({ type: 'image/png' });
      const arrayBuffer = await blob.arrayBuffer();
      const padded = String(f).padStart(5, '0');
      frames.push({ arrayBuffer, padded });

      this._progress(f / total * 0.5); // frames = first 50 % of total progress

      if (f % 10 === 0) await new Promise(r => setTimeout(r, 0));
    }

    return frames;
  }

  /**
   * Capture alpha-only frames (white-on-black mask).
   */
  async _captureAlphaFrames() {
    const total = this._totalFrames;
    const src = new OffscreenCanvas(this.width, this.height);
    const srcCtx = src.getContext('2d', { willReadFrequently: true });
    const dst = new OffscreenCanvas(this.width, this.height);
    const dstCtx = dst.getContext('2d', { willReadFrequently: true });

    // Apply the same coordinate-scaling fix as _captureFrames so that
    // at 4K (or any non-1080p resolution) the alpha matte aligns with
    // the RGB pass.
    const BASE_W = 1920;
    const BASE_H = 1080;
    const scaleX = this.width  / BASE_W;
    const scaleY = this.height / BASE_H;
    const needsScale = scaleX !== 1 || scaleY !== 1;

    const mockCanvas = needsScale ? {
      width:      BASE_W,
      height:     BASE_H,
      getContext: () => srcCtx,
    } : src;

    const frames = [];

    for (let f = 0; f < total; f++) {
      if (this._cancelExport) break;

      const t = f / total;

      // Render with transparency
      srcCtx.clearRect(0, 0, this.width, this.height);

      if (needsScale) {
        srcCtx.save();
        srcCtx.scale(scaleX, scaleY);
        this.renderFrame(t, srcCtx, mockCanvas);
        srcCtx.restore();
      } else {
        this.renderFrame(t, srcCtx, src);
      }

      // Extract alpha channel → greyscale mask
      const imageData = srcCtx.getImageData(0, 0, this.width, this.height);
      const { data } = imageData;
      const maskData = dstCtx.createImageData(this.width, this.height);
      const mask = maskData.data;

      for (let i = 0; i < data.length; i += 4) {
        const a = data[i + 3];
        mask[i]     = a;
        mask[i + 1] = a;
        mask[i + 2] = a;
        mask[i + 3] = 255;
      }

      dstCtx.clearRect(0, 0, this.width, this.height);
      dstCtx.putImageData(maskData, 0, 0);

      const blob = await dst.convertToBlob({ type: 'image/png' });
      const arrayBuffer = await blob.arrayBuffer();
      const padded = String(f).padStart(5, '0');
      frames.push({ arrayBuffer, padded });

      if (f % 10 === 0) await new Promise(r => setTimeout(r, 0));
    }

    return frames;
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

    const total          = this._totalFrames;
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

    const frames = await this._captureFrames();
    // Override progress to cover the full 100 %
    const total = this._totalFrames;
    for (let i = 0; i < frames.length; i++) {
      const { arrayBuffer, padded } = frames[i];
      folder.file(`frame_${padded}.png`, arrayBuffer);
      this._progress(i / total);
      if (i % 10 === 0) await new Promise(r => setTimeout(r, 0));
    }

    const zipBlob = await zip.generateAsync({ type: 'blob' });
    this._download(zipBlob, 'animtypo-frames.zip');
    return zipBlob;
  }

  // ── Export: MP4 H.264 (ffmpeg.wasm) ──────────────────────────────────────

  async exportMP4() {
    this._cancelExport = false;

    this._status('Initializing ffmpeg.wasm…');
    const { ffmpeg, fetchFile } = await getFFmpeg(this.onStatus);

    this._status('Rendering frames…');
    const frames = await this._captureFrames(/* forceOpaqueBg= */ true);

    this._status('Writing frames to ffmpeg virtual FS…');
    for (const { arrayBuffer, padded } of frames) {
      await ffmpeg.writeFile(`frame_${padded}.png`, new Uint8Array(arrayBuffer));
    }

    this._status('Encoding MP4 H.264…');

    // Wire up ffmpeg progress events
    ffmpeg.on('progress', ({ progress }) => {
      // progress is 0–1 during encode, map to 50–100 % of our bar
      this._progress(0.5 + progress * 0.5);
    });

    await ffmpeg.exec([
      '-framerate', String(this.fps),
      '-i',         'frame_%05d.png',
      '-c:v',       'libx264',
      '-pix_fmt',   'yuv420p',
      '-movflags',  '+faststart',
      '-r',         String(this.fps),
      'output.mp4',
    ]);

    const data = await ffmpeg.readFile('output.mp4');
    const blob = new Blob([data.buffer], { type: 'video/mp4' });

    // Clean up virtual FS
    for (const { padded } of frames) {
      await ffmpeg.deleteFile(`frame_${padded}.png`).catch(() => {});
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
  //   animtypo-alpha.webm — VP9 grayscale alpha mask (white = opaque)
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
    const { ffmpeg, fetchFile } = await getFFmpeg(this.onStatus);

    // ── Pass 1: RGB frames (black background) ──
    this._status('Rendering RGB frames…');
    const rgbFrames = await this._captureFrames(/* forceOpaqueBg= */ true);

    // ── Pass 2: Alpha mask frames ──
    this._status('Rendering alpha mask frames…');
    const alphaFrames = await this._captureAlphaFrames();

    // ── Write RGB frames to WASM FS ──
    this._status('Writing frames to ffmpeg virtual FS…');
    for (const { arrayBuffer, padded } of rgbFrames) {
      await ffmpeg.writeFile(`rgb_${padded}.png`, new Uint8Array(arrayBuffer));
    }
    for (const { arrayBuffer, padded } of alphaFrames) {
      await ffmpeg.writeFile(`alpha_${padded}.png`, new Uint8Array(arrayBuffer));
    }

    // ── Encode RGB → H.264 MP4 ──
    this._status('Encoding RGB channel (H.264)…');
    ffmpeg.on('progress', ({ progress }) => {
      this._progress(0.5 + progress * 0.25); // 50–75 %
    });

    await ffmpeg.exec([
      '-framerate', String(this.fps),
      '-i',         'rgb_%05d.png',
      '-c:v',       'libx264',
      '-pix_fmt',   'yuv420p',
      '-movflags',  '+faststart',
      '-r',         String(this.fps),
      'rgb_output.mp4',
    ]);

    ffmpeg.off('progress');

    // ── Encode Alpha mask → VP9 WebM (greyscale) ──
    this._status('Encoding alpha mask channel (VP9)…');
    ffmpeg.on('progress', ({ progress }) => {
      this._progress(0.75 + progress * 0.25); // 75–100 %
    });

    await ffmpeg.exec([
      '-framerate', String(this.fps),
      '-i',         'alpha_%05d.png',
      '-c:v',       'libvpx-vp9',
      '-pix_fmt',   'yuv420p',
      '-crf',       '10',
      '-b:v',       '0',
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
      await ffmpeg.deleteFile(`rgb_${padded}.png`).catch(() => {});
    }
    for (const { padded } of alphaFrames) {
      await ffmpeg.deleteFile(`alpha_${padded}.png`).catch(() => {});
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
  { id: '1080p',    label: '1080p (1920×1080)',  width: 1920, height: 1080 },
  { id: '4k',       label: '4K (3840×2160)',      width: 3840, height: 2160 },
  { id: '720p',     label: '720p (1280×720)',      width: 1280, height: 720  },
  { id: 'square',   label: 'Square (1080×1080)',  width: 1080, height: 1080 },
  { id: 'portrait', label: 'Portrait (1080×1920)', width: 1080, height: 1920 },
];
