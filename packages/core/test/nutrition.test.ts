import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import {
  addFoodEntry,
  addFoodPortion,
  addWeightEntry,
  ciqualStatus,
  copyDay,
  createCustomFood,
  createRecipe,
  createSavedMealFromEntries,
  createSessionFromTemplate,
  deleteFoodEntry,
  getActiveProgram,
  getBodyMetrics,
  getDayLog,
  getDayType,
  getNutritionSummary,
  getRecipe,
  importCiqual,
  listSavedMeals,
  logSavedMeal,
  mapOffProduct,
  packCiqual,
  parseCiqualZip,
  parseTeneur,
  searchFoods,
  setDayType,
  setFoodFavorite,
  setGoal,
  unpackCiqual,
  updateFood,
  updateFoodEntry,
  weightTrend,
} from '../src/index.ts';
import { freshDb } from './helpers.ts';

/** Encode en windows-1252 (latin-1 suffit pour ces caractères). */
const latin1 = (s: string) => Uint8Array.from([...s].map((c) => c.charCodeAt(0)));

const ALIMS: [string, string, string][] = [
  ['4003', 'Pâtes sèches, crues', '0101'],
  ['4004', 'Pâtes sèches, cuites', '0101'],
  ['36018', 'Poulet, filet, sans peau, cru', '0401'],
  ['19590', 'Yaourt nature', '0501'],
  ['22000', 'Oeuf, cru', '0402'],
  ['19653', 'Fromage blanc ou spécialité laitière, aromatisé, sucré, 3% MG environ', '0501'],
  ['19700', 'Yaourt à la grecque, nature', '0501'],
];
const COMPO: [string, string, string][] = [
  ['4003', '328', '357'], ['4003', '25000', '12,5'], ['4003', '31000', '70,9'], ['4003', '40000', '1,5'], ['4003', '32000', 'traces'],
  ['4004', '328', '157'], ['4004', '25000', '5,5'], ['4004', '31000', '30,6'], ['4004', '40000', '0,9'],
  ['36018', '327', '490'], ['36018', '25000', '23'], ['36018', '31000', '-'], ['36018', '40000', '1,6'],
  ['19590', '328', '53'], ['19590', '25000', '4'], ['19590', '31000', '5'], ['19590', '40000', '< 0,5'],
  ['22000', '328', '140'], ['22000', '25000', '12,7'], ['22000', '31000', '0,3'], ['22000', '40000', '9,8'],
  // Énergie absente partout (cas réel de Ciqual pour certains laitages) : calculée par les macros.
  ['19653', '328', '-'], ['19653', '327', '-'], ['19653', '25000', '5,58'], ['19653', '31000', '14'], ['19653', '40000', '3,2'], ['19653', '34100', '0,28'],
  // Énergie seulement en « facteur de Jones » : reprise telle quelle.
  ['19700', '328', '-'], ['19700', '333', '97'], ['19700', '25000', '9'], ['19700', '31000', '4'], ['19700', '40000', '5'],
];

function ciqualZip(extraFoods = 0) {
  const alims = [...ALIMS, ...Array.from({ length: extraFoods }, (_, i) => [`9${i}`, `Aliment test ${i}`, '0101'] as [string, string, string])];
  const alim = `<?xml version="1.0" encoding="windows-1252"?>\n<TABLE>\n${alims
    .map(([c, n, g]) => `<ALIM>\n<alim_code> ${c} </alim_code>\n<alim_nom_fr> ${n} </alim_nom_fr>\n<alim_grp_code> ${g.slice(0, 2)} </alim_grp_code>\n<alim_ssgrp_code> ${g} </alim_ssgrp_code>\n</ALIM>`)
    .join('\n')}\n</TABLE>`;
  const compo = `<?xml version="1.0" encoding="windows-1252"?>\n<TABLE>\n${[...COMPO, ...alims.slice(ALIMS.length).map(([c]) => [c, '328', '100'])]
    .map(([a, c, t]) => `<COMPO>\n<alim_code> ${a} </alim_code>\n<const_code> ${c} </const_code>\n<teneur> ${t} </teneur>\n<min missing=" " />\n</COMPO>`)
    .join('\n')}\n</TABLE>`;
  const grp = `<?xml version="1.0" encoding="windows-1252"?>\n<TABLE><ALIM_GRP><alim_grp_code> 01 </alim_grp_code><alim_grp_nom_fr> Féculents </alim_grp_nom_fr><alim_ssgrp_code> 0101 </alim_ssgrp_code><alim_ssgrp_nom_fr> pâtes, riz et céréales </alim_ssgrp_nom_fr></ALIM_GRP></TABLE>`;
  return zipSync({
    'XML_2020_07_07/alim_2020_07_07.xml': latin1(alim),
    'XML_2020_07_07/compo_2020_07_07.xml': latin1(compo),
    'XML_2020_07_07/alim_grp_2020_07_07.xml': latin1(grp),
    'XML_2020_07_07/lisezmoi.txt': strToU8('x'),
  });
}

