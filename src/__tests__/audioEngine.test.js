/**
 * audioEngine.test.js
 *
 * Unit tests for AudioEngine (src/engine/audioEngine.js).
 *
 * jsdom has no Web Audio API, so window.AudioContext is fully stubbed with a
 * realistic mock before each test. The mock matches every method that
 * AudioEngine calls: createAnalyser, createGain, createBufferSource,
 * decodeAudioData, resume, destination.
 *
 * Pattern mirrors canvasMock.js: factory function returns named refs so
 * individual tests can assert on specific node calls.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AudioEngine } from '../engine/audioEngine.js';

// ── Mock factory ──────────────────────────────────────────────────────────────

/**
 * Build a complete Web Audio API mock.
 * Returns the context mock plus the node mocks for per-test assertions.
 */
function makeAudioCtxMock({ ctxState = 'running', decodedDuration = 3.5 } = {}) {
  const analyserNode = {
    fftSize: 2048,
    frequencyBinCount: 1024, // fftSize / 2 — read by _ensureContext
    smoothingTimeConstant: 0.8,
    connect: vi.fn(),
    getByteTimeDomainData: vi.fn((arr) => arr.fill(128)), // silence = 128
    getByteFrequencyData:  vi.fn((arr) => arr.fill(0)),   // silence = 0
  };

  const gainNode = {
    connect: vi.fn(),
    gain: { value: 1 },
  };

  const sourceNode = {
    buffer: null,
    connect: vi.fn(),
    disconnect: vi.fn(),
    start: vi.fn(),
    stop:  vi.fn(),
    onended: null,
  };

  const decodedBuffer = {
    duration: decodedDuration,
    getChannelData: vi.fn(() => new Float32Array(100)),
  };

  const mockCtx = {
    state: ctxState,
    currentTime: 0,
    destination: {},
    resume: vi.fn().mockResolvedValue(undefined),
    createAnalyser: vi.fn().mockReturnValue(analyserNode),
    createGain: vi.fn().mockReturnValue(gainNode),
    createBufferSource: vi.fn().mockReturnValue(sourceNode),
    decodeAudioData: vi.fn().mockResolvedValue(decodedBuffer),
  };

  return { mockCtx, analyserNode, gainNode, sourceNode, decodedBuffer };
}

/**
 * Create a minimal File-like object whose arrayBuffer() resolves immediately.
 */
function makeFile(name = 'test.mp3', type = 'audio/mp3') {
  return {
    name,
    type,
    arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
  };
}

// ── Test setup ────────────────────────────────────────────────────────────────

let mockCtx, analyserNode, gainNode, sourceNode, decodedBuffer;

