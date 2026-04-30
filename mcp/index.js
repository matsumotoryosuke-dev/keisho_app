#!/usr/bin/env node
/**
 * 形象 MCP Server
 *
 * Tools:
 *   render_animation  — render a typography animation and save it locally
 *   list_templates    — list all available templates
 *   list_palettes     — list all available color palettes
 *
 * Usage (stdio transport, works with Claude Code / Cowork):
 *   node mcp/index.js
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { renderAnimation } from './renderer.js';
import { TEMPLATES, PALETTES } from './catalog.js';

const server = new McpServer({
  name: 'keisho',
  version: '0.4.0',
});

// ── render_animation ──────────────────────────────────────────────────────────
server.tool(
  'render_animation',
  'Generate an animated loop typography file using 形象. Returns the saved file path. Requires npm run dev to be running in the keisho_app directory.',
  {
    text:         z.string().describe('Text to animate. Supports \\n for newlines.'),
    template:     z.string().describe('Template ID. Call list_templates to see all options.'),
    palette:      z.string().optional().describe('Palette ID. Call list_palettes to see all options. Defaults to the template\'s default palette.'),
    format:       z.enum(['webm', 'png-zip', 'mp4', 'prores']).default('webm')
                    .describe('Export format. webm = VP9+alpha (recommended). png-zip = lossless PNG sequence. mp4 = H.264 no alpha. prores = luma matte pair for FCPX/Resolve.'),
    resolution:   z.enum(['720p', '1080p', '4k', 'square', 'portrait']).default('1080p')
                    .describe('Export resolution. square=1080×1080, portrait=1080×1920.'),
    loopDuration: z.number().min(1).max(20).default(4)
                    .describe('Loop duration in seconds.'),
    outputPath:   z.string().optional()
                    .describe('Full file path to save the output (including filename). Defaults to ~/Downloads/keisho-<timestamp>.<ext>.'),
    appUrl:       z.string().optional()
                    .describe('Base URL where the 形象 app is running. Defaults to http://localhost:5173.'),
  },
  async (args) => {
    try {
      const result = await renderAnimation(args);
      return {
        content: [{
          type: 'text',
          text: [
            '✓ Animation rendered successfully',
            `  Path:       ${result.path}`,
            `  Template:   ${result.template}`,
            `  Palette:    ${result.palette}`,
            `  Format:     ${result.format}`,
            `  Resolution: ${result.resolution}`,
            `  Text:       "${result.text}"`,
          ].join('\n'),
        }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `✗ Render failed: ${err.message}` }],
        isError: true,
      };
    }
  }
);

// ── list_templates ────────────────────────────────────────────────────────────
server.tool(
  'list_templates',
  'List all available animation templates in 形象 with their IDs, categories, and descriptions.',
  {},
  async () => {
    const lines = TEMPLATES.map(t =>
      `${t.id.padEnd(22)} [${t.category.padEnd(8)}]  ${t.name} — ${t.description}`
    );
    return { content: [{ type: 'text', text: lines.join('\n') }] };
  }
);

// ── list_palettes ─────────────────────────────────────────────────────────────
server.tool(
  'list_palettes',
  'List all available color palettes in 形象.',
  {},
  async () => {
    const lines = PALETTES.map(p => `${p.id.padEnd(14)} ${p.name}`);
    return { content: [{ type: 'text', text: lines.join('\n') }] };
  }
);

// ── Connect ───────────────────────────────────────────────────────────────────
const transport = new StdioServerTransport();
await server.connect(transport);