async function dbWithCiqual() {
  const db = await freshDb();
  const { foods, version } = parseCiqualZip(ciqualZip(100));
  await importCiqual(db, foods, version);
  return db;
}

const idOf = async (db: Awaited<ReturnType<typeof freshDb>>, q: string) => (await searchFoods(db, q))[0]!.food.id;

describe('Ciqual', () => {
  it('lit les valeurs, drapeaux, catégories et état cru/cuit', () => {
    const { foods, version } = parseCiqualZip(ciqualZip());
    expect(version).toBe('Ciqual 2020-07-07');
    const pates = foods.find((f) => f.sourceRef === '4003')!;
    expect(pates).toMatchObject({ name: 'Pâtes sèches, crues', kcal: 357, proteinG: 12.5, sugarsG: 0, state: 'raw', category: 'pâtes, riz et céréales' });
    expect(pates.flags).toEqual({ sugarsG: 'traces' });
    const poulet = foods.find((f) => f.sourceRef === '36018')!;
    expect(poulet.kcal).toBe(Math.round(490 / 4.184));
    expect(poulet.carbsG).toBeNull();
    expect(foods.find((f) => f.sourceRef === '19590')!.flags).toEqual({ fatG: '< 0,5' });
    expect(parseTeneur(' 1 234,5 ')).toEqual({ value: 1234.5 });
    const fb = foods.find((f) => f.sourceRef === '19653')!;
    expect(fb.kcal).toBe(Math.round(5.58 * 4 + 14 * 4 + 3.2 * 9 + 0.28 * 2));
    expect(fb.flags).toEqual({ kcal: 'calculée à partir des macronutriments' });
    expect(foods.find((f) => f.sourceRef === '19700')!.kcal).toBe(97);
  });

  it('importe sans doublon et le format compact fait l’aller-retour', async () => {
    const db = await dbWithCiqual();
    const { foods, version } = parseCiqualZip(ciqualZip(100));
    expect(unpackCiqual(JSON.parse(JSON.stringify(packCiqual(foods, version))))).toEqual(foods);
    const r = await importCiqual(db, foods, version);
    expect(r).toEqual({ inserted: 0, updated: 107 });
    expect(await ciqualStatus(db)).toEqual({ count: 107, version: 'Ciqual 2020-07-07' });
  });
});

describe('recherche d’aliments', () => {
  it('tolère fautes, accents et priorise récents, favoris et base perso', async () => {
    const db = await dbWithCiqual();
    expect((await searchFoods(db, 'poulé'))[0]!.food.name).toBe('Poulet, filet, sans peau, cru');
    expect((await searchFoods(db, 'yahourt'))[0]!.food.name).toBe('Yaourt nature');
    expect((await searchFoods(db, 'pates cuites'))[0]!.food.name).toBe('Pâtes sèches, cuites');
    expect((await searchFoods(db, 'oeuf'))[0]!.food.name).toBe('Oeuf, cru');

    await createCustomFood(db, { name: 'Yaourt grec maison', kcal: 120, proteinG: 9, carbsG: 4, fatG: 7 });
    expect((await searchFoods(db, 'yaourt grec'))[0]!.food.name).toBe('Yaourt grec maison');
    expect((await searchFoods(db, 'yogourt grec', { sources: ['ciqual'] }))[0]!.food.name).toBe('Yaourt à la grecque, nature');
    let res = await searchFoods(db, 'yaourt');
    expect(res.map((r) => [r.food.name, r.badge])).toEqual([
      ['Yaourt grec maison', 'custom'],
      ['Yaourt nature', 'ciqual'],
      ['Yaourt à la grecque, nature', 'ciqual'],
    ]);
    await setFoodFavorite(db, res[1]!.food.id, true);
    res = await searchFoods(db, 'yaourt');
    expect(res[0]!.badge).toBe('favorite');
    await addFoodEntry(db, { date: '2026-09-27', meal: 'dîner', foodId: res[1]!.food.id, quantity: 100, unit: 'g' });
    expect((await searchFoods(db, 'yaourt'))[0]!.badge).toBe('recent');
  });
});

