/**
 * saves.test.js
 *
 * The saves module reads/writes to localStorage directly. jsdom provides a
 * localStorage object but its implementation may vary. We replace it with a
 * clean in-memory mock so every test starts from a known empty state.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── localStorage mock ─────────────────────────────────────────────────────────
// Build a fresh in-memory store and install it before each test.
function makeLocalStorageMock() {
  let store = {};
  return {
    getItem:     (key)        => (key in store ? store[key] : null),
    setItem:     (key, value) => { store[key] = String(value); },
    removeItem:  (key)        => { delete store[key]; },
    clear:       ()           => { store = {}; },
    get length() { return Object.keys(store).length; },
    key:         (i)          => Object.keys(store)[i] ?? null,
  };
}

const localStorageMock = makeLocalStorageMock();
vi.stubGlobal('localStorage', localStorageMock);

// Now import the module under test — it uses the stubbed localStorage
import {
  loadSaves,
  createSave,
  getSaveById,
  deleteSave,
  updateSave,
  duplicateSave,
  captureThumbnail,
} from '../saves.js';

// Clear before each test to isolate state
beforeEach(() => {
  localStorageMock.clear();
});

// Minimal valid payload; thumbnail is intentionally omitted (optional field)
const BASE_PAYLOAD = {
  name:       'Test Save',
  templateId: 'particle-field',
  text:       'HELLO',
  font:       'Space Grotesk',
  fontSize:   220,
  paletteId:  'cyberpunk',
  params:     {},
};

// ── loadSaves ─────────────────────────────────────────────────────────────────

describe('loadSaves', () => {
  it('returns [] when localStorage is empty', () => {
    expect(loadSaves()).toEqual([]);
  });

  it('returns [] and does not throw when localStorage contains invalid JSON', () => {
    localStorageMock.setItem('animtypo_saves', 'NOT_VALID_JSON{{{');
    expect(() => loadSaves()).not.toThrow();
    expect(loadSaves()).toEqual([]);
  });

  it('returns the stored saves array when valid JSON is present', () => {
    const saves = [{ id: 'abc', name: 'Foo' }];
    localStorageMock.setItem('animtypo_saves', JSON.stringify(saves));
    expect(loadSaves()).toEqual(saves);
  });

  it('returns [] when localStorage contains valid JSON that is an object (not an array)', () => {
    localStorageMock.setItem('animtypo_saves', '{}');
    expect(loadSaves()).toEqual([]);
  });

  it('returns [] when localStorage contains valid JSON that is null', () => {
    localStorageMock.setItem('animtypo_saves', 'null');
    expect(loadSaves()).toEqual([]);
  });

  it('returns [] when localStorage contains valid JSON that is a number', () => {
    localStorageMock.setItem('animtypo_saves', '42');
    expect(loadSaves()).toEqual([]);
  });
});

// ── createSave ────────────────────────────────────────────────────────────────

describe('createSave', () => {
  it('stores a save and returns the new save object', () => {
    const save = createSave(BASE_PAYLOAD);
    expect(save).toBeDefined();
    expect(save.name).toBe('Test Save');
    expect(save.templateId).toBe('particle-field');
  });

  it('auto-generates a non-empty string id', () => {
    const save = createSave(BASE_PAYLOAD);
    expect(typeof save.id).toBe('string');
    expect(save.id.length).toBeGreaterThan(0);
  });

  it('sets createdAt as a valid ISO timestamp string', () => {
    const before = Date.now();
    const save = createSave(BASE_PAYLOAD);
    const after = Date.now();
    const ts = new Date(save.createdAt).getTime();
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });

  it('persists the save so loadSaves returns it', () => {
    const save = createSave(BASE_PAYLOAD);
    const all = loadSaves();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe(save.id);
  });

  it('multiple creates accumulate — newest first', () => {
    createSave({ ...BASE_PAYLOAD, name: 'First' });
    createSave({ ...BASE_PAYLOAD, name: 'Second' });
    const all = loadSaves();
    expect(all).toHaveLength(2);
    expect(all[0].name).toBe('Second'); // unshift means newest first
  });

  it('thumbnail defaults to empty string when omitted', () => {
    const save = createSave(BASE_PAYLOAD); // no thumbnail key
    expect(save.thumbnail).toBe('');
  });

  it('thumbnail can be explicitly null without crashing', () => {
    expect(() => createSave({ ...BASE_PAYLOAD, thumbnail: null })).not.toThrow();
  });

  it('uses "Untitled" when name is omitted', () => {
    const save = createSave({ ...BASE_PAYLOAD, name: undefined });
    expect(save.name).toBe('Untitled');
  });

  it('params defaults to {} when omitted', () => {
    const save = createSave({ ...BASE_PAYLOAD, params: undefined });
    expect(save.params).toEqual({});
  });

  it('two saves always get different ids', () => {
    const a = createSave(BASE_PAYLOAD);
    const b = createSave(BASE_PAYLOAD);
    expect(a.id).not.toBe(b.id);
  });
});

// ── getSaveById ───────────────────────────────────────────────────────────────

describe('getSaveById', () => {
  it('returns the correct save for a known id', () => {
    const created = createSave(BASE_PAYLOAD);
    const found = getSaveById(created.id);
    expect(found).not.toBeNull();
    expect(found.id).toBe(created.id);
    expect(found.name).toBe('Test Save');
  });

  it('returns null for an unknown id', () => {
    createSave(BASE_PAYLOAD);
    expect(getSaveById('definitely-does-not-exist')).toBeNull();
  });

  it('returns null when storage is empty', () => {
    expect(getSaveById('any-id')).toBeNull();
  });
});

// ── deleteSave ────────────────────────────────────────────────────────────────

describe('deleteSave', () => {
  it('removes the save from storage', () => {
    const save = createSave(BASE_PAYLOAD);
    expect(loadSaves()).toHaveLength(1);
    deleteSave(save.id);
    expect(loadSaves()).toHaveLength(0);
  });

  it('getSaveById returns null after deletion', () => {
    const save = createSave(BASE_PAYLOAD);
    deleteSave(save.id);
    expect(getSaveById(save.id)).toBeNull();
  });

  it('only removes the targeted save when multiple exist', () => {
    const a = createSave({ ...BASE_PAYLOAD, name: 'A' });
    const b = createSave({ ...BASE_PAYLOAD, name: 'B' });
    deleteSave(a.id);
    const all = loadSaves();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe(b.id);
  });

  it('does not throw when id does not exist', () => {
    expect(() => deleteSave('ghost-id')).not.toThrow();
  });
});

// ── letterSpacing in saves (P2-05 / schema fix) ───────────────────────────────

describe('createSave — letterSpacing field', () => {
  it('stores letterSpacing in the saved object when provided', () => {
    const save = createSave({ ...BASE_PAYLOAD, letterSpacing: 16 });
    expect(save.letterSpacing).toBe(16);
  });

  it('defaults letterSpacing to 24 when omitted', () => {
    const save = createSave(BASE_PAYLOAD); // BASE_PAYLOAD has no letterSpacing
    expect(save.letterSpacing).toBe(24);
  });
});

describe('getSaveById — letterSpacing field', () => {
  it('returns a save that includes letterSpacing', () => {
    const created = createSave({ ...BASE_PAYLOAD, letterSpacing: 32 });
    const found = getSaveById(created.id);
    expect(found).not.toBeNull();
    expect(found.letterSpacing).toBe(32);
  });

  it('saved letterSpacing=0 is preserved (falsy but valid)', () => {
    const created = createSave({ ...BASE_PAYLOAD, letterSpacing: 0 });
    const found = getSaveById(created.id);
    expect(found.letterSpacing).toBe(0);
  });
});

describe('persistSaves — QuotaExceededError retry', () => {
  it('catches QuotaExceededError on first setItem and retries without thumbnails', () => {
    // Build a custom localStorage mock that throws DOMException on the first setItem call
    // and succeeds on the second (thumbnail-stripped) call.
    let callCount = 0;
    const quotaError = Object.assign(new Error('QuotaExceededError'), {
      name: 'QuotaExceededError',
    });
    // Make it a real DOMException-like object
    Object.setPrototypeOf(quotaError, DOMException.prototype);

    const throwingMock = {
      _store: {},
      getItem(key)        { return key in this._store ? this._store[key] : null; },
      setItem(key, value) {
        callCount++;
        if (callCount === 1) throw quotaError; // first call throws QuotaExceededError
        this._store[key] = String(value);       // second call succeeds
      },
      removeItem(key)     { delete this._store[key]; },
      clear()             { this._store = {}; callCount = 0; },
    };

    vi.stubGlobal('localStorage', throwingMock);

    // createSave internally calls persistSaves which will throw on first setItem
    // The retry path should succeed on the second call (thumbnail stripped)
    expect(() => {
      createSave({ ...BASE_PAYLOAD, thumbnail: 'data:image/png;base64,BIGDATA' });
    }).not.toThrow();

    // The retry should have been called (callCount > 1)
    expect(callCount).toBeGreaterThan(1);

    // Restore the original mock for subsequent tests
    vi.stubGlobal('localStorage', localStorageMock);
    localStorageMock.clear();
  });
});

// ── updateSave ────────────────────────────────────────────────────────────────

describe('updateSave', () => {
  it('updates the specified fields', () => {
    const save = createSave(BASE_PAYLOAD);
    const updated = updateSave(save.id, { name: 'Renamed', paletteId: 'aurora' });
    expect(updated.name).toBe('Renamed');
    expect(updated.paletteId).toBe('aurora');
  });

  it('does not change the id', () => {
    const save = createSave(BASE_PAYLOAD);
    const updated = updateSave(save.id, { name: 'New Name' });
    expect(updated.id).toBe(save.id);
  });

  it('does not change createdAt', () => {
    const save = createSave(BASE_PAYLOAD);
    const updated = updateSave(save.id, { name: 'New Name' });
    expect(updated.createdAt).toBe(save.createdAt);
  });

  it('persists the update — getSaveById reflects the change', () => {
    const save = createSave(BASE_PAYLOAD);
    updateSave(save.id, { text: 'WORLD' });
    const found = getSaveById(save.id);
    expect(found.text).toBe('WORLD');
  });

  it('returns null when id does not exist', () => {
    const result = updateSave('nonexistent', { name: 'X' });
    expect(result).toBeNull();
  });
});

// ── duplicateSave ─────────────────────────────────────────────────────────────

describe('duplicateSave', () => {
  it('creates a save with a distinct id and a name ending with " Copy"', () => {
    const original = createSave({ ...BASE_PAYLOAD, name: 'My Save' });
    const dup = duplicateSave(original.id);
    expect(dup).not.toBeNull();
    expect(dup.id).not.toBe(original.id);
    expect(dup.name).toBe('My Save Copy');
  });

  it('params object is not reference-equal to the original (deep copy)', () => {
    const original = createSave({ ...BASE_PAYLOAD, params: { speed: 1 } });
    const dup = duplicateSave(original.id);
    expect(dup).not.toBeNull();
    // Mutate the duplicate's params — should not affect the original
    dup.params.speed = 99;
    const reloaded = getSaveById(original.id);
    expect(reloaded.params.speed).toBe(1);
  });
});

// ── captureThumbnail ──────────────────────────────────────────────────────────

describe('captureThumbnail', () => {
  it('returns a data URL string when given a mock canvas', () => {
    // captureThumbnail calls document.createElement('canvas') which jsdom supports,
    // but the 2D context in jsdom does not implement drawImage/toDataURL meaningfully.
    // We stub document.createElement to inject a fully controlled mock canvas.
    const mockOutputCanvas = {
      width: 0,
      height: 0,
      getContext: () => ({ drawImage: vi.fn() }),
      toDataURL: () => 'data:image/png;base64,abc',
    };

    const origCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag) => {
      if (tag === 'canvas') return mockOutputCanvas;
      return origCreate(tag);
    });

    const mockSourceCanvas = {
      width: 400,
      height: 240,
      getContext: () => ({ drawImage: vi.fn() }),
      toDataURL: () => 'data:image/png;base64,abc',
    };

    const result = captureThumbnail(mockSourceCanvas);
    expect(typeof result).toBe('string');
    expect(result.startsWith('data:')).toBe(true);

    vi.restoreAllMocks();
  });
});

// ── persistSaves double-quota failure ─────────────────────────────────────────

describe('persistSaves — double QuotaExceededError propagates', () => {
  it('throws an error with "Storage full" message when both setItem calls fail', () => {
    const quotaError = Object.assign(new Error('QuotaExceededError'), {
      name: 'QuotaExceededError',
    });
    Object.setPrototypeOf(quotaError, DOMException.prototype);

    const alwaysThrowingMock = {
      _store: {},
      getItem(key)        { return key in this._store ? this._store[key] : null; },
      setItem(key, value) { throw quotaError; },
      removeItem(key)     { delete this._store[key]; },
      clear()             { this._store = {}; },
    };

    vi.stubGlobal('localStorage', alwaysThrowingMock);

    expect(() => {
      createSave({ name: 'x', templateId: 't', text: 'hi', paletteId: 'p' });
    }).toThrow(/Storage full/);

    // Restore the original mock
    vi.stubGlobal('localStorage', localStorageMock);
    localStorageMock.clear();
  });
});
