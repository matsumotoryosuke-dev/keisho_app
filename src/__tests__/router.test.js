/**
 * router.test.js
 *
 * The router module calls window.addEventListener('hashchange', …) at import
 * time. jsdom provides window and addEventListener, so importing the module
 * is safe. We control window.location.hash through Object.defineProperty so
 * we can set it to arbitrary values without triggering actual navigation.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Helper: set window.location.hash without triggering JSDOM navigation errors.
function setHash(hash) {
  Object.defineProperty(window, 'location', {
    value: { ...window.location, hash },
    writable: true,
    configurable: true,
  });
}

// Import AFTER helpers are defined so the module-level addEventListener call
// doesn't fire before jsdom is ready (it's already ready by import time in vitest).
import { navigate, parseEditorParams, getCurrentHash, _renderPage } from '../router.js';

describe('parseEditorParams', () => {
  it('extracts template param from hash like #/editor?template=particle-field', () => {
    setHash('#/editor?template=particle-field');
    const params = parseEditorParams();
    expect(params.template).toBe('particle-field');
  });

  it('extracts saved param from hash like #/editor?saved=abc123', () => {
    setHash('#/editor?saved=abc123');
    const params = parseEditorParams();
    expect(params.saved).toBe('abc123');
  });

  it('returns {} for a hash with no query string', () => {
    setHash('#/home');
    expect(parseEditorParams()).toEqual({});
  });

  it('returns {} for the root hash #/', () => {
    setHash('#/');
    expect(parseEditorParams()).toEqual({});
  });

  it('returns {} for an empty hash', () => {
    setHash('');
    expect(parseEditorParams()).toEqual({});
  });

  it('extracts multiple query params', () => {
    setHash('#/editor?template=scatter-reform&saved=xyz');
    const params = parseEditorParams();
    expect(params.template).toBe('scatter-reform');
    expect(params.saved).toBe('xyz');
  });

  it('URL-decodes param values', () => {
    setHash('#/editor?template=particle%20field');
    const params = parseEditorParams();
    expect(params.template).toBe('particle field');
  });

  it('ignores malformed key=value pairs with no value', () => {
    setHash('#/editor?foo');
    const params = parseEditorParams();
    // 'foo' alone has no '=' separator with a value, so should NOT be added
    expect(params.foo).toBeUndefined();
  });
});

describe('navigate', () => {
  it('sets window.location.hash to the given value', () => {
    navigate('#/editor?template=particle-field');
    expect(window.location.hash).toBe('#/editor?template=particle-field');
  });

  it('sets window.location.hash to #/home', () => {
    navigate('#/home');
    expect(window.location.hash).toBe('#/home');
  });
});

describe('getCurrentHash', () => {
  it('returns current window.location.hash', () => {
    setHash('#/editor?saved=test');
    expect(getCurrentHash()).toBe('#/editor?saved=test');
  });

  it('returns "#/" when hash is empty', () => {
    setHash('');
    expect(getCurrentHash()).toBe('#/');
  });
});

describe('parseEditorParams — unknown routes (P2-03)', () => {
  it('returns {} for an unknown hash like #/about', () => {
    setHash('#/about');
    const params = parseEditorParams();
    // Unknown hash has no query string → {} as always
    expect(params).toEqual({});
  });

  it('returns {} for an unknown hash like #/settings', () => {
    setHash('#/settings');
    expect(parseEditorParams()).toEqual({});
  });

  // Note: the DOM-visibility test (both pages hidden) is not feasible here
  // because _renderPage() calls document.getElementById which would need a
  // real DOM with #page-home and #page-editor elements. jsdom provides a DOM
  // but the test environment doesn't mount the app HTML, so getElementById
  // returns null for those IDs. The _renderPage fix (isHome = true fallback)
  // is covered by the router source fix; we skip the DOM visibility assertion
  // here since it would require a full HTML fixture setup beyond this test suite's scope.
});

// ── _renderPage — unknown hash falls back to home ─────────────────────────────

describe('_renderPage — unknown hash falls back to home', () => {
  it('shows page-home and hides page-editor for an unknown hash like #/about', () => {
    // Set up a minimal DOM fixture with the two page elements
    document.body.innerHTML =
      '<div id="page-home" style="display:none"></div>' +
      '<div id="page-editor" style="display:none"></div>';

    setHash('#/about');
    _renderPage();

    const pageHome   = document.getElementById('page-home');
    const pageEditor = document.getElementById('page-editor');

    // Unknown hash → fallback to home → page-home visible, page-editor hidden
    expect(pageHome.style.display).toBe('flex');
    expect(pageEditor.style.display).toBe('none');
  });
});