beforeEach(() => {
  const mocks = makeAudioCtxMock();
  mockCtx      = mocks.mockCtx;
  analyserNode = mocks.analyserNode;
  gainNode     = mocks.gainNode;
  sourceNode   = mocks.sourceNode;
  decodedBuffer = mocks.decodedBuffer;

  // Vitest requires the stub to be a proper constructor (class syntax).
  // Capture the outer mockCtx in closure so the constructor returns it.
  const _ctx = mockCtx;
  vi.stubGlobal('AudioContext', class { constructor() { return _ctx; } });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ── Initialization ─────────────────────────────────────────────────────────────

describe('AudioEngine — initialization', () => {
  it('starts with isLoaded false', () => {
    const engine = new AudioEngine();
    expect(engine.isLoaded).toBe(false);
  });

  it('starts with isPlaying false', () => {
    const engine = new AudioEngine();
    expect(engine.isPlaying).toBe(false);
  });

  it('starts with currentTime 0', () => {
    const engine = new AudioEngine();
    expect(engine.currentTime).toBe(0);
  });

  it('starts with duration 0', () => {
    const engine = new AudioEngine();
    expect(engine.duration).toBe(0);
  });

  it('getWaveform() before load returns a Uint8Array (no throw)', () => {
    const engine = new AudioEngine();
    const result = engine.getWaveform();
    expect(result).toBeInstanceOf(Uint8Array);
  });

  it('getFrequency() before load returns a Uint8Array (no throw)', () => {
    const engine = new AudioEngine();
    const result = engine.getFrequency();
    expect(result).toBeInstanceOf(Uint8Array);
  });

  it('getBass() before load returns 0', () => {
    const engine = new AudioEngine();
    expect(engine.getBass()).toBe(0);
  });

  it('getMid() before load returns 0', () => {
    const engine = new AudioEngine();
    expect(engine.getMid()).toBe(0);
  });

  it('getTreble() before load returns 0', () => {
    const engine = new AudioEngine();
    expect(engine.getTreble()).toBe(0);
  });

  it('getAmplitude() before load returns a number (does not throw)', () => {
    const engine = new AudioEngine();
    // Before load, getWaveform() returns new Uint8Array(FFT_SIZE) — all zeros.
    // (0 - 128) / 128 = -1 per sample, so RMS = 1. The important contract is
    // that the getter does not throw and returns a finite number in 0–1 range.
    const amp = engine.getAmplitude();
    expect(typeof amp).toBe('number');
    expect(isFinite(amp)).toBe(true);
    expect(amp).toBeGreaterThanOrEqual(0);
    expect(amp).toBeLessThanOrEqual(1);
  });
});

// ── loadFile ───────────────────────────────────────────────────────────────────

describe('AudioEngine — loadFile', () => {
  it('sets isLoaded to true after await', async () => {
    const engine = new AudioEngine();
    await engine.loadFile(makeFile());
    expect(engine.isLoaded).toBe(true);
  });

  it('sets duration to the decoded buffer duration', async () => {
    const engine = new AudioEngine();
    await engine.loadFile(makeFile());
    expect(engine.duration).toBe(3.5);
  });

  it('creates an AudioContext on first load (ctx is truthy after load)', async () => {
    // window.AudioContext is a class (not a spy), so we verify indirectly:
    // the engine's internal context must have been created by checking that
    // createAnalyser (which only exists on the mock) was called.
    const engine = new AudioEngine();
    await engine.loadFile(makeFile());
    expect(analyserNode.connect).toHaveBeenCalled(); // wired inside _ensureContext
  });

  it('calls stop() (via source.stop) if playing when loadFile is called', async () => {
    const engine = new AudioEngine();
    const file = makeFile();

    // First load + play
    await engine.loadFile(file);
    await engine.play();
    expect(engine.isPlaying).toBe(true);

    // Load again while playing — should call stop on the active source
    const sourceBefore = sourceNode;
    await engine.loadFile(makeFile());

    expect(sourceBefore.stop).toHaveBeenCalled();
    expect(engine.isPlaying).toBe(false);
  });

  it('race: second concurrent load wins, first result is discarded', async () => {
    // The generation counter (_loadGen) in loadFile() guards against races.
    // Each loadFile() call captures `gen = ++_loadGen`. If by the time
    // decodeAudioData resolves another load has incremented _loadGen further,
    // the stale result is discarded.
    //
    // Strategy:
    //  - Both files' arrayBuffer() resolve immediately.
    //  - First call's decodeAudioData is held pending via a manual promise.
    //  - Second call's decodeAudioData resolves right away.
    //  - Second load completes first (_buffer = bufferSecond, _loadGen still 2).
    //  - Then we resolve first's decodeAudioData — gen(1) !== _loadGen(2) → discard.

    const bufferFirst  = { duration: 1.0, getChannelData: vi.fn(() => new Float32Array(10)) };
    const bufferSecond = { duration: 9.9, getChannelData: vi.fn(() => new Float32Array(10)) };

    let resolveFirstDecode;
    const firstDecodePromise = new Promise(res => { resolveFirstDecode = () => res(bufferFirst); });

    // First call to decodeAudioData → returns the pending promise (first load stalls here)
    // Second call to decodeAudioData → resolves immediately with bufferSecond
    mockCtx.decodeAudioData
      .mockReturnValueOnce(firstDecodePromise)
      .mockResolvedValueOnce(bufferSecond);

    const engine = new AudioEngine();

    // Start first load — arrayBuffer() resolves immediately, then stalls at decodeAudioData
    const load1 = engine.loadFile(makeFile('first.mp3'));

    // Yield so load1's arrayBuffer microtask runs and decodeAudioData is called
    await Promise.resolve();

    // Start second load — arrayBuffer() resolves immediately, decodeAudioData resolves quickly
    const load2 = engine.loadFile(makeFile('second.mp3'));
    await load2; // second load finishes: _buffer = bufferSecond, _loadGen = 2

    // Now resolve first load's decode — gen(1) !== _loadGen(2) → discarded
    resolveFirstDecode();
    await load1;

    // Engine must hold the second buffer (duration 9.9), not first (duration 1.0)
    expect(engine.duration).toBe(9.9);
  });
});

// ── play ───────────────────────────────────────────────────────────────────────

describe('AudioEngine — play', () => {
  it('does nothing (no createBufferSource) when no buffer is loaded', async () => {
    const engine = new AudioEngine();
    await engine.play();
    expect(mockCtx.createBufferSource).not.toHaveBeenCalled();
  });

  it('creates a buffer source and calls source.start(0, 0) on play', async () => {
    const engine = new AudioEngine();
    await engine.loadFile(makeFile());
    await engine.play();

    expect(mockCtx.createBufferSource).toHaveBeenCalled();
    // start(when=0, offset=0) — pauseOffset starts at 0
    expect(sourceNode.start).toHaveBeenCalledWith(0, 0);
  });

  it('calls ctx.resume() when context is suspended before starting source', async () => {
    // Build a suspended-state context
    const { mockCtx: suspendedCtx, sourceNode: sNode } = makeAudioCtxMock({ ctxState: 'suspended' });

    // Vitest requires class syntax for new-able stubs
    const _sCtx = suspendedCtx;
    vi.stubGlobal('AudioContext', class { constructor() { return _sCtx; } });

    // resume() resolves and transitions to running (simulate by changing state)
    suspendedCtx.resume.mockImplementationOnce(async () => {
      suspendedCtx.state = 'running';
    });

    const engine = new AudioEngine();
    await engine.loadFile(makeFile());
    await engine.play();

    expect(suspendedCtx.resume).toHaveBeenCalled();
    // source.start must have been called after resume resolved
    expect(sNode.start).toHaveBeenCalled();
  });

  it('is a no-op when already playing (createBufferSource called only once)', async () => {
    const engine = new AudioEngine();
    await engine.loadFile(makeFile());
    await engine.play();

    const callsAfterFirstPlay = mockCtx.createBufferSource.mock.calls.length;

    await engine.play(); // second call — should be no-op

    expect(mockCtx.createBufferSource.mock.calls.length).toBe(callsAfterFirstPlay);
  });

  it('sets isPlaying to true after play', async () => {
    const engine = new AudioEngine();
    await engine.loadFile(makeFile());
    await engine.play();
    expect(engine.isPlaying).toBe(true);
  });
});

// ── pause ──────────────────────────────────────────────────────────────────────

describe('AudioEngine — pause', () => {
  it('sets isPlaying to false', async () => {
    const engine = new AudioEngine();
    await engine.loadFile(makeFile());
    await engine.play();

    engine.pause();
    expect(engine.isPlaying).toBe(false);
  });

  it('records _pauseOffset so currentTime reflects the paused position', async () => {
    const engine = new AudioEngine();
    await engine.loadFile(makeFile());

    // Simulate 2 seconds of playback by advancing ctx.currentTime
    // _startTime is recorded as ctx.currentTime at play() call (which is 0)
    mockCtx.currentTime = 0;
    await engine.play();

    // Advance context time to simulate 2 s of playback
    mockCtx.currentTime = 2;
    engine.pause();

    // After pause, currentTime should return the stored pauseOffset (≈2)
    expect(engine.currentTime).toBeCloseTo(2, 5);
  });

  it('does not call source.stop() when not playing', () => {
    const engine = new AudioEngine();
    // pause() on a fresh engine — should be silent
    expect(() => engine.pause()).not.toThrow();
    expect(sourceNode.stop).not.toHaveBeenCalled();
  });
});

// ── stop ───────────────────────────────────────────────────────────────────────

describe('AudioEngine — stop', () => {
  it('sets isPlaying to false', async () => {
    const engine = new AudioEngine();
    await engine.loadFile(makeFile());
    await engine.play();
    engine.stop();
    expect(engine.isPlaying).toBe(false);
  });

  it('resets currentTime to 0 after stop', async () => {
    const engine = new AudioEngine();
    await engine.loadFile(makeFile());

    mockCtx.currentTime = 0;
    await engine.play();
    mockCtx.currentTime = 2;
    engine.stop();

    expect(engine.currentTime).toBe(0);
  });

  it('does not throw when _source is null (stop on idle engine)', () => {
    const engine = new AudioEngine();
    expect(() => engine.stop()).not.toThrow();
  });

  it('calls source.stop() on the active source node', async () => {
    const engine = new AudioEngine();
    await engine.loadFile(makeFile());
    await engine.play();
    engine.stop();
    expect(sourceNode.stop).toHaveBeenCalled();
  });
});

// ── currentTime ────────────────────────────────────────────────────────────────

describe('AudioEngine — currentTime getter', () => {
  it('returns 0 when no buffer is loaded (regardless of ctx time)', () => {
    const engine = new AudioEngine();
    mockCtx.currentTime = 100;
    expect(engine.currentTime).toBe(0);
  });

  it('returns pauseOffset after a mid-play pause (not 0)', async () => {
    const engine = new AudioEngine();
    await engine.loadFile(makeFile());

    mockCtx.currentTime = 0;
    await engine.play();
    mockCtx.currentTime = 1.5;
    engine.pause();

    expect(engine.currentTime).toBeCloseTo(1.5, 5);
  });

  it('returns 0 after stop() regardless of previous pause offset', async () => {
    const engine = new AudioEngine();
    await engine.loadFile(makeFile());

    mockCtx.currentTime = 0;
    await engine.play();
    mockCtx.currentTime = 2;
    engine.pause();

    engine.stop();
    expect(engine.currentTime).toBe(0);
  });

  it('while playing, returns ctx.currentTime - startTime (clamped to duration)', async () => {
    const engine = new AudioEngine();
    await engine.loadFile(makeFile()); // duration = 3.5

    mockCtx.currentTime = 0;
    await engine.play();
    mockCtx.currentTime = 2;

    // _startTime was recorded as 0 (ctx.currentTime at play() call)
    expect(engine.currentTime).toBeCloseTo(2, 5);
  });
});

// ── onEnded callback ───────────────────────────────────────────────────────────

describe('AudioEngine — onEnded callback', () => {
  it('sets isPlaying to false when source.onended fires', async () => {
    const engine = new AudioEngine();
    await engine.loadFile(makeFile());
    await engine.play();

    expect(engine.isPlaying).toBe(true);

    // Simulate natural end: fire the onended handler that AudioEngine set
    sourceNode.onended();

    expect(engine.isPlaying).toBe(false);
  });

  it('calls the user-supplied onEnded callback when audio ends naturally', async () => {
    const engine = new AudioEngine();
    const endedSpy = vi.fn();
    engine.onEnded = endedSpy;

    await engine.loadFile(makeFile());
    await engine.play();

    sourceNode.onended();

    expect(endedSpy).toHaveBeenCalledTimes(1);
  });

  it('does not call onEnded if engine was stopped before onended fires (onended nulled)', async () => {
    const engine = new AudioEngine();
    const endedSpy = vi.fn();
    engine.onEnded = endedSpy;

    await engine.loadFile(makeFile());
    await engine.play();

    // stop() nulls source.onended before stopping the node
    engine.stop();

    // The handler was cleared — simulating it firing now would be a stale ref
    // Confirm the source node's onended was cleared (set to null) before stop
    expect(sourceNode.onended).toBeNull();
    expect(endedSpy).not.toHaveBeenCalled();
  });
});

// ── getWaveform / getFrequency after load ─────────────────────────────────────

describe('AudioEngine — analysis data after load', () => {
  it('getWaveform() returns Uint8Array of length fftSize (2048)', async () => {
    const engine = new AudioEngine();
    await engine.loadFile(makeFile());

    const waveform = engine.getWaveform();
    expect(waveform).toBeInstanceOf(Uint8Array);
    expect(waveform.length).toBe(2048);
  });

  it('getWaveform() returns values filled with 128 (silence mock)', async () => {
    const engine = new AudioEngine();
    await engine.loadFile(makeFile());

    const waveform = engine.getWaveform();
    // Mock fills with 128 — every value should be 128
    expect(Array.from(waveform).every(v => v === 128)).toBe(true);
  });

  it('getFrequency() returns Uint8Array of length fftSize/2 (1024)', async () => {
    const engine = new AudioEngine();
    await engine.loadFile(makeFile());

    const freq = engine.getFrequency();
    expect(freq).toBeInstanceOf(Uint8Array);
    expect(freq.length).toBe(1024);
  });

  it('getFrequency() returns values filled with 0 (silence mock)', async () => {
    const engine = new AudioEngine();
    await engine.loadFile(makeFile());

    const freq = engine.getFrequency();
    expect(Array.from(freq).every(v => v === 0)).toBe(true);
  });
});

// ── getAmplitude / getBass / getMid / getTreble ────────────────────────────────

describe('AudioEngine — band energy getters', () => {
  it('with silence (all frequency zeros) getBass returns 0', async () => {
    const engine = new AudioEngine();
    await engine.loadFile(makeFile());
    expect(engine.getBass()).toBe(0);
  });

  it('with silence getMid returns 0', async () => {
    const engine = new AudioEngine();
    await engine.loadFile(makeFile());
    expect(engine.getMid()).toBe(0);
  });

  it('with silence getTreble returns 0', async () => {
    const engine = new AudioEngine();
    await engine.loadFile(makeFile());
    expect(engine.getTreble()).toBe(0);
  });

  it('with silence getAmplitude returns 0 (all waveform values are 128 = silence)', async () => {
    const engine = new AudioEngine();
    await engine.loadFile(makeFile());
    // Waveform mock fills with 128 — (128-128)/128 = 0 — RMS = 0
    expect(engine.getAmplitude()).toBe(0);
  });

  it('getBass returns > 0 when bass bins have non-zero frequency data', async () => {
    // Override getByteFrequencyData to fill bass bins (0–8) with max value 255
    analyserNode.getByteFrequencyData.mockImplementation((arr) => {
      arr.fill(0);
      for (let i = 0; i <= 8; i++) arr[i] = 255;
    });

    const engine = new AudioEngine();
    await engine.loadFile(makeFile());

    expect(engine.getBass()).toBeCloseTo(1, 5); // all bass bins at 255 → 1.0
  });

  it('getMid returns > 0 when mid bins have non-zero frequency data', async () => {
    analyserNode.getByteFrequencyData.mockImplementation((arr) => {
      arr.fill(0);
      for (let i = 9; i <= 64; i++) arr[i] = 255;
    });

    const engine = new AudioEngine();
    await engine.loadFile(makeFile());

    expect(engine.getMid()).toBeCloseTo(1, 5);
  });

  it('getTreble returns > 0 when treble bins have non-zero frequency data', async () => {
    analyserNode.getByteFrequencyData.mockImplementation((arr) => {
      arr.fill(0);
      for (let i = 65; i <= 200; i++) arr[i] = 255;
    });

    const engine = new AudioEngine();
    await engine.loadFile(makeFile());

    expect(engine.getTreble()).toBeCloseTo(1, 5);
  });

  it('getAmplitude returns > 0 when waveform deviates from 128', async () => {
    // Fill waveform with 255 — max positive deviation
    analyserNode.getByteTimeDomainData.mockImplementation((arr) => arr.fill(255));

    const engine = new AudioEngine();
    await engine.loadFile(makeFile());

    expect(engine.getAmplitude()).toBeGreaterThan(0);
  });
});

// ── getAudioBuffer ─────────────────────────────────────────────────────────────

describe('AudioEngine — getAudioBuffer', () => {
  it('returns null before any file is loaded', () => {
    const engine = new AudioEngine();
    expect(engine.getAudioBuffer()).toBeNull();
  });

  it('returns the decoded AudioBuffer after loadFile', async () => {
    const engine = new AudioEngine();
    await engine.loadFile(makeFile());
    expect(engine.getAudioBuffer()).toBe(decodedBuffer);
  });
});

// ── seek ───────────────────────────────────────────────────────────────────────

describe('AudioEngine — seek', () => {
  it('does nothing if no buffer is loaded', () => {
    const engine = new AudioEngine();
    expect(() => engine.seek(2)).not.toThrow();
  });

  it('sets pauseOffset (currentTime) to the clamped seek position', async () => {
    const engine = new AudioEngine();
    await engine.loadFile(makeFile()); // duration 3.5
    engine.seek(2);
    expect(engine.currentTime).toBeCloseTo(2, 5);
  });

  it('clamps seek position to [0, duration]', async () => {
    const engine = new AudioEngine();
    await engine.loadFile(makeFile()); // duration 3.5

    engine.seek(-5);
    expect(engine.currentTime).toBe(0);

    engine.seek(100);
    expect(engine.currentTime).toBe(3.5);
  });

  it('resumes play after seek if engine was playing', async () => {
    const engine = new AudioEngine();
    await engine.loadFile(makeFile());
    await engine.play();

    expect(engine.isPlaying).toBe(true);
    engine.seek(1);

    // seek() calls stop() then play() — createBufferSource called twice total
    expect(mockCtx.createBufferSource.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});
