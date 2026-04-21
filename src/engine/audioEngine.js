/**
 * AudioEngine — wraps the Web Audio API for AnimTypo.
 *
 * Usage:
 *   const engine = new AudioEngine();
 *   await engine.loadFile(file);  // File object from <input type="file">
 *   engine.play();
 *   // Each frame:
 *   const waveform   = engine.getWaveform();   // Uint8Array[2048]  — full fftSize
 *   const frequency  = engine.getFrequency();  // Uint8Array[1024]  — fftSize / 2
 *   const bass       = engine.getBass();        // 0–1
 *   const amplitude  = engine.getAmplitude();   // 0–1
 *
 * Design notes:
 *   - Uses AudioBufferSourceNode (not MediaElement) for accurate analysis.
 *   - AudioBufferSourceNode cannot be paused, so we track _pauseOffset and
 *     create a new node on each play() call starting at the stored offset.
 *   - AudioContext requires a user gesture (Chrome autoplay policy).
 *     resume() is called inside play().
 *   - All analysis getters return zeroed data gracefully when no file is loaded.
 */

const FFT_SIZE = 2048;
const SMOOTHING = 0.8;

export class AudioEngine {
  constructor() {
    this._ctx = null;          // AudioContext — created lazily on first load
    this._analyser = null;     // AnalyserNode
    this._source = null;       // Current AudioBufferSourceNode
    this._buffer = null;       // Decoded AudioBuffer
    this._gainNode = null;     // GainNode (future: volume control)

    this._isPlaying = false;
    this._startTime = 0;       // audioCtx.currentTime when play() was called
    this._pauseOffset = 0;     // seconds into the buffer when paused

    // Reusable typed arrays — allocated once after FFT size is known
    this._waveformData = null; // Uint8Array[fftSize]
    this._freqData = null;     // Uint8Array[fftSize/2]

    this.onEnded = null;       // Optional callback: fired when audio ends naturally

    this._loadGen = 0;         // Generation counter — guards against concurrent loadFile races
  }

  // ── Initialization ─────────────────────────────────────────────────────────

  _ensureContext() {
    if (this._ctx) return;
    this._ctx = new (window.AudioContext || window.webkitAudioContext)();
    this._analyser = this._ctx.createAnalyser();
    this._analyser.fftSize = FFT_SIZE;
    this._analyser.smoothingTimeConstant = SMOOTHING;

    this._gainNode = this._ctx.createGain();
    this._gainNode.connect(this._analyser);
    this._analyser.connect(this._ctx.destination);

    this._waveformData = new Uint8Array(this._analyser.fftSize);
    this._freqData = new Uint8Array(this._analyser.frequencyBinCount); // fftSize/2 = 1024
  }

  // ── File loading ───────────────────────────────────────────────────────────

  /**
   * Load and decode an audio File object.
   * Stops any currently playing audio first.
   * @param {File} file
   */
  async loadFile(file) {
    this._ensureContext();
    this.stop();

    // Increment generation so any in-flight concurrent load is superseded
    const gen = ++this._loadGen;

    const arrayBuffer = await file.arrayBuffer();
    if (gen !== this._loadGen) return; // superseded by a newer load

    const buf = await this._ctx.decodeAudioData(arrayBuffer);
    if (gen !== this._loadGen) return; // superseded

    this._buffer = buf;
    this._pauseOffset = 0;
    this._isPlaying = false;
  }

  // ── Transport ──────────────────────────────────────────────────────────────

  /**
   * Start or resume playback.
   * Safe to call if already playing (no-op).
   * Returns a Promise — await it to ensure the AudioContext is resumed before
   * the source node starts (required by Chrome's autoplay policy).
   */
  async play() {
    if (!this._buffer || this._isPlaying) return;

    this._ensureContext();

    // Chrome autoplay policy: await resume so the context is running before
    // we call source.start() — otherwise start fires while still suspended
    // and audio is silent with a wrong _startTime recorded.
    if (this._ctx.state === 'suspended') {
      await this._ctx.resume();
    }

    // AudioBufferSourceNode is single-use — create a new one each play
    this._source = this._ctx.createBufferSource();
    this._source.buffer = this._buffer;
    this._source.connect(this._gainNode);

    // When the buffer ends naturally, mark as stopped and notify panel
    this._source.onended = () => {
      if (this._isPlaying) {
        this._isPlaying = false;
        this._pauseOffset = 0;
        this._source = null;
        if (this.onEnded) this.onEnded();
      }
    };

    this._source.start(0, this._pauseOffset);
    this._startTime = this._ctx.currentTime - this._pauseOffset;
    this._isPlaying = true;
  }

