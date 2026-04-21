/**
 * Audio Panel — collapsible panel section for AudioEngine controls.
 *
 * Builds:
 *   - Drop zone / file picker (mp3, wav, ogg, m4a, flac)
 *   - Transport controls (play/pause/stop, time display) — shown after load
 *   - Mini waveform canvas (240×40) — static display of full file waveform
 *   - Live amplitude bar (240×8) — real-time RMS bar, updated in its own RAF
 *
 * Call: buildAudioPanel(panelEl, audioEngine)
 *
 * Styling uses the existing CSS custom properties from panel.css.
 * New audio-specific styles are injected via a <style> tag once.
 */

let _stylesInjected = false;
let _ampRafId = null; // module-level RAF id for the amplitude bar loop
let _teardown = null; // module-level teardown function exposed via teardownAudioPanel()

function injectStyles() {
  if (_stylesInjected) return;
  _stylesInjected = true;

  const style = document.createElement('style');
  style.textContent = `
    /* === Audio Panel === */
    .audio-drop-zone {
      position: relative;
      width: 100%;
      min-height: 72px;
      border: 1.5px dashed var(--border-light);
      border-radius: 6px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 4px;
      cursor: pointer;
      transition: border-color 0.2s, background 0.2s;
      padding: 14px 12px;
      box-sizing: border-box;
      background: var(--input-bg);
      text-align: center;
    }
    .audio-drop-zone:hover,
    .audio-drop-zone.drag-over {
      border-color: var(--accent);
      background: var(--accent-dim);
    }
    .audio-drop-zone input[type="file"] {
      position: absolute;
      inset: 0;
      opacity: 0;
      cursor: pointer;
      width: 100%;
      height: 100%;
      border: none;
      padding: 0;
      background: none;
    }
    .audio-drop-label {
      font-size: 11px;
      color: var(--text-secondary);
      pointer-events: none;
      line-height: 1.4;
    }
    .audio-drop-accent {
      font-size: 10px;
      color: var(--accent);
      pointer-events: none;
      opacity: 0.7;
    }
    .audio-filename {
      font-size: 11px;
      color: var(--accent);
      word-break: break-all;
      margin-top: 4px;
    }

    /* Transport */
    .audio-transport {
      display: none;
      flex-direction: column;
      gap: 10px;
      margin-top: 10px;
    }
    .audio-transport.is-loaded {
      display: flex;
    }
    .audio-transport-buttons {
      display: flex;
      gap: 6px;
    }
    .audio-btn {
      flex: 1;
      padding: 7px 0;
      background: var(--input-bg);
      border: 1px solid var(--border-light);
      border-radius: 4px;
      color: var(--text-secondary);
      font-size: 14px;
      cursor: pointer;
      transition: border-color 0.15s, color 0.15s, background 0.15s;
      line-height: 1;
    }
    .audio-btn:hover {
      border-color: var(--accent);
      color: var(--accent);
      background: var(--accent-dim);
    }
    .audio-btn.is-active {
      border-color: var(--accent);
      color: var(--accent);
      background: var(--accent-dim);
    }
    .audio-time-display {
      font-family: 'Courier New', monospace;
      font-size: 11px;
      color: var(--text-secondary);
      text-align: center;
    }

    /* Mini waveform */
    .audio-waveform-wrap {
      margin-top: 4px;
    }
    .audio-waveform-label {
      font-size: 10px;
      color: var(--text-dim);
      text-transform: uppercase;
      letter-spacing: 0.1em;
      margin-bottom: 4px;
    }
    .audio-waveform-canvas {
      display: block;
      width: 100%;
      height: 40px;
      border-radius: 4px;
      background: var(--input-bg);
      border: 1px solid var(--border-light);
    }

    /* Live amplitude bar */
    .audio-amp-wrap {
      margin-top: 8px;
    }
    .audio-amp-label {
      font-size: 10px;
      color: var(--text-dim);
      text-transform: uppercase;
      letter-spacing: 0.1em;
      margin-bottom: 4px;
    }
    .audio-amp-canvas {
      display: block;
      width: 100%;
      height: 8px;
      border-radius: 2px;
      background: var(--input-bg);
      border: 1px solid var(--border-light);
    }

    /* Info note */
    .audio-note {
      font-size: 10px;
      color: var(--text-dim);
      line-height: 1.5;
      margin-top: 10px;
      padding: 8px 10px;
      border-left: 2px solid var(--accent-dim);
      background: rgba(0,255,136,0.03);
      border-radius: 0 4px 4px 0;
    }
  `;
  document.head.appendChild(style);
}

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/**
 * Draw the static waveform of the decoded AudioBuffer onto a canvas.
 * Uses getChannelData(0) — downsampled to canvas width.
 */
