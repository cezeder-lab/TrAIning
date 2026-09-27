import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { PROMPTS, renderPrompt, type PromptDef } from '@training/core';
import { z } from 'zod';

const shift = (d: string, days: number) => new Date(Date.parse(`${d}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

export function registerPrompts(server: McpServer, today: () => string) {
  const [hebdo, repas, bilan] = PROMPTS as [PromptDef, PromptDef, PromptDef];
  server.registerPrompt(
    hebdo.name,
    { title: hebdo.title, description: hebdo.description, argsSchema: { fin: z.string().optional().describe('Dernier jour (AAAA-MM-JJ), par défaut aujourd’hui') } },
    ({ fin }) => {
      const to = fin || today();
      return { messages: [{ role: 'user', content: { type: 'text', text: renderPrompt(hebdo, { from: shift(to, -6), to }) } }] };
    },
  );
  server.registerPrompt(
    repas.name,
    { title: repas.title, description: repas.description, argsSchema: { repas: z.string().optional().describe('ex. Déjeuner') } },
    ({ repas: r }) => ({ messages: [{ role: 'user', content: { type: 'text', text: renderPrompt(repas, { repas: r || 'à préciser' }) } }] }),
  );
  server.registerPrompt(
    bilan.name,
    { title: bilan.title, description: bilan.description, argsSchema: { jours: z.string().optional().describe('Nombre de jours (7 par défaut)') } },
    ({ jours }) => {
      const n = Math.min(Math.max(Number(jours) || 7, 1), 90);
      const to = today();
      return { messages: [{ role: 'user', content: { type: 'text', text: renderPrompt(bilan, { jours: String(n), from: shift(to, -(n - 1)), to }) } }] };
    },
  );
}
