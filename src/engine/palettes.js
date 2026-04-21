/**
 * Color Palettes — named, art/mood-themed palettes.
 * Each palette: { id, name, background, primary, secondary, accent, text }
 * - background: canvas fill color
 * - primary:    main text / dominant geometry color
 * - secondary:  supporting geometry / effect color
 * - accent:     highlight / glow color
 * - text:       text fill color
 */

export const PALETTES = [
  // ── Art / Artist-inspired ────────────────────────────────────
  {
    id: 'bauhaus',
    name: 'Bauhaus',
    background: '#ffffff',
    primary: '#e63329',
    secondary: '#f5c800',
    accent: '#1a1a8c',
    text: '#000000',
  },
  {
    id: 'mondrian',
    name: 'Mondrian',
    background: '#f0ede4',
    primary: '#d62828',
    secondary: '#1a4fc4',
    accent: '#f4c430',
    text: '#111111',
  },
  {
    id: 'warhol',
    name: 'Warhol',
    background: '#ff69b4',
    primary: '#ffff00',
    secondary: '#00cfff',
    accent: '#ff4500',
    text: '#1a0030',
  },
  {
    id: 'matisse',
    name: 'Matisse',
    background: '#f7e9d0',
    primary: '#c1440e',
    secondary: '#2e6b8a',
    accent: '#e8b84b',
    text: '#1c1c1c',
  },
  {
    id: 'hokusai',
    name: 'Hokusai',
    background: '#f5f0e8',
    primary: '#1b4f8a',
    secondary: '#e8d5b0',
    accent: '#c23b22',
    text: '#0d0d0d',
  },
  {
    id: 'klimt',
    name: 'Klimt',
    background: '#1a0a00',
    primary: '#d4a017',
    secondary: '#8b4513',
    accent: '#ffd700',
    text: '#f5e6c0',
  },
  {
    id: 'vangogh',
    name: 'VanGogh',
    background: '#1a3a5c',
    primary: '#f4c430',
    secondary: '#4682b4',
    accent: '#cd853f',
    text: '#f0e68c',
  },
  {
    id: 'rothko',
    name: 'Rothko',
    background: '#2b1b17',
    primary: '#c0392b',
    secondary: '#e67e22',
    accent: '#f39c12',
    text: '#fdf0e0',
  },

  // ── Aesthetic / Mood ─────────────────────────────────────────
  {
    id: 'cyberpunk',
    name: 'Cyberpunk',
    background: '#0d0d1a',
    primary: '#ff006e',
    secondary: '#00f5ff',
    accent: '#ffbe0b',
    text: '#ffffff',
  },
  {
    id: 'retro',
    name: 'Retro',
    background: '#1a0a00',
    primary: '#ff6600',
    secondary: '#ffcc00',
    accent: '#00cc88',
    text: '#ffe8cc',
  },
  {
    id: 'aurora',
    name: 'Aurora',
    background: '#050a18',
    primary: '#00ff9f',
    secondary: '#7b2fff',
    accent: '#00d4ff',
    text: '#e0f0ff',
  },
  {
    id: 'desert',
    name: 'Desert',
    background: '#2c1a0e',
    primary: '#e8955a',
    secondary: '#d4c17a',
    accent: '#c0392b',
    text: '#f5e6cc',
  },
  {
    id: 'jungle',
    name: 'Jungle',
    background: '#0a1a0a',
    primary: '#2ecc71',
    secondary: '#27ae60',
    accent: '#f1c40f',
    text: '#d5f5e3',
  },
  {
    id: 'coral',
    name: 'Coral',
    background: '#1a0810',
    primary: '#ff6b6b',
    secondary: '#ffa07a',
    accent: '#ff1493',
    text: '#ffe4e1',
  },
  {
    id: 'lavender',
    name: 'Lavender',
    background: '#0e0a1a',
    primary: '#b39ddb',
    secondary: '#ce93d8',
    accent: '#80deea',
    text: '#ede7f6',
  },
  {
    id: 'autumn',
    name: 'Autumn',
    background: '#1a0d00',
    primary: '#d35400',
    secondary: '#e67e22',
    accent: '#f39c12',
    text: '#fdf6e3',
  },
  {
    id: 'spring',
    name: 'Spring',
    background: '#f0f7f0',
    primary: '#27ae60',
    secondary: '#e74c3c',
    accent: '#f8c8d4',
    text: '#1a3a1a',
  },
  {
    id: 'storm',
    name: 'Storm',
    background: '#0d0d14',
    primary: '#546e7a',
    secondary: '#78909c',
    accent: '#e0e0e0',
    text: '#eceff1',
  },
  {
    id: 'vaporwave',
    name: 'Vaporwave',
    background: '#1a0030',
    primary: '#ff71ce',
    secondary: '#01cdfe',
    accent: '#05ffa1',
    text: '#fffb96',
  },
  {
    id: 'monochrome',
    name: 'Monochrome',
    background: '#000000',
    primary: '#ffffff',
    secondary: '#888888',
    accent: '#cccccc',
    text: '#ffffff',
  },
];

export const DEFAULT_PALETTE_ID = 'cyberpunk';

export function getPaletteById(id) {
  const normalized = (id || '').toLowerCase();
  return PALETTES.find(p => p.id === normalized)
      || PALETTES.find(p => p.id === DEFAULT_PALETTE_ID)
      || PALETTES[0];
}
