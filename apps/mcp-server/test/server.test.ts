import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import {
  createSessionFromTemplate,
  getActiveProgram,
  getSession,
  importCiqual,
  initDatabase,
  listMcpAudit,
  updateSet,
  type CiqualFood,
} from '@training/core';
import { openNodeDb } from '@training/core/node';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PROMPTS } from '@training/core';
import { createServer } from '../src/server.ts';

const TODAY = '2026-09-28';

const food = (sourceRef: string, name: string, kcal: number, p: number, c: number, f: number, state: CiqualFood['state'] = 'na'): CiqualFood => ({
  sourceRef, name, category: null, state, kcal, proteinG: p, carbsG: c, sugarsG: null, fatG: f, satFatG: null, fiberG: null, saltG: null, alcoholG: null,
});

/** Faux Open Food Facts : un produit pour « skyr » et un code-barres. */
const fakeFetch = async (url: string) => {
  const product = { code: '3033490004743', product_name_fr: 'Skyr nature', brands: 'Marque', quantity: '150 g', serving_quantity: 150, nutriments: { 'energy-kcal_100g': 63, proteins_100g: 11, carbohydrates_100g: 4, fat_100g: 0.2 } };
  if (url.includes('/api/v2/product/3033490004743')) return new Response(JSON.stringify({ status: 1, product }));
  if (url.includes('search.pl') && url.includes('skyr')) return new Response(JSON.stringify({ products: [product] }));
  if (url.includes('search.pl')) return new Response(JSON.stringify({ products: [] }));
  return new Response('not found', { status: 404 });
};

async function setup() {
  const h = openNodeDb(':memory:');
  await initDatabase(h.db);
  await importCiqual(
    h.db,
    [
      food('1', 'Riz blanc, cuit', 146, 2.7, 31.7, 0.3, 'cooked'),
      food('2', 'Poulet, filet, sans peau, cru', 117, 23, 0, 1.6, 'raw'),
      ...Array.from({ length: 100 }, (_, i) => food(`t${i}`, `Aliment test ${i}`, 100, 1, 1, 1)),
    ],
    'Ciqual test',
  );
  const server = createServer({ db: h.db, fetch: fakeFetch as never, today: () => TODAY });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  const client = new Client({ name: 'test', version: '1' });
  await client.connect(b);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = (await client.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
    const text = r.content[0]!.text;
    return { isError: !!r.isError, text, data: r.isError ? null : JSON.parse(text) };
  };
  return { db: h.db, client, call };
}

