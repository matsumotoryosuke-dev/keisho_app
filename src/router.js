/**
 * Hash-based router — no framework, just window.location.hash.
 * Toggles #page-home vs #page-editor visibility.
 */

let _currentPage = null;
const _listeners = [];

export function navigate(hash) {
  window.location.hash = hash;
}

export function getCurrentHash() {
  return window.location.hash || '#/';
}

/** Parse ?template=id or ?saved=id from hash like #/editor?template=particle-field */
export function parseEditorParams() {
  const hash = window.location.hash;
  const qIdx = hash.indexOf('?');
  if (qIdx === -1) return {};
  const qs = hash.slice(qIdx + 1);
  const params = {};
  for (const part of qs.split('&')) {
    const [k, v] = part.split('=');
    if (k && v) params[decodeURIComponent(k)] = decodeURIComponent(v);
  }
  return params;
}

export function onRouteChange(fn) {
  _listeners.push(fn);
}

export function _renderPage() {
  const hash = window.location.hash || '#/';
  const isEditor = hash.startsWith('#/editor');
  let isHome   = hash.startsWith('#/home') || hash === '#/' || hash === '#';

  if (!isEditor && !isHome) isHome = true; // unknown route → fallback to home

  const pageHome   = document.getElementById('page-home');
  const pageEditor = document.getElementById('page-editor');

  if (pageHome)   pageHome.style.display   = isHome   ? 'flex' : 'none';
  if (pageEditor) pageEditor.style.display = isEditor ? 'flex' : 'none';

  const page = isEditor ? 'editor' : 'home';
  if (page !== _currentPage) {
    _currentPage = page;
    for (const fn of _listeners) fn(page, hash);
  }
}

window.addEventListener('hashchange', _renderPage);

// Run once on load
export function initRouter() {
  _renderPage();
}
