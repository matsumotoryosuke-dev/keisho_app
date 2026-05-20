import { chromium } from 'playwright';
import path from 'path';
import os from 'os';

const DEFAULT_APP_URL = process.env.KEISHO_URL || 'http://localhost:5173';

/**
 * Launch headless Chromium, load the 形象 app in headless mode,
 * wait for the auto-triggered export download, save to outputPath.
 *
 * @param {object} opts
 * @param {string} opts.text
 * @param {string} opts.template
 * @param {string} [opts.palette]
 * @param {'webm'|'png-zip'|'mp4'|'prores'} [opts.format='webm']
 * @param {'720p'|'1080p'|'4k'|'square'|'portrait'} [opts.resolution='1080p']
 * @param {number} [opts.loopDuration=4]
 * @param {string} [opts.outputPath]
 * @param {string} [opts.appUrl]
 */
export async function renderAnimation({
  text,
  template,
  palette,
  format = 'webm',
  resolution = '1080p',
  loopDuration = 4,
  outputPath,
  appUrl = DEFAULT_APP_URL,
}) {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();

  // Forward headless progress/error lines from the browser console
  page.on('console', msg => {
    const text = msg.text();
    if (text.startsWith('[headless]')) process.stderr.write(text + '\n');
  });
  page.on('pageerror', err => process.stderr.write(`[headless:error] ${err.message}\n`));
  page.on('requestfailed', req => {
    const url = req.url();
    if (url.includes('ffmpeg') || url.includes('localhost')) {
      process.stderr.write(`[headless:reqfail] ${url} — ${req.failure()?.errorText}\n`);
    }
  });

  // Build URL
  // Query string (before #): headless control params
  // Hash (after #): app router params (template, palette)
  const qp = new URLSearchParams({
    headless: '1',
    text,
    format,
    resolution,
    loopDuration: String(loopDuration),
  });
  const hp = new URLSearchParams({ template });
  if (palette) hp.set('palette', palette);

  const url = `${appUrl}/?${qp}#/editor?${hp}`;

  // Derive file extension
  const ext = (format === 'png-zip' || format === 'prores') ? 'zip' : format;
  const timestamp = Date.now();
  const finalPath = outputPath || path.join(os.homedir(), 'Downloads', `keisho-${timestamp}.${ext}`);

  let download;
  try {
    [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 300_000 }),
      page.goto(url, { waitUntil: 'domcontentloaded' }),
    ]);
  } catch (err) {
    await browser.close();
    throw new Error(`Render timed out or app unreachable at ${appUrl}. Is 'npm run dev' running? (${err.message})`);
  }

  await download.saveAs(finalPath);
  await browser.close();

  return { success: true, path: finalPath, template, palette: palette || 'default', format, resolution, text };
}