function drawStaticWaveform(canvas, audioBuffer, accentColor) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const W = canvas.width;
  const H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  const data = audioBuffer.getChannelData(0);
  const step = Math.ceil(data.length / W);
  const cy = H / 2;

  ctx.strokeStyle = accentColor || '#00ff88';
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.85;
  ctx.beginPath();

  for (let x = 0; x < W; x++) {
    let max = -1;
    let min = 1;
    const start = x * step;
    const end = Math.min(start + step, data.length);
    for (let i = start; i < end; i++) {
      if (data[i] > max) max = data[i];
      if (data[i] < min) min = data[i];
    }
    const y1 = cy - max * (H / 2 - 2);
    const y2 = cy - min * (H / 2 - 2);
    if (x === 0) ctx.moveTo(x, y1);
    else ctx.lineTo(x, y1);
    ctx.lineTo(x, y2);
  }
  ctx.stroke();
  ctx.globalAlpha = 1;
}

/**
 * Tear down audio panel side-effects (RAF loop, time interval).
 * Call before navigating away from the editor.
 */
export function teardownAudioPanel() {
  if (_teardown) _teardown();
}

/**
 * Build and append the Audio panel section into panelEl.
 * @param {HTMLElement} panelEl   — the #panel element
 * @param {AudioEngine} audioEngine
 */
