/**
 * vite.config.js — AnimTypo
 *
 * COOP + COEP headers are required for SharedArrayBuffer, which ffmpeg.wasm
 * needs for its worker threads. Without them the FFmpeg instance fails with
 * "SharedArrayBuffer is not defined".
 *
 * We use COEP: credentialless (Chromium 96+) instead of require-corp because:
 *   - It still enables SharedArrayBuffer / cross-origin isolation in Chrome
 *   - It does NOT block cross-origin resources that lack CORP headers
 *     (e.g. Google Fonts, the preview iframe, unpkg CDN assets)
 *   - Firefox and Safari do not support credentialless yet, but those browsers
 *     can't run ffmpeg.wasm anyway — so this is the correct trade-off.
 *
 * require-corp would block the preview iframe and Google Fonts; credentialless
 * avoids both problems while still activating SharedArrayBuffer in Chrome.
 */
export default {
  server: {
    headers: {
      'Cross-Origin-Opener-Policy':   'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless',
    },
  },
  optimizeDeps: {
    exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'],
  },
  test: {
    environment: 'jsdom',
    globals: true,
    coverage: { provider: 'v8', reporter: ['text', 'html'] },
  },
};
