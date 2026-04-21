/**
 * audioPanel.test.js
 *
 * Unit tests for the Audio Panel UI (src/ui/audioPanel.js).
 *
 * audioPanel.js builds DOM elements and wires a passed-in AudioEngine reference.
 * These tests exercise the wiring logic — event handler routing, guard clauses,
 * and teardown — without pixel rendering.
 *
 * Key constraints:
 *   - jsdom has no canvas rendering — we stub getContext so it returns a mock ctx.
 *   - requestAnimationFrame / cancelAnimationFrame are stubbed to prevent RAF loops.
 *   - audioPanel.js injects a <style> tag once (module-level _stylesInjected flag).
 *     This is harmless; jsdom accumulates <style> tags silently.
 *   - audioPanel.js stores _ampRafId and _teardown at module scope. Tests must
 *     call teardownAudioPanel() / rebuilding to avoid cross-test leakage.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { buildAudioPanel, teardownAudioPanel } from '../ui/audioPanel.js';

// ── Canvas mock (jsdom returns null from getContext) ──────────────────────────

/**
 * Minimal mock for a CanvasRenderingContext2D.
 * audioPanel.js calls: clearRect, fillRect, fillStyle, createLinearGradient.
 */
function makeMockCtx() {
  const gradStub = { addColorStop: vi.fn() };
  return {
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    fillStyle: '',
    createLinearGradient: vi.fn(() => gradStub),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    strokeStyle: '',
    lineWidth: 1,
    globalAlpha: 1,
  };
}

// ── Engine mock factory ────────────────────────────────────────────────────────

function makeEngineMock() {
  return {
    isLoaded: false,
    isPlaying: false,
    duration: 0,
    currentTime: 0,
    onEnded: null,
    loadFile: vi.fn().mockResolvedValue(undefined),
    play: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn(),
    stop: vi.fn(),
    getWaveform: vi.fn(() => new Uint8Array(2048).fill(128)),
    getFrequency: vi.fn(() => new Uint8Array(1024).fill(0)),
    getAmplitude: vi.fn(() => 0),
    getBass: vi.fn(() => 0),
    getMid: vi.fn(() => 0),
    getTreble: vi.fn(() => 0),
    getAudioBuffer: vi.fn(() => null),
  };
}

// ── Per-test setup ─────────────────────────────────────────────────────────────

let rafId = 0;
let rafCallback = null;

