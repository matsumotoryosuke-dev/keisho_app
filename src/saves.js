/**
 * Save system — localStorage key: animtypo_saves
 *
 * Schema per save:
 * {
 *   id:            string  (crypto.randomUUID)
 *   name:          string
 *   createdAt:     ISO string
 *   templateId:    string
 *   text:          string
 *   font:          string
 *   fontSize:      number
 *   letterSpacing: number
 *   paletteId:     string
 *   params:        {}
 *   thumbnail:     'data:image/png;base64,...'  (400x240)
 * }
 */

const STORAGE_KEY = 'animtypo_saves';

export function loadSaves() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persistSaves(saves) {
  const json = JSON.stringify(saves);
  try {
    localStorage.setItem(STORAGE_KEY, json);
  } catch (e) {
    if (e instanceof DOMException && e.name === 'QuotaExceededError') {
      // Strip thumbnails to free space and retry once
      const stripped = saves.map(s => {
        const { thumbnail, ...rest } = s;
        return rest;
      });
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(stripped));
      } catch (e2) {
        throw new Error('Storage full. Delete some saved projects to continue.');
      }
    } else {
      throw e;
    }
  }
}

export function getSaveById(id) {
  return loadSaves().find(s => s.id === id) || null;
}

/**
 * Create a thumbnail from the live canvas, scaled to 400×240.
 * Returns a data URL string.
 */
export function captureThumbnail(sourceCanvas) {
  const thumbW = 400;
  const thumbH = 240;
  const offscreen = document.createElement('canvas');
  offscreen.width  = thumbW;
  offscreen.height = thumbH;
  const ctx = offscreen.getContext('2d');
  ctx.drawImage(sourceCanvas, 0, 0, thumbW, thumbH);
  return offscreen.toDataURL('image/png');
}

/**
 * Save a new project. Returns the new save object.
 */
export function createSave({ name, templateId, text, font, fontSize, letterSpacing, paletteId, params, thumbnail }) {
  const saves = loadSaves();
  const save = {
    id:            crypto.randomUUID(),
    name:          name || 'Untitled',
    createdAt:     new Date().toISOString(),
    templateId,
    text,
    font,
    fontSize,
    letterSpacing: letterSpacing !== undefined ? letterSpacing : 24,
    paletteId,
    params:        params ? { ...params } : {},
    thumbnail:     thumbnail || '',
  };
  saves.unshift(save); // newest first
  persistSaves(saves);
  return save;
}

/**
 * Update an existing save by id.
 */
export function updateSave(id, updates) {
  const saves = loadSaves();
  const idx = saves.findIndex(s => s.id === id);
  if (idx === -1) return null;
  saves[idx] = { ...saves[idx], ...updates };
  persistSaves(saves);
  return saves[idx];
}

/**
 * Delete a save by id.
 */
export function deleteSave(id) {
  const saves = loadSaves().filter(s => s.id !== id);
  persistSaves(saves);
}

/**
 * Duplicate a save (creates a new copy with " Copy" appended).
 */
export function duplicateSave(id) {
  const original = getSaveById(id);
  if (!original) return null;
  return createSave({
    ...original,
    name: original.name + ' Copy',
    params: JSON.parse(JSON.stringify(original.params || {})),
  });
}
