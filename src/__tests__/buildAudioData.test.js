/**
 * buildAudioData.test.js
 *
 * Unit tests for the buildAudioData() helper exported from src/engine/audioData.js.
 *
 * buildAudioData() is a pure function whose contract is:
 *   - Read raw values from the audio engine (getBass, getMid, getTreble,
 *     getAmplitude, getWaveform, getFrequency, isLoaded)
 *   - Multiply each scalar value by engine.sensitivity
 *   - Clamp each result to [0, 1] with Math.min(1, value * s)
 *   - Return a plain object { bass, mid, treble, amplitude, waveform, frequency, hasAudio }
 */

import { describe, it, expect, vi } from 'vitest';
import { buildAudioData } from '../engine/audioData.js';

// ── Engine stub factory ───────────────────────────────────────────────────────

/**
 * Minimal engine stub. Every audio getter returns a fixed value.
 * @param {{ bass?, mid?, treble?, amplitude?, sensitivity?, isLoaded? }} overrides
 */
function makeStub({
  bass       = 0,
  mid        = 0,
  treble     = 0,
  amplitude  = 0,
  sensitivity = 1.0,
  isLoaded   = false,
} = {}) {
  const waveform  = new Uint8Array(2048).fill(128);
  const frequency = new Uint8Array(1024).fill(0);
  return {
    sensitivity,
    isLoaded,
    getBass:       vi.fn(() => bass),
    getMid:        vi.fn(() => mid),
    getTreble:     vi.fn(() => treble),
    getAmplitude:  vi.fn(() => amplitude),
    getWaveform:   vi.fn(() => waveform),
    getFrequency:  vi.fn(() => frequency),
  };
}

// ── Tests: default sensitivity (1.0 = no scaling) ────────────────────────────

describe('buildAudioData — default sensitivity (1.0)', () => {
  it('returns raw bass value unchanged when sensitivity is 1.0', () => {
    const engine = makeStub({ bass: 0.5, sensitivity: 1.0 });
    expect(buildAudioData(engine).bass).toBeCloseTo(0.5);
  });

  it('returns raw mid value unchanged when sensitivity is 1.0', () => {
    const engine = makeStub({ mid: 0.3, sensitivity: 1.0 });
    expect(buildAudioData(engine).mid).toBeCloseTo(0.3);
  });

  it('returns raw treble value unchanged when sensitivity is 1.0', () => {
    const engine = makeStub({ treble: 0.7, sensitivity: 1.0 });
    expect(buildAudioData(engine).treble).toBeCloseTo(0.7);
  });

  it('returns raw amplitude value unchanged when sensitivity is 1.0', () => {
    const engine = makeStub({ amplitude: 0.9, sensitivity: 1.0 });
    expect(buildAudioData(engine).amplitude).toBeCloseTo(0.9);
  });

  it('returns all zeros when engine is silent and sensitivity is 1.0', () => {
    const engine = makeStub({ sensitivity: 1.0 });
    const data = buildAudioData(engine);
    expect(data.bass).toBe(0);
    expect(data.mid).toBe(0);
    expect(data.treble).toBe(0);
    expect(data.amplitude).toBe(0);
  });
});

// ── Tests: sensitivity multiplier applied correctly ───────────────────────────

describe('buildAudioData — sensitivity multiplier scaling', () => {
  it('doubles bass when sensitivity=2.0 and raw bass=0.3', () => {
    const engine = makeStub({ bass: 0.3, sensitivity: 2.0 });
    expect(buildAudioData(engine).bass).toBeCloseTo(0.6);
  });

  it('doubles mid when sensitivity=2.0 and raw mid=0.4', () => {
    const engine = makeStub({ mid: 0.4, sensitivity: 2.0 });
    expect(buildAudioData(engine).mid).toBeCloseTo(0.8);
  });

  it('doubles treble when sensitivity=2.0 and raw treble=0.2', () => {
    const engine = makeStub({ treble: 0.2, sensitivity: 2.0 });
    expect(buildAudioData(engine).treble).toBeCloseTo(0.4);
  });

  it('doubles amplitude when sensitivity=2.0 and raw amplitude=0.25', () => {
    const engine = makeStub({ amplitude: 0.25, sensitivity: 2.0 });
    expect(buildAudioData(engine).amplitude).toBeCloseTo(0.5);
  });

  it('halves bass when sensitivity=0.5 and raw bass=0.8', () => {
    const engine = makeStub({ bass: 0.8, sensitivity: 0.5 });
    expect(buildAudioData(engine).bass).toBeCloseTo(0.4);
  });
});

// ── Tests: clamping to 1.0 maximum ───────────────────────────────────────────