describe('serveur MCP', () => {
  it('expose les outils attendus, les consignes et les prompts', async () => {
    const { client } = await setup();
    const tools = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(tools).toEqual(
      [
        'add_food_entry', 'add_waist_measurement', 'add_weight_entry', 'create_custom_food', 'create_recipe', 'delete_food_entry',
        'get_body_metrics', 'get_cardio_sessions', 'get_day_log', 'get_exercise_history', 'get_food_details', 'get_nutrition_summary',
        'get_program', 'get_saved_meals', 'get_sessions', 'get_user_profile', 'log_saved_meal', 'log_session_note', 'search_food',
        'update_food_entry',
      ].sort(),
    );
    expect(tools.some((t) => /delete_(program|session)|update_program/.test(t))).toBe(false);
    expect(client.getInstructions()).toContain('ATTENDS une confirmation explicite');
    const prompts = (await client.listPrompts()).prompts.map((p) => p.name);
    expect(prompts).toEqual(['analyse_hebdo', 'saisie_repas', 'bilan_nutrition']);
    const hebdo = await client.getPrompt({ name: 'analyse_hebdo', arguments: {} });
    expect((hebdo.messages[0]!.content as { text: string }).text).toContain('du 2026-09-22 au 2026-09-28');
  });

  it('cherche localement puis sur Open Food Facts, et par code-barres', async () => {
    const { call } = await setup();
    const riz = await call('search_food', { query: 'riz cuit' });
    expect(riz.data.results[0]).toMatchObject({ name: 'Riz blanc, cuit', source: 'ciqual', kcal: 146, reference_state: 'cuit' });
    const skyr = await call('search_food', { query: 'skyr' });
    expect(skyr.data.results[0]).toMatchObject({ name: 'Skyr nature', source: 'off', kcal: 63 });
    expect(skyr.data.results[0].portions[0]).toMatchObject({ grams: 150 });
    const bc = await call('search_food', { barcode: '3033490004743' });
    expect(bc.data.results[0].name).toBe('Skyr nature');
    expect((await call('search_food', {})).isError).toBe(true);
  });

  it('exige la confirmation et enregistre les écritures (source, audit)', async () => {
    const { call, db } = await setup();
    const riz = (await call('search_food', { query: 'riz cuit' })).data.results[0];
    const refused = await call('add_food_entry', { meal: 'Déjeuner', food_id: riz.food_id, quantity: 200, unit: 'g', estimated: false });
    expect(refused.isError).toBe(true);
    expect(refused.text).toMatch(/user_confirmed/);
    const unknownField = await call('add_food_entry', { meal: 'Déjeuner', food_id: riz.food_id, quantity: 200, unit: 'g', estimated: false, user_confirmed: true, kcal: 1 });
    expect(unknownField.isError).toBe(true);

    const added = await call('add_food_entry', { meal: 'Déjeuner', food_id: riz.food_id, quantity: 200, unit: 'g', estimated: false, user_confirmed: true });
    expect(added.data.added).toMatchObject({ date: TODAY, kcal: 292, source: 'ciqual', added_by: 'claude', estimated: false });
    expect(added.data.day.totals.kcal).toBe(292);

    const noFood = await call('add_food_entry', { meal: 'Dîner', quantity: 1, unit: 'portion', estimated: false, user_confirmed: true });
    expect(noFood.isError).toBe(true);
    const est = await call('add_food_entry', {
      meal: 'Dîner', label: 'Plat du restaurant', quantity: 1, unit: 'portion', estimated: true, user_confirmed: true,
      estimated_nutrients: { kcal: 700, protein_g: 30, carbs_g: 70, fat_g: 30 },
    });
    expect(est.data.added).toMatchObject({ source: 'estimate', estimated: true });

    const upd = await call('update_food_entry', { entry_id: added.data.added.entry_id, quantity: 100, user_confirmed: true });
    expect(upd.data.after.kcal).toBe(146);
    const day = await call('get_day_log', {});
    expect(day.data.totals.kcal).toBe(846);
    expect(day.data.estimated_entries).toBe(1);
    const del = await call('delete_food_entry', { entry_id: est.data.added.entry_id, user_confirmed: true });
    expect(del.data.day_totals.kcal).toBe(146);
    expect((await listMcpAudit(db)).map((a) => a.tool)).toEqual(['delete_food_entry', 'update_food_entry', 'add_food_entry', 'add_food_entry']);
  });

  it('crée aliment perso et recette, résume la nutrition', async () => {
    const { call } = await setup();
    const perso = await call('create_custom_food', {
      name: 'Barre protéinée X', kcal: 380, protein_g: 33, carbs_g: 35, fat_g: 11, portions: [{ label: '1 barre', grams: 55 }], source_note: 'étiquette', user_confirmed: true,
    });
    expect(perso.data.created).toMatchObject({ source: 'custom', portions: [{ label: '1 barre', grams: 55 }] });
    const riz = (await call('search_food', { query: 'riz cuit' })).data.results[0];
    const poulet = (await call('search_food', { query: 'poulet' })).data.results[0];
    const recipe = await call('create_recipe', {
      name: 'Riz poulet', ingredients: [{ food_id: riz.food_id, quantity_g: 300, weight_state: 'cooked' }, { food_id: poulet.food_id, quantity_g: 200, weight_state: 'raw' }],
      servings: 2, user_confirmed: true,
    });
    expect(recipe.data.total.kcal).toBe(Math.round(146 * 3 + 117 * 2));
    await call('add_food_entry', { meal: 'breakfast', food_id: perso.data.created.food_id, quantity: 1, unit: 'portion', estimated: false, user_confirmed: true });
    const s = await call('get_nutrition_summary', { from: '2026-09-22', to: TODAY });
    expect(s.data).toMatchObject({ logged_days: 1, days_in_period: 7 });
    expect(s.data.unlogged_days).toHaveLength(6);
    expect((await call('get_nutrition_summary', { from: TODAY, to: '2026-09-01' })).isError).toBe(true);
  });

  it('lit programme, séances, historique et ajoute une note avec douleur', async () => {
    const { call, db } = await setup();
    const program = (await getActiveProgram(db))!;
    const sid = await createSessionFromTemplate(db, program.templates[2]!.id, '2026-09-26');
    const s = (await getSession(db, sid))!;
    const squat = s.exercises[0]!;
    for (const set of squat.setEntries) await updateSet(db, set.id, { isDone: true });

    const p = await call('get_program', { template: 'Legs' });
    expect(p.data.templates).toHaveLength(1);
    expect(p.data.templates[0].slots[0]).toMatchObject({ label: 'Squat', target: '4 × 6', rir: '2-3 RIR' });
    expect(p.data.templates[0].slots[0].alternatives[0]).toMatchObject({ exercise: 'Squat barre', load: '90 kg', note: '1RM estimé ~120 kg' });

    const sessions = await call('get_sessions', { from: '2026-09-20', to: TODAY });
    expect(sessions.data.sessions[0].exercises[0]).toMatchObject({ exercise: 'Squat barre', sets_done: '4/4' });

    const h = await call('get_exercise_history', { exercise: 'squat barre' });
    expect(h.data.history[0]).toMatchObject({ max_load_kg: 90, e1rm_kg_estimate: 108 });
    expect((await call('get_exercise_history', { exercise: 'curl' })).data.ambiguous).toBe(true);

    const note = await call('log_session_note', { date: '2026-09-26', comment: 'Genou gauche un peu sensible', fatigue: 6, pains: [{ zone: 'Genou', side: 'left', intensity: 3 }] });
    expect(note.data.attached_to.session_id).toBe(sid);
    const after = (await getSession(db, sid))!;
    expect(after).toMatchObject({ fatigue: 6, comment: 'Genou gauche un peu sensible' });
    expect(after.pains[0]).toMatchObject({ zone: 'Genou', intensity: 3, createdVia: 'mcp' });
    const dayNote = await call('log_session_note', { date: '2026-09-27', comment: 'Journée repos, bien dormi' });
    expect(dayNote.data.attached_to).toEqual({ day: '2026-09-27' });
  });

  it('gère pesées et tour de taille', async () => {
    const { call } = await setup();
    expect((await call('add_weight_entry', { weight_kg: 80.4 })).data.saved).toEqual({ date: TODAY, weight_kg: 80.4 });
    const dup = await call('add_weight_entry', { weight_kg: 80 });
    expect(dup.isError).toBe(true);
    expect(dup.text).toMatch(/existe déjà/);
    await call('add_waist_measurement', { value_cm: 86 });
    const m = await call('get_body_metrics', {});
    expect(m.data).toMatchObject({ weigh_ins: 1, trend: { status: 'insufficient' }, waist_cm: [{ value_cm: 86 }] });
  });

  it('le fichier de prompts types reprend les prompts du serveur', () => {
    const doc = readFileSync(new URL('../../../docs/claude-desktop/prompts-types.md', import.meta.url), 'utf8');
    for (const p of PROMPTS) expect(doc).toContain(p.template.split('\n')[0]!.replace(/\{\w+\}/g, '').slice(0, 30));
  });
});