export function buildAudioPanel(panelEl, audioEngine) {
  injectStyles();

  // Stop any previous amplitude RAF (panel rebuild / navigation)
  if (_ampRafId !== null) {
    cancelAnimationFrame(_ampRafId);
    _ampRafId = null;
  }

  // ── Section shell (reuse existing makeSection pattern by building manually) ─
  const section = document.createElement('div');
  section.className = 'ctrl-section'; // collapsed by default

  const header = document.createElement('div');
  header.className = 'ctrl-section-header';

  const titleEl = document.createElement('span');
  titleEl.className = 'ctrl-section-title';
  titleEl.textContent = 'Audio';

  const arrow = document.createElement('span');
  arrow.className = 'collapse-arrow';
  arrow.textContent = '▶';

  header.appendChild(titleEl);
  header.appendChild(arrow);
  header.addEventListener('click', () => section.classList.toggle('is-open'));

  const body = document.createElement('div');
  body.className = 'ctrl-section-body';

  section.appendChild(header);
  section.appendChild(body);
  panelEl.appendChild(section);

  // ── Drop zone ──────────────────────────────────────────────────────────────
  const dropZone = document.createElement('div');
  dropZone.className = 'audio-drop-zone';

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = '.mp3,.wav,.ogg,.m4a,.flac,audio/*';
  fileInput.title = '';

  const dropLabel = document.createElement('div');
  dropLabel.className = 'audio-drop-label';
  dropLabel.textContent = 'Drop audio file here or click to browse';

  const dropAccent = document.createElement('div');
  dropAccent.className = 'audio-drop-accent';
  dropAccent.textContent = 'MP3 · WAV · OGG · M4A · FLAC';

  dropZone.appendChild(fileInput);
  dropZone.appendChild(dropLabel);
  dropZone.appendChild(dropAccent);
  body.appendChild(dropZone);

  // ── Transport ──────────────────────────────────────────────────────────────
  const transport = document.createElement('div');
  transport.className = 'audio-transport';
  body.appendChild(transport);

  const filenameEl = document.createElement('div');
  filenameEl.className = 'audio-filename';
  transport.appendChild(filenameEl);

  const buttons = document.createElement('div');
  buttons.className = 'audio-transport-buttons';

  const btnPlay  = document.createElement('button');
  btnPlay.className = 'audio-btn';
  btnPlay.textContent = '▶';
  btnPlay.title = 'Play';

  const btnPause = document.createElement('button');
  btnPause.className = 'audio-btn';
  btnPause.textContent = '⏸';
  btnPause.title = 'Pause';

  const btnStop  = document.createElement('button');
  btnStop.className = 'audio-btn';
  btnStop.textContent = '⏹';
  btnStop.title = 'Stop';

  buttons.appendChild(btnPlay);
  buttons.appendChild(btnPause);
  buttons.appendChild(btnStop);
  transport.appendChild(buttons);

  const timeDisplay = document.createElement('div');
  timeDisplay.className = 'audio-time-display';
  timeDisplay.textContent = '0:00 / 0:00';
  transport.appendChild(timeDisplay);

  // ── Static waveform ───────────────────────────────────────────────────────
  const waveformWrap = document.createElement('div');
  waveformWrap.className = 'audio-waveform-wrap';

  const waveformLabel = document.createElement('div');
  waveformLabel.className = 'audio-waveform-label';
  waveformLabel.textContent = 'Waveform';

  const waveformCanvas = document.createElement('canvas');
  waveformCanvas.className = 'audio-waveform-canvas';
  waveformCanvas.width  = 480; // 2× for sharpness on HiDPI
  waveformCanvas.height = 80;

  waveformWrap.appendChild(waveformLabel);
  waveformWrap.appendChild(waveformCanvas);
  transport.appendChild(waveformWrap);

  // ── Live amplitude bar ────────────────────────────────────────────────────
  const ampWrap = document.createElement('div');
  ampWrap.className = 'audio-amp-wrap';

  const ampLabel = document.createElement('div');
  ampLabel.className = 'audio-amp-label';
  ampLabel.textContent = 'Level';

  const ampCanvas = document.createElement('canvas');
  ampCanvas.className = 'audio-amp-canvas';
  ampCanvas.width  = 480;
  ampCanvas.height = 16;

  ampWrap.appendChild(ampLabel);
  ampWrap.appendChild(ampCanvas);
  transport.appendChild(ampWrap);

  // ── Note ──────────────────────────────────────────────────────────────────
  const note = document.createElement('div');
  note.className = 'audio-note';
  note.textContent = 'Audio-reactive templates respond to this signal automatically.';
  body.appendChild(note);

  // ── Amplitude RAF ─────────────────────────────────────────────────────────
  const ampCtx = ampCanvas.getContext('2d');

  function drawAmpBar() {
    _ampRafId = requestAnimationFrame(drawAmpBar);
    if (!ampCtx) return;
    const W = ampCanvas.width;
    const H = ampCanvas.height;

    // Skip expensive analyser read when audio is not playing — just clear
    if (!audioEngine.isPlaying) {
      ampCtx.clearRect(0, 0, W, H);
      return;
    }

    const amp = audioEngine.getAmplitude(); // 0–1

    ampCtx.clearRect(0, 0, W, H);

    // Background
    ampCtx.fillStyle = 'rgba(0,0,0,0.3)';
    ampCtx.fillRect(0, 0, W, H);

    // Filled bar
    const fillW = Math.round(amp * W);
    if (fillW > 0) {
      const grad = ampCtx.createLinearGradient(0, 0, W, 0);
      grad.addColorStop(0, '#00ff88');
      grad.addColorStop(0.7, '#00cc77');
      grad.addColorStop(1, '#ff4444');
      ampCtx.fillStyle = grad;
      ampCtx.fillRect(0, 0, fillW, H);
    }
  }
  _ampRafId = requestAnimationFrame(drawAmpBar);

  // ── Time display update ───────────────────────────────────────────────────
  let _timeInterval = null;

  function startTimeUpdate() {
    if (_timeInterval !== null) return;
    _timeInterval = setInterval(() => {
      const cur = audioEngine.currentTime;
      const dur = audioEngine.duration;
      timeDisplay.textContent = `${formatTime(cur)} / ${formatTime(dur)}`;
    }, 250);
  }

  function stopTimeUpdate() {
    if (_timeInterval !== null) {
      clearInterval(_timeInterval);
      _timeInterval = null;
    }
  }

  // ── File load handler ─────────────────────────────────────────────────────
  async function handleFile(file) {
    if (!file) return;

    dropLabel.textContent = 'Loading…';
    dropAccent.textContent = '';

    try {
      await audioEngine.loadFile(file);

      // Show filename
      filenameEl.textContent = file.name;

      // Draw static waveform
      const buf = audioEngine.getAudioBuffer();
      if (buf) {
        drawStaticWaveform(waveformCanvas, buf, '#00ff88');
      }

      // Show transport
      transport.classList.add('is-loaded');

      // Update drop zone label
      dropLabel.textContent = 'File loaded — drop new file to replace';
      dropAccent.textContent = '';

      // Update time display
      timeDisplay.textContent = `0:00 / ${formatTime(audioEngine.duration)}`;
      startTimeUpdate();

    } catch (err) {
      console.error('AudioEngine: loadFile failed', err);
      dropLabel.textContent = 'Failed to load audio file';
      dropAccent.textContent = err.message || '';
    }
  }

  fileInput.addEventListener('change', () => {
    const file = fileInput.files[0];
    if (file) handleFile(file);
  });

  // Drag and drop
  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
  });
  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('drag-over');
  });
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (!file) return;
    // Reject non-audio files before calling decodeAudioData to avoid raw DOMException
    if (!file.type.startsWith('audio/') && !file.name.match(/\.(mp3|wav|ogg|m4a|flac)$/i)) {
      dropLabel.textContent = 'Only audio files are supported (MP3, WAV, OGG, M4A, FLAC).';
      dropLabel.style.color = '#ff4444';
      return;
    }
    dropLabel.style.color = '';
    handleFile(file);
  });

  // ── Transport button handlers ─────────────────────────────────────────────
  function syncButtons() {
    btnPlay.classList.toggle('is-active', audioEngine.isPlaying);
    btnPause.classList.toggle('is-active', !audioEngine.isPlaying && audioEngine.currentTime > 0);
  }

  btnPlay.addEventListener('click', async () => {
    await audioEngine.play();
    startTimeUpdate();
    syncButtons();
  });

  btnPause.addEventListener('click', () => {
    audioEngine.pause();
    stopTimeUpdate();
    syncButtons();
  });

  btnStop.addEventListener('click', () => {
    stopTimeUpdate();
    audioEngine.stop();
    timeDisplay.textContent = `0:00 / ${formatTime(audioEngine.duration)}`;
    syncButtons();
  });

  // Wire onEnded callback so interval and buttons update when audio finishes naturally
  audioEngine.onEnded = () => {
    stopTimeUpdate();
    syncButtons();
  };

  // Register module-level teardown for navigation (cancels RAF + interval)
  _teardown = () => {
    stopTimeUpdate();
    if (_ampRafId !== null) {
      cancelAnimationFrame(_ampRafId);
      _ampRafId = null;
    }
  };
}