describe('journal alimentaire', () => {
  it('calcule les valeurs, convertit cru ↔ cuit et gère les portions', async () => {
    const db = await dbWithCiqual();
    const pates = await idOf(db, 'pates crues');
    await updateFood(db, pates, { cookedYield: 2.5 });
    const cooked = await addFoodEntry(db, { date: '2026-09-27', meal: 'Déjeuner', foodId: pates, quantity: 250, unit: 'g', weightState: 'cooked' });
    expect(cooked).toMatchObject({ grams: 250, kcal: 357, proteinG: 12.5, source: 'ciqual', weightState: 'cooked' });

    const oeuf = await idOf(db, 'oeuf');
    const portion = await addFoodPortion(db, oeuf, '1 œuf', 60);
    const e = await addFoodEntry(db, { date: '2026-09-27', meal: 'breakfast', foodId: oeuf, quantity: 3, unit: 'portion', portionId: portion });
    expect(e).toMatchObject({ grams: 180, kcal: 252, portionLabel: '1 œuf' });
    const e2 = await updateFoodEntry(db, e.id, { quantity: 2 });
    expect(e2.kcal).toBe(168);

    const est = await addFoodEntry(db, {
      date: '2026-09-27', meal: 'dîner', label: 'Part de pizza (restaurant)', quantity: 1, unit: 'portion', estimated: true,
      estimatedNutrients: { kcal: 300, proteinG: 12, carbsG: 35, fatG: 12 },
    });
    expect(est).toMatchObject({ source: 'estimate', isEstimated: true, kcal: 300 });

    const log = await getDayLog(db, '2026-09-27');
    expect(log.totals.kcal).toBe(357 + 168 + 300);
    expect(log.meals.map((m) => m.category.name)).toEqual(['Petit-déjeuner', 'Déjeuner', 'Collation', 'Dîner']);
    expect(log.estimatedCount).toBe(1);
    await expect(addFoodEntry(db, { date: '2026-09-27', meal: 'goûter', foodId: oeuf, quantity: 1, unit: 'g' })).rejects.toThrow(/Repas inconnu/);
    await expect(addFoodEntry(db, { date: '2026-09-27', meal: 'dîner', quantity: 1, unit: 'g' })).rejects.toThrow();

    expect(await copyDay(db, '2026-09-27', '2026-09-28')).toBe(3);
    expect((await getDayLog(db, '2026-09-28')).totals.kcal).toBe(log.totals.kcal);
    await deleteFoodEntry(db, est.id);
    expect((await getDayLog(db, '2026-09-27')).totals.kcal).toBe(357 + 168);
  });

  it('crée des recettes (valeurs par 100 g cuit et par part)', async () => {
    const db = await dbWithCiqual();
    const pates = await idOf(db, 'pates crues');
    const poulet = await idOf(db, 'poulet');
    const id = await createRecipe(db, {
      name: 'Pâtes au poulet',
      ingredients: [
        { foodId: pates, quantityG: 200, weightState: 'raw' },
        { foodId: poulet, quantityG: 300, weightState: 'raw' },
      ],
      totalCookedG: 800,
      servings: 4,
    });
    const r = (await getRecipe(db, id))!;
    const totalKcal = 357 * 2 + Math.round(490 / 4.184) * 3;
    expect(r.totals.kcal).toBe(totalKcal);
    expect(r.food.kcal).toBeCloseTo((totalKcal / 800) * 100, 0);
    expect(r.food.portions[0]).toMatchObject({ label: '1 part (1/4)', grams: 200 });
    const e = await addFoodEntry(db, { date: '2026-09-27', meal: 'dîner', foodId: id, quantity: 1, unit: 'portion' });
    expect(e.kcal).toBeCloseTo(totalKcal / 4, -1);
  });

  it('gère repas enregistrés, objectifs et types de jour', async () => {
    const db = await dbWithCiqual();
    const yaourt = await idOf(db, 'yaourt');
    const oeuf = await idOf(db, 'oeuf');
    const a = await addFoodEntry(db, { date: '2026-09-27', meal: 'breakfast', foodId: yaourt, quantity: 150, unit: 'g' });
    const b = await addFoodEntry(db, { date: '2026-09-27', meal: 'breakfast', foodId: oeuf, quantity: 120, unit: 'g' });
    const sm = await createSavedMealFromEntries(db, 'Petit-déj habituel', [a.id, b.id], 'breakfast');
    expect((await listSavedMeals(db))[0]!.totals.kcal).toBe(a.kcal + b.kcal);
    await logSavedMeal(db, sm, '2026-09-30', null, 2);
    // Chaque entrée est arrondie séparément : ±1 kcal.
    expect(Math.abs((await getDayLog(db, '2026-09-30')).totals.kcal - 2 * (a.kcal + b.kcal))).toBeLessThanOrEqual(1);

    await setGoal(db, 'default', { kcal: 2400, proteinG: 150 }, '2026-09-01');
    await setGoal(db, 'rest', { kcal: 2100 }, '2026-09-20');
    await setGoal(db, 'default', { kcal: 2500 }, '2026-09-29');
    expect((await getDayLog(db, '2026-09-10')).goal?.kcal).toBe(2400);
    expect((await getDayLog(db, '2026-09-27')).goal).toMatchObject({ kcal: 2100, proteinG: 150 });
    const program = (await getActiveProgram(db))!;
    await createSessionFromTemplate(db, program.templates[0]!.id, '2026-09-30');
    expect(await getDayType(db, '2026-09-30')).toEqual({ dayType: 'training', manual: false });
    expect((await getDayLog(db, '2026-09-30')).goal).toMatchObject({ kcal: 2500, proteinG: 150 });
    await setDayType(db, '2026-09-30', 'rest');
    expect((await getDayLog(db, '2026-09-30')).goal?.kcal).toBe(2100);

    const s = await getNutritionSummary(db, '2026-09-26', '2026-09-30');
    expect(s.loggedDays).toBe(2);
    expect(Math.abs(s.averageLogged!.kcal - (3 * (a.kcal + b.kcal)) / 2)).toBeLessThanOrEqual(1);
  });
});