describe('buildAudioData — clamp to 1.0 maximum', () => {
  it('clamps bass to 1.0 when sensitivity=2.0 and raw bass=0.8 (product 1.6)', () => {
    const engine = makeStub({ bass: 0.8, sensitivity: 2.0 });
    expect(buildAudioData(engine).bass).toBe(1);
  });

  it('clamps mid to 1.0 when sensitivity=2.0 and raw mid=0.6 (product 1.2)', () => {
    const engine = makeStub({ mid: 0.6, sensitivity: 2.0 });
    expect(buildAudioData(engine).mid).toBe(1);
  });

  it('clamps amplitude to 1.0 when sensitivity=2.0 and raw amplitude=0.5 (product 1.0 exactly)', () => {
    // product == 1.0 exactly: Math.min(1, 1.0) = 1 — no clamp but on boundary
    const engine = makeStub({ amplitude: 0.5, sensitivity: 2.0 });
    expect(buildAudioData(engine).amplitude).toBeCloseTo(1.0);
  });

  it('clamps treble to 1.0 at max sensitivity=4.0 with raw treble=0.5 (product 2.0)', () => {
    const engine = makeStub({ treble: 0.5, sensitivity: 4.0 });
    expect(buildAudioData(engine).treble).toBe(1);
  });

  it('clamps all channels to 1.0 when sensitivity=4.0 and all raw values are 1.0', () => {
    const engine = makeStub({ bass: 1.0, mid: 1.0, treble: 1.0, amplitude: 1.0, sensitivity: 4.0 });
    const data = buildAudioData(engine);
    expect(data.bass).toBe(1);
    expect(data.mid).toBe(1);
    expect(data.treble).toBe(1);
    expect(data.amplitude).toBe(1);
  });
});

// ── Tests: sensitivity=0 (silence / mute) ────────────────────────────────────

describe('buildAudioData — sensitivity=0 (silences all reactive values)', () => {
  it('returns bass=0 regardless of raw bass value when sensitivity=0', () => {
    const engine = makeStub({ bass: 1.0, sensitivity: 0 });
    expect(buildAudioData(engine).bass).toBe(0);
  });

  it('returns mid=0 regardless of raw mid value when sensitivity=0', () => {
    const engine = makeStub({ mid: 0.9, sensitivity: 0 });
    expect(buildAudioData(engine).mid).toBe(0);
  });

  it('returns treble=0 regardless of raw treble value when sensitivity=0', () => {
    const engine = makeStub({ treble: 0.7, sensitivity: 0 });
    expect(buildAudioData(engine).treble).toBe(0);
  });

  it('returns amplitude=0 regardless of raw amplitude value when sensitivity=0', () => {
    const engine = makeStub({ amplitude: 0.5, sensitivity: 0 });
    expect(buildAudioData(engine).amplitude).toBe(0);
  });
});

// ── Tests: pass-through fields ────────────────────────────────────────────────

describe('buildAudioData — pass-through fields (unaffected by sensitivity)', () => {
  it('waveform array is passed through unchanged', () => {
    const engine = makeStub({ sensitivity: 3.0 });
    const waveform = engine.getWaveform();
    expect(buildAudioData(engine).waveform).toBe(waveform);
  });

  it('frequency array is passed through unchanged', () => {
    const engine = makeStub({ sensitivity: 3.0 });
    const frequency = engine.getFrequency();
    expect(buildAudioData(engine).frequency).toBe(frequency);
  });

  it('hasAudio reflects engine.isLoaded = false', () => {
    const engine = makeStub({ isLoaded: false });
    expect(buildAudioData(engine).hasAudio).toBe(false);
  });

  it('hasAudio reflects engine.isLoaded = true', () => {
    const engine = makeStub({ isLoaded: true });
    expect(buildAudioData(engine).hasAudio).toBe(true);
  });
});

// ── Tests: result shape ───────────────────────────────────────────────────────

describe('buildAudioData — result object shape', () => {
  it('returns an object with all seven expected keys', () => {
    const engine = makeStub();
    const data = buildAudioData(engine);
    expect(data).toHaveProperty('bass');
    expect(data).toHaveProperty('mid');
    expect(data).toHaveProperty('treble');
    expect(data).toHaveProperty('amplitude');
    expect(data).toHaveProperty('waveform');
    expect(data).toHaveProperty('frequency');
    expect(data).toHaveProperty('hasAudio');
  });

  it('all scalar values are numbers in [0, 1]', () => {
    const engine = makeStub({ bass: 0.4, mid: 0.3, treble: 0.5, amplitude: 0.6, sensitivity: 1.5 });
    const data = buildAudioData(engine);
    for (const key of ['bass', 'mid', 'treble', 'amplitude']) {
      expect(typeof data[key]).toBe('number');
      expect(data[key]).toBeGreaterThanOrEqual(0);
      expect(data[key]).toBeLessThanOrEqual(1);
    }
  });
});
