import { z } from 'zod';
import type { Db } from '../db/driver.ts';
import { newId } from '../db/ids.ts';
import { DomainError, normalizeText, nowIso } from '../db/util.ts';
import { NUTRIENT_KEYS, nutrientsFor, toFoodState } from '../services/nutritionCalc.ts';
import type { Food, Nutrients } from '../types.ts';
import { FOOD_COLUMNS, getFood, getFoodsByIds } from './foods.ts';

type R = Record<string, any>;

export const recipeInputSchema = z.object({
  name: z.string().trim().min(1, 'Le nom de la recette est obligatoire.').max(200),
  ingredients: z
    .array(
      z.object({
        foodId: z.string(),
        quantityG: z.number().positive().max(100000),
        weightState: z.enum(['raw', 'cooked', 'na']).default('na'),
      }),
    )
    .min(1, 'Ajoutez au moins un ingrédient.'),
  /** Poids total pesé après cuisson ; à défaut, somme des ingrédients. */
  totalCookedG: z.number().positive().max(100000).nullable().optional(),
  servings: z.number().positive().max(100).nullable().optional(),
  instructions: z.string().max(10000).nullable().optional(),
});
export type RecipeInput = z.input<typeof recipeInputSchema>;

export interface Recipe {
  food: Food;
  totalCookedG: number | null;
  servings: number | null;
  instructions: string | null;
  ingredients: { id: string; foodId: string; foodName: string; quantityG: number; weightState: string }[];
  totalRawG: number;
  totals: Nutrients;
}

/** Valeurs totales de la recette et pour 100 g de plat cuit. */
async function compute(db: Db, d: z.output<typeof recipeInputSchema>) {
  const foods = await getFoodsByIds(db, d.ingredients.map((i) => i.foodId));
  const totals: Record<string, number> = Object.fromEntries(NUTRIENT_KEYS.map((k) => [k, 0]));
  let totalRawG = 0;
  for (const i of d.ingredients) {
    const f = foods.get(i.foodId);
    if (!f) throw new DomainError('Ingrédient introuvable.');
    if (f.source === 'recipe') throw new DomainError('Une recette ne peut pas contenir une autre recette.');
    totalRawG += i.quantityG;
    const n = nutrientsFor(f, toFoodState(f, i.quantityG, i.weightState).grams);
    for (const k of NUTRIENT_KEYS) totals[k]! += n[k] ?? 0;
  }
  const weight = d.totalCookedG ?? totalRawG;
  const per100 = Object.fromEntries(NUTRIENT_KEYS.map((k) => [k, Math.round((totals[k]! / weight) * 100 * 10) / 10])) as unknown as Nutrients;
  return { totals: totals as unknown as Nutrients, per100, weight, totalRawG };
}

async function writeRecipe(db: Db, foodId: string, d: z.output<typeof recipeInputSchema>, isNew: boolean, via: string): Promise<void> {
  const c = await compute(db, d);
  const now = nowIso();
  const cols = NUTRIENT_KEYS.map((k) => FOOD_COLUMNS[k]!);
  if (isNew) {
    await db.execute(
      `INSERT INTO food (id, source, name, name_norm, state, created_via, created_at, updated_at, ${cols.join(', ')})
       VALUES (?, 'recipe', ?, ?, 'cooked', ?, ?, ?, ${cols.map(() => '?').join(', ')})`,
      [foodId, d.name, normalizeText(d.name), via, now, now, ...NUTRIENT_KEYS.map((k) => c.per100[k])],
    );
    await db.execute('INSERT INTO recipe (food_id, total_cooked_g, servings, instructions) VALUES (?, ?, ?, ?)', [
      foodId, d.totalCookedG ?? null, d.servings ?? null, d.instructions ?? null,
    ]);
  } else {
    await db.execute(
      `UPDATE food SET name = ?, name_norm = ?, updated_at = ?, ${cols.map((c2) => `${c2} = ?`).join(', ')} WHERE id = ?`,
      [d.name, normalizeText(d.name), now, ...NUTRIENT_KEYS.map((k) => c.per100[k]), foodId],
    );
    await db.execute('UPDATE recipe SET total_cooked_g = ?, servings = ?, instructions = ? WHERE food_id = ?', [
      d.totalCookedG ?? null, d.servings ?? null, d.instructions ?? null, foodId,
    ]);
    await db.execute('DELETE FROM recipe_ingredient WHERE recipe_food_id = ?', [foodId]);
    await db.execute("DELETE FROM food_portion WHERE food_id = ? AND label LIKE '1 part%'", [foodId]);
  }
  for (const [i, ing] of d.ingredients.entries()) {
    await db.execute(
      'INSERT INTO recipe_ingredient (id, recipe_food_id, food_id, quantity_g, weight_state, sort) VALUES (?, ?, ?, ?, ?, ?)',
      [newId(), foodId, ing.foodId, ing.quantityG, ing.weightState, i],
    );
  }
  if (d.servings) {
    await db.execute(
      `INSERT INTO food_portion (id, food_id, label, grams, is_default, sort) VALUES (?, ?, ?, ?, 1, -1)`,
      [newId(), foodId, `1 part (1/${d.servings})`, Math.round((c.weight / d.servings) * 10) / 10],
    );
  }
}

export async function createRecipe(db: Db, input: RecipeInput, via: 'app' | 'mcp' = 'app'): Promise<string> {
  const d = recipeInputSchema.parse(input);
  const id = newId();
  await db.transaction((tx) => writeRecipe(tx, id, d, true, via));
  return id;
}

export async function updateRecipe(db: Db, foodId: string, input: RecipeInput): Promise<void> {
  const d = recipeInputSchema.parse(input);
  await db.transaction((tx) => writeRecipe(tx, foodId, d, false, 'app'));
}

export async function getRecipe(db: Db, foodId: string): Promise<Recipe | null> {
  const r = (await db.select<R>('SELECT * FROM recipe WHERE food_id = ?', [foodId]))[0];
  if (!r) return null;
  const food = (await getFood(db, foodId))!;
  const ings = await db.select<R>(
    `SELECT i.*, f.name AS food_name FROM recipe_ingredient i JOIN food f ON f.id = i.food_id WHERE recipe_food_id = ? ORDER BY sort`,
    [foodId],
  );
  const c = await compute(db, {
    name: food.name,
    ingredients: ings.map((i) => ({ foodId: i.food_id, quantityG: i.quantity_g, weightState: i.weight_state })),
    totalCookedG: r.total_cooked_g,
    servings: r.servings,
  });
  return {
    food,
    totalCookedG: r.total_cooked_g,
    servings: r.servings,
    instructions: r.instructions,
    ingredients: ings.map((i) => ({ id: i.id, foodId: i.food_id, foodName: i.food_name, quantityG: i.quantity_g, weightState: i.weight_state })),
    totalRawG: c.totalRawG,
    totals: c.totals,
  };
}

/** Aperçu sans enregistrement (éditeur de recette). */
export async function previewRecipe(db: Db, input: RecipeInput) {
  const d = recipeInputSchema.parse(input);
  const c = await compute(db, d);
  return { per100: c.per100, totals: c.totals, weight: c.weight, perServing: d.servings ? nutrientsFor(c.per100, c.weight / d.servings) : null };
}
