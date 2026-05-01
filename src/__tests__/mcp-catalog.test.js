/**
 * mcp-catalog.test.js
 *
 * Contract tests: every ID in the MCP catalog must exist in the engine.
 * Guards against catalog/engine drift when templates or palettes are renamed.
 */
import { describe, it, expect } from 'vitest';
import { TEMPLATES as CATALOG_TEMPLATES, PALETTES as CATALOG_PALETTES } from '../../mcp/catalog.js';
import { TEMPLATES as ENGINE_TEMPLATES } from '../engine/templates.js';
import { PALETTES as ENGINE_PALETTES } from '../engine/palettes.js';

const engineTemplateIds = new Set(ENGINE_TEMPLATES.map(t => t.id));
const enginePaletteIds  = new Set(ENGINE_PALETTES.map(p => p.id));

describe('MCP catalog — template contract', () => {
  it('every catalog template ID exists in the engine', () => {
    for (const t of CATALOG_TEMPLATES) {
      expect(
        engineTemplateIds.has(t.id),
        `catalog template "${t.id}" not found in src/engine/templates.js`
      ).toBe(true);
    }
  });

  it('catalog and engine have the same number of templates', () => {
    expect(CATALOG_TEMPLATES).toHaveLength(ENGINE_TEMPLATES.length);
  });

  it('every catalog template has id, name, category, description', () => {
    for (const t of CATALOG_TEMPLATES) {
      for (const field of ['id', 'name', 'category', 'description']) {
        expect(t, `catalog template "${t.id}" missing field "${field}"`).toHaveProperty(field);
      }
    }
  });
});

describe('MCP catalog — palette contract', () => {
  it('every catalog palette ID exists in the engine', () => {
    for (const p of CATALOG_PALETTES) {
      expect(
        enginePaletteIds.has(p.id),
        `catalog palette "${p.id}" not found in src/engine/palettes.js`
      ).toBe(true);
    }
  });

  it('catalog and engine have the same number of palettes', () => {
    expect(CATALOG_PALETTES).toHaveLength(ENGINE_PALETTES.length);
  });
});