  /**
   * Pause playback — stores the current position so play() can resume.
   */
  pause() {
    if (!this._isPlaying || !this._source) return;
    this._pauseOffset = this._ctx.currentTime - this._startTime;
    this._source.onended = null; // prevent the onended handler from firing
    this._source.stop();
    this._source = null;
    this._isPlaying = false;
  }

  /**
   * Stop playback and reset to the beginning.
   */
  stop() {
    if (this._source) {
      this._source.onended = null;
      try { this._source.stop(); } catch (_) { /* already stopped */ }
      this._source = null;
    }
    this._isPlaying = false;
    this._pauseOffset = 0;
  }

  /**
   * Seek to a position in seconds.
   * @param {number} seconds
   */
  seek(seconds) {
    if (!this._buffer) return;
    const wasPlaying = this._isPlaying;
    this.stop();
    this._pauseOffset = Math.max(0, Math.min(seconds, this._buffer.duration));
    if (wasPlaying) this.play();
  }

  // ── State getters ──────────────────────────────────────────────────────────

  /** Current playback position in seconds. */
  get currentTime() {
    if (!this._buffer) return 0;
    if (this._isPlaying) {
      return Math.min(this._ctx.currentTime - this._startTime, this._buffer.duration);
    }
    return this._pauseOffset;
  }

  /** Total duration of the loaded file in seconds. */
  get duration() {
    return this._buffer ? this._buffer.duration : 0;
  }

  /** True if audio is currently playing. */
  get isPlaying() {
    return this._isPlaying;
  }

  /** True if a file has been loaded and decoded. */
  get isLoaded() {
    return this._buffer !== null;
  }

  // ── Analysis data ──────────────────────────────────────────────────────────

  /**
   * Time-domain waveform data (oscilloscope).
   * Values 0–255, 128 = silence.
   * @returns {Uint8Array} length = fftSize (2048)
   */
  getWaveform() {
    if (!this._analyser || !this._waveformData) {
      return new Uint8Array(FFT_SIZE); // zeroed
    }
    this._analyser.getByteTimeDomainData(this._waveformData);
    return this._waveformData;
  }

  /**
   * Frequency-domain data (spectrum analyser).
   * Values 0–255.
   * @returns {Uint8Array} length = fftSize/2 (1024)
   */
  getFrequency() {
    if (!this._analyser || !this._freqData) {
      return new Uint8Array(FFT_SIZE / 2); // zeroed
    }
    this._analyser.getByteFrequencyData(this._freqData);
    return this._freqData;
  }

  /**
   * Bass energy — average of frequency bins 0–8 (kick drum range).
   * @returns {number} 0–1
   */
  getBass() {
    const freq = this.getFrequency();
    let sum = 0;
    for (let i = 0; i <= 8; i++) sum += freq[i];
    return sum / (9 * 255);
  }

  /**
   * Mid energy — average of frequency bins 9–64 (melody range).
   * @returns {number} 0–1
   */
  getMid() {
    const freq = this.getFrequency();
    let sum = 0;
    for (let i = 9; i <= 64; i++) sum += freq[i];
    return sum / (56 * 255);
  }

  /**
   * Treble energy — average of frequency bins 65–200 (hi-hat range).
   * @returns {number} 0–1
   */
  getTreble() {
    const freq = this.getFrequency();
    let sum = 0;
    for (let i = 65; i <= 200; i++) sum += freq[i];
    return sum / (136 * 255);
  }

  /**
   * Overall RMS amplitude derived from waveform data.
   * @returns {number} 0–1
   */
  getAmplitude() {
    const wave = this.getWaveform();
    let sum = 0;
    for (let i = 0; i < wave.length; i++) {
      const v = (wave[i] - 128) / 128; // normalize to -1..1
      sum += v * v;
    }
    return Math.sqrt(sum / wave.length);
  }

  /**
   * Decoded AudioBuffer — used by audioPanel to draw the static waveform.
   * Returns null if no file loaded.
   * @returns {AudioBuffer|null}
   */
  getAudioBuffer() {
    return this._buffer;
  }
}