describe('Open Food Facts', () => {
  it('convertit un produit et ses portions', () => {
    const f = mapOffProduct({
      code: '3033490004743',
      product_name_fr: 'Skyr nature',
      brands: 'Siggi’s, Marque 2',
      quantity: '150 g',
      serving_quantity: '150',
      serving_size: '1 pot (150 g)',
      nutriments: { 'energy-kcal_100g': 63, proteins_100g: 11, carbohydrates_100g: 4, sugars_100g: 4, fat_100g: 0.2, salt_100g: 0.1 },
    })!;
    expect(f).toMatchObject({ sourceRef: '3033490004743', name: 'Skyr nature', brand: 'Siggi’s', basis: '100g', kcal: 63, proteinG: 11 });
    expect(f.portions).toEqual([{ label: '1 portion (1 pot (150 g))', grams: 150 }]);
    expect(mapOffProduct({ code: '1', product_name: 'Eau', quantity: '1,5 l', nutriments: { energy_100g: 0 } })!.basis).toBe('100ml');
    expect(mapOffProduct({ code: '2', product_name: 'Sans valeurs', nutriments: {} })).toBeNull();
  });
});

describe('suivi corporel', () => {
  it('moyenne sur les pesées disponibles et tendance seulement si assez de données', async () => {
    const db = await freshDb();
    await addWeightEntry(db, { date: '2026-09-01', weightKg: 80 });
    await addWeightEntry(db, { date: '2026-09-04', weightKg: 79.6 });
    await expect(addWeightEntry(db, { date: '2026-09-04', weightKg: 79 })).rejects.toThrow(/existe déjà/);
    let m = await getBodyMetrics(db, '2026-09-01', '2026-09-30');
    expect(m.latest).toMatchObject({ avg7: 79.8, avg7Count: 2 });
    expect(m.trend.status).toBe('insufficient');
    await addWeightEntry(db, { date: '2026-09-06', weightKg: 79.5 });
    await addWeightEntry(db, { date: '2026-09-12', weightKg: 79.2 });
    await addWeightEntry(db, { date: '2026-09-20', weightKg: 78.8 });
    m = await getBodyMetrics(db, '2026-09-01', '2026-09-30');
    expect(m.weights.at(-1)!.avg7Count).toBe(1);
    // Fenêtre de 28 jours jusqu'au 30/09 : la pesée du 01/09 en est exclue.
    expect(m.trend).toMatchObject({ status: 'ok', points: 4, spanDays: 16 });
    if (m.trend.status === 'ok') expect(m.trend.kgPerWeek).toBeGreaterThan(-0.5), expect(m.trend.kgPerWeek).toBeLessThan(-0.2);
    expect(weightTrend([], '2026-09-30').status).toBe('insufficient');
    await addWeightEntry(db, { date: '2026-09-20', weightKg: 78.5, replaceExisting: true });
    expect((await getBodyMetrics(db, '2026-09-20', '2026-09-20')).latest!.weightKg).toBe(78.5);
  });
});