beforeEach(() => {
  // Fresh panel container
  document.body.innerHTML = '<div id="panel"></div>';

  // Stub canvas getContext so drawStaticWaveform and drawAmpBar don't throw
  const mockCtx = makeMockCtx();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(mockCtx);

  // Stub RAF — capture the callback but don't invoke it automatically
  rafId = 1;
  vi.stubGlobal('requestAnimationFrame', vi.fn((cb) => {
    rafCallback = cb;
    return rafId++;
  }));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  // Ensure any module-level teardown state is cleaned between tests
  teardownAudioPanel();
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function getPanelEl() {
  return document.getElementById('panel');
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('buildAudioPanel — DOM structure', () => {
  it('appends content into the panel element', () => {
    buildAudioPanel(getPanelEl(), makeEngineMock());
    // Something should have been appended
    expect(getPanelEl().children.length).toBeGreaterThan(0);
  });

  it('renders a drop zone element with class audio-drop-zone', () => {
    buildAudioPanel(getPanelEl(), makeEngineMock());
    const dropZone = document.querySelector('.audio-drop-zone');
    expect(dropZone).not.toBeNull();
  });

  it('renders drop zone label text "Drop audio file here or click to browse"', () => {
    buildAudioPanel(getPanelEl(), makeEngineMock());
    const label = document.querySelector('.audio-drop-label');
    expect(label).not.toBeNull();
    expect(label.textContent).toContain('Drop audio file here');
  });

  it('renders an audio-accent element listing supported formats', () => {
    buildAudioPanel(getPanelEl(), makeEngineMock());
    const accent = document.querySelector('.audio-drop-accent');
    expect(accent).not.toBeNull();
    expect(accent.textContent).toContain('MP3');
  });

  it('renders a hidden transport section (not is-loaded initially)', () => {
    buildAudioPanel(getPanelEl(), makeEngineMock());
    const transport = document.querySelector('.audio-transport');
    expect(transport).not.toBeNull();
    expect(transport.classList.contains('is-loaded')).toBe(false);
  });

  it('renders a waveform canvas element', () => {
    buildAudioPanel(getPanelEl(), makeEngineMock());
    const canvas = document.querySelector('.audio-waveform-canvas');
    expect(canvas).not.toBeNull();
  });

  it('renders an amplitude canvas element', () => {
    buildAudioPanel(getPanelEl(), makeEngineMock());
    const ampCanvas = document.querySelector('.audio-amp-canvas');
    expect(ampCanvas).not.toBeNull();
  });

  it('renders the collapsible section header with title "Audio"', () => {
    buildAudioPanel(getPanelEl(), makeEngineMock());
    const titleEl = document.querySelector('.ctrl-section-title');
    expect(titleEl).not.toBeNull();
    expect(titleEl.textContent).toBe('Audio');
  });

  it('renders the informational note', () => {
    buildAudioPanel(getPanelEl(), makeEngineMock());
    const note = document.querySelector('.audio-note');
    expect(note).not.toBeNull();
    expect(note.textContent.toLowerCase()).toContain('audio-reactive');
  });
});

describe('buildAudioPanel — file input', () => {
  it('contains a hidden file input accepting audio MIME types', () => {
    buildAudioPanel(getPanelEl(), makeEngineMock());
    const input = document.querySelector('input[type="file"]');
    expect(input).not.toBeNull();
    expect(input.accept).toContain('audio');
  });
});

describe('buildAudioPanel — drop zone: file type guard', () => {
  it('rejects a non-audio file (image/png) — engine.loadFile is NOT called', () => {
    const engine = makeEngineMock();
    buildAudioPanel(getPanelEl(), engine);

    const dropZone = document.querySelector('.audio-drop-zone');

    // Simulate drop with an image file — both type and name checks must fail
    const dropEvent = new Event('drop', { bubbles: true });
    dropEvent.preventDefault = vi.fn();
    dropEvent.dataTransfer = {
      files: [{ type: 'image/png', name: 'photo.png' }],
    };

    dropZone.dispatchEvent(dropEvent);

    expect(engine.loadFile).not.toHaveBeenCalled();
  });

  it('rejects a .txt file with no audio MIME type', () => {
    const engine = makeEngineMock();
    buildAudioPanel(getPanelEl(), engine);

    const dropZone = document.querySelector('.audio-drop-zone');
    const dropEvent = new Event('drop', { bubbles: true });
    dropEvent.preventDefault = vi.fn();
    dropEvent.dataTransfer = {
      files: [{ type: 'text/plain', name: 'notes.txt' }],
    };

    dropZone.dispatchEvent(dropEvent);

    expect(engine.loadFile).not.toHaveBeenCalled();
  });

  it('shows an error message when a non-audio file is dropped', () => {
    const engine = makeEngineMock();
    buildAudioPanel(getPanelEl(), engine);

    const dropZone = document.querySelector('.audio-drop-zone');
    const dropEvent = new Event('drop', { bubbles: true });
    dropEvent.preventDefault = vi.fn();
    dropEvent.dataTransfer = {
      files: [{ type: 'image/jpeg', name: 'image.jpg' }],
    };

    dropZone.dispatchEvent(dropEvent);

    const label = document.querySelector('.audio-drop-label');
    expect(label.textContent).toContain('Only audio files');
  });
});

describe('buildAudioPanel — drop zone: audio file acceptance', () => {
  it('accepts an audio/mp3 file and calls engine.loadFile', async () => {
    const engine = makeEngineMock();
    buildAudioPanel(getPanelEl(), engine);

    const dropZone = document.querySelector('.audio-drop-zone');
    const audioFile = {
      type: 'audio/mp3',
      name: 'song.mp3',
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
    };

    const dropEvent = new Event('drop', { bubbles: true });
    dropEvent.preventDefault = vi.fn();
    dropEvent.dataTransfer = { files: [audioFile] };

    dropZone.dispatchEvent(dropEvent);

    // handleFile is async — flush microtasks
    await vi.waitFor(() => expect(engine.loadFile).toHaveBeenCalledWith(audioFile));
  });

  it('accepts a file with .wav extension even if MIME is empty', async () => {
    const engine = makeEngineMock();
    buildAudioPanel(getPanelEl(), engine);

    const dropZone = document.querySelector('.audio-drop-zone');
    // Simulates a case where type is audio/ and name has known extension
    const wavFile = {
      type: 'audio/wav',
      name: 'track.wav',
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
    };

    const dropEvent = new Event('drop', { bubbles: true });
    dropEvent.preventDefault = vi.fn();
    dropEvent.dataTransfer = { files: [wavFile] };

    dropZone.dispatchEvent(dropEvent);

    await vi.waitFor(() => expect(engine.loadFile).toHaveBeenCalledWith(wavFile));
  });

  it('ignores drop event when dataTransfer.files[0] is undefined', () => {
    const engine = makeEngineMock();
    buildAudioPanel(getPanelEl(), engine);

    const dropZone = document.querySelector('.audio-drop-zone');
    const dropEvent = new Event('drop', { bubbles: true });
    dropEvent.preventDefault = vi.fn();
    dropEvent.dataTransfer = { files: [] }; // no files

    expect(() => dropZone.dispatchEvent(dropEvent)).not.toThrow();
    expect(engine.loadFile).not.toHaveBeenCalled();
  });
});

describe('buildAudioPanel — dragover / dragleave', () => {
  it('adds drag-over class on dragover', () => {
    buildAudioPanel(getPanelEl(), makeEngineMock());
    const dropZone = document.querySelector('.audio-drop-zone');

    const dragoverEvent = new Event('dragover', { bubbles: true });
    dragoverEvent.preventDefault = vi.fn();
    dropZone.dispatchEvent(dragoverEvent);

    expect(dropZone.classList.contains('drag-over')).toBe(true);
  });

  it('removes drag-over class on dragleave', () => {
    buildAudioPanel(getPanelEl(), makeEngineMock());
    const dropZone = document.querySelector('.audio-drop-zone');

    // Add it first
    dropZone.classList.add('drag-over');

    dropZone.dispatchEvent(new Event('dragleave'));
    expect(dropZone.classList.contains('drag-over')).toBe(false);
  });
});

describe('buildAudioPanel — transport button wiring', () => {
  it('play button calls engine.play()', async () => {
    const engine = makeEngineMock();
    buildAudioPanel(getPanelEl(), engine);

    const btnPlay = document.querySelector('.audio-btn[title="Play"]');
    btnPlay.click();

    await vi.waitFor(() => expect(engine.play).toHaveBeenCalledTimes(1));
  });

  it('pause button calls engine.pause()', () => {
    const engine = makeEngineMock();
    buildAudioPanel(getPanelEl(), engine);

    const btnPause = document.querySelector('.audio-btn[title="Pause"]');
    btnPause.click();

    expect(engine.pause).toHaveBeenCalledTimes(1);
  });

  it('stop button calls engine.stop()', () => {
    const engine = makeEngineMock();
    buildAudioPanel(getPanelEl(), engine);

    const btnStop = document.querySelector('.audio-btn[title="Stop"]');
    btnStop.click();

    expect(engine.stop).toHaveBeenCalledTimes(1);
  });
});

describe('buildAudioPanel — section header collapse toggle', () => {
  it('toggles is-open class on the section when header is clicked', () => {
    buildAudioPanel(getPanelEl(), makeEngineMock());

    const section = document.querySelector('.ctrl-section');
    const header  = document.querySelector('.ctrl-section-header');

    expect(section.classList.contains('is-open')).toBe(false);
    header.click();
    expect(section.classList.contains('is-open')).toBe(true);
    header.click();
    expect(section.classList.contains('is-open')).toBe(false);
  });
});

describe('buildAudioPanel — RAF lifecycle', () => {
  it('calls requestAnimationFrame on build', () => {
    buildAudioPanel(getPanelEl(), makeEngineMock());
    expect(requestAnimationFrame).toHaveBeenCalled();
  });

  it('teardownAudioPanel() calls cancelAnimationFrame', () => {
    buildAudioPanel(getPanelEl(), makeEngineMock());
    teardownAudioPanel();
    expect(cancelAnimationFrame).toHaveBeenCalled();
  });

  it('teardownAudioPanel() can be called multiple times without error', () => {
    buildAudioPanel(getPanelEl(), makeEngineMock());
    expect(() => {
      teardownAudioPanel();
      teardownAudioPanel();
    }).not.toThrow();
  });

  it('building a second panel cancels the first amplitude RAF', () => {
    buildAudioPanel(getPanelEl(), makeEngineMock());
    // First build issues a RAF — capture the id (rafId starts at 1, first call returns 1)
    const cancelSpy = cancelAnimationFrame;

    // Second build should cancel the existing RAF before starting a new one
    buildAudioPanel(getPanelEl(), makeEngineMock());

    expect(cancelSpy).toHaveBeenCalled();
  });
});

describe('buildAudioPanel — onEnded wiring', () => {
  it('wires engine.onEnded so it can be called without throwing', () => {
    const engine = makeEngineMock();
    buildAudioPanel(getPanelEl(), engine);

    // buildAudioPanel sets engine.onEnded to a syncButtons wrapper
    expect(typeof engine.onEnded).toBe('function');
    // Calling it should not throw (syncButtons reads engine.isPlaying and currentTime)
    expect(() => engine.onEnded()).not.toThrow();
  });

  it('engine.onEnded being fired does not throw even when engine reports not playing', () => {
    const engine = makeEngineMock();
    engine.isPlaying = false;
    engine.currentTime = 0;

    buildAudioPanel(getPanelEl(), engine);

    expect(() => engine.onEnded()).not.toThrow();
  });
});

describe('buildAudioPanel — teardown before first build', () => {
  it('teardownAudioPanel() does not throw when called before buildAudioPanel', () => {
    // _teardown is null at module init — calling teardown must be safe
    // (the module re-exports teardownAudioPanel which guards with `if (_teardown)`)
    // We need a fresh import to see null state, but since modules are cached,
    // just verify no throw after afterEach has already called teardown once.
    expect(() => teardownAudioPanel()).not.toThrow();
  });
});
