import { describe, it, expect } from 'vitest';
import { PALETTES, getPaletteById, DEFAULT_PALETTE_ID } from '../engine/palettes.js';

// A valid 6-digit hex color string, e.g. #ff006e
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

describe('PALETTES array', () => {
  it('contains exactly 20 palettes', () => {
    expect(PALETTES).toHaveLength(20);
  });

  it('every palette has required fields: id, name, background, primary, secondary, accent, text', () => {
    const required = ['id', 'name', 'background', 'primary', 'secondary', 'accent', 'text'];
    for (const palette of PALETTES) {
      for (const field of required) {
        expect(palette, `palette "${palette.id}" is missing field "${field}"`).toHaveProperty(field);
      }
    }
  });

  it('all color values are valid 6-digit hex strings', () => {
    const colorFields = ['background', 'primary', 'secondary', 'accent', 'text'];
    for (const palette of PALETTES) {
      for (const field of colorFields) {
        expect(
          palette[field],
          `palette "${palette.id}" field "${field}" value "${palette[field]}" is not a valid 6-digit hex`
        ).toMatch(HEX_RE);
      }
    }
  });

  it('all palette ids are unique', () => {
    const ids = PALETTES.map(p => p.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });
});

describe('getPaletteById', () => {
  it('returns the correct palette for a known id', () => {
    const palette = getPaletteById('bauhaus');
    expect(palette).toBeDefined();
    expect(palette.id).toBe('bauhaus');
    expect(palette.name).toBe('Bauhaus');
  });

  it('returns the cyberpunk palette for another known id', () => {
    const palette = getPaletteById('cyberpunk');
    expect(palette).toBeDefined();
    expect(palette.id).toBe('cyberpunk');
  });

  it('returns a fallback (the default palette) for an unknown id — never undefined', () => {
    const palette = getPaletteById('nonexistent-palette-id-xyz');
    expect(palette).toBeDefined();
    expect(palette).not.toBeNull();
    // The fallback should be the default palette
    expect(palette.id).toBe(DEFAULT_PALETTE_ID);
  });

  it('returns a fallback for empty string id', () => {
    const palette = getPaletteById('');
    expect(palette).toBeDefined();
    expect(palette.id).toBe(DEFAULT_PALETTE_ID);
  });

  it('returns a fallback for undefined id', () => {
    const palette = getPaletteById(undefined);
    expect(palette).toBeDefined();
    expect(palette.id).toBe(DEFAULT_PALETTE_ID);
  });

  it('each known palette can be retrieved by id', () => {
    for (const p of PALETTES) {
      const found = getPaletteById(p.id);
      expect(found.id).toBe(p.id);
    }
  });

  it('returns the cyberpunk palette for mixed-case "Cyberpunk" (case-insensitive)', () => {
    const palette = getPaletteById('Cyberpunk');
    expect(palette).toBeDefined();
    expect(palette.id).toBe('cyberpunk');
  });

  it('returns the bauhaus palette for all-caps "BAUHAUS" (case-insensitive)', () => {
    const palette = getPaletteById('BAUHAUS');
    expect(palette).toBeDefined();
    expect(palette.id).toBe('bauhaus');
  });

  it('returns the aurora palette for mixed-case "Aurora" (case-insensitive)', () => {
    const palette = getPaletteById('Aurora');
    expect(palette).toBeDefined();
    expect(palette.id).toBe('aurora');
  });
});
