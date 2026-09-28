import { z } from 'zod';
import type { Db } from '../db/driver.ts';
import { newId } from '../db/ids.ts';
import { DomainError, bool, normalizeText, nowIso } from '../db/util.ts';
import { nutrientsFor, quantityToGrams, sumTotals, toFoodState } from '../services/nutritionCalc.ts';
import type { DayType, FoodEntry, MacroTotals, MealCategory, NutritionGoal } from '../types.ts';
import { getFood, getFoodsByIds, touchFood } from './foods.ts';
import { getDayType, getGoalForDay } from './goals.ts';
import { dateSchema } from './sessions.ts';

type R = Record<string, any>;
type Via = 'app' | 'mcp';

// --- Catégories de repas ---------------------------------------------------------

export async function listMealCategories(db: Db, includeInactive = false): Promise<MealCategory[]> {
  const rows = await db.select<R>(`SELECT * FROM meal_category ${includeInactive ? '' : 'WHERE is_active = 1'} ORDER BY sort`);
  return rows.map((r) => ({ id: r.id, name: r.name, sort: r.sort, isActive: bool(r.is_active) }));
}

/** Retrouve une catégorie par identifiant ou par nom (casse et accents ignorés). */
export async function resolveMealCategory(db: Db, idOrName: string): Promise<MealCategory> {
  const all = await listMealCategories(db, true);
  const n = normalizeText(idOrName);
  const found = all.find((c) => c.id === idOrName) ?? all.find((c) => normalizeText(c.name) === n) ?? all.find((c) => normalizeText(c.name).startsWith(n));
  if (!found) throw new DomainError(`Repas inconnu : « ${idOrName} ». Repas possibles : ${all.map((c) => c.name).join(', ')}.`);
  return found;
}

export async function createMealCategory(db: Db, name: string): Promise<string> {
  if (!name.trim()) throw new DomainError('Le nom du repas est obligatoire.');
  const id = newId();
  await db.execute(
    'INSERT INTO meal_category (id, name, sort) VALUES (?, ?, (SELECT coalesce(max(sort) + 1, 0) FROM meal_category))',
    [id, name.trim()],
  );
  return id;
}

export async function updateMealCategory(db: Db, id: string, patch: { name?: string; isActive?: boolean }): Promise<void> {
  if (patch.name !== undefined) {
    if (!patch.name.trim()) throw new DomainError('Le nom du repas est obligatoire.');
    await db.execute('UPDATE meal_category SET name = ? WHERE id = ?', [patch.name.trim(), id]);
  }
  if (patch.isActive !== undefined) await db.execute('UPDATE meal_category SET is_active = ? WHERE id = ?', [patch.isActive, id]);
}

export async function reorderMealCategories(db: Db, orderedIds: string[]): Promise<void> {
  await db.transaction(async (tx) => {
    for (const [i, id] of orderedIds.entries()) await tx.execute('UPDATE meal_category SET sort = ? WHERE id = ?', [i, id]);
  });
}

// --- Entrées du journal ------------------------------------------------------------

export function mapEntry(r: R): FoodEntry {
  return {
    id: r.id,
    date: r.date,
    mealCategoryId: r.meal_category_id,
    foodId: r.food_id,
    label: r.label,
    quantity: r.quantity,
    unit: r.unit,
    portionId: r.portion_id,
    portionLabel: r.portion_label,
    grams: r.grams,
    weightState: r.weight_state,
    kcal: r.kcal,
    proteinG: r.protein_g,
    carbsG: r.carbs_g,
    fatG: r.fat_g,
    fiberG: r.fiber_g,
    sugarsG: r.sugars_g,
    satFatG: r.sat_fat_g,
    saltG: r.salt_g,
    source: r.source,
    isEstimated: bool(r.is_estimated),
    note: r.note,
    createdVia: r.created_via,
  };
}

const estimateSchema = z.object({
  kcal: z.number().min(0).max(10000),
  proteinG: z.number().min(0).max(1000),
  carbsG: z.number().min(0).max(2000),
  fatG: z.number().min(0).max(1000),
  fiberG: z.number().min(0).max(200).nullable().optional(),
});

export const foodEntryInputSchema = z
  .object({
    date: dateSchema,
    meal: z.string().min(1),
    foodId: z.string().nullable().optional(),
    label: z.string().trim().max(200).nullable().optional(),
    quantity: z.number().positive().max(100000),
    unit: z.enum(['g', 'ml', 'portion']),
    portionId: z.string().nullable().optional(),
    weightState: z.enum(['raw', 'cooked', 'na']).optional(),
    estimated: z.boolean().default(false),
    /** Valeurs totales de l'entrée, pour une estimation sans aliment de référence. */
    estimatedNutrients: estimateSchema.nullable().optional(),
    note: z.string().max(1000).nullable().optional(),
  })
  .refine((d) => d.foodId || (d.label && d.estimatedNutrients), {
    message: 'Sans aliment de référence, indiquez un libellé et des valeurs estimées.',
  });
export type FoodEntryInput = z.input<typeof foodEntryInputSchema>;

/** Calcule le contenu d'une entrée (grammes, valeurs, avertissements) sans l'écrire. */
export async function previewFoodEntry(db: Db, input: FoodEntryInput) {
  const d = foodEntryInputSchema.parse(input);
  const meal = await resolveMealCategory(db, d.meal);
  if (!d.foodId) {
    const e = d.estimatedNutrients!;
    return {
      d,
      meal,
      label: d.label!,
      grams: d.unit === 'portion' ? d.quantity : d.quantity,
      portionLabel: d.unit === 'portion' ? 'portion' : null,
      weightState: d.weightState ?? 'na',
      nutrients: { kcal: e.kcal, proteinG: e.proteinG, carbsG: e.carbsG, fatG: e.fatG, fiberG: e.fiberG ?? null, sugarsG: null, satFatG: null, saltG: null },
      source: 'estimate' as const,
      estimated: true,
      warnings: [] as string[],
    };
  }
  const food = await getFood(db, d.foodId);
  if (!food) throw new DomainError('Aliment introuvable.');
  const portion = d.unit === 'portion' ? food.portions.find((p) => p.id === d.portionId) ?? food.portions.find((p) => p.isDefault) ?? food.portions[0] : null;
  const grams = quantityToGrams(d.quantity, d.unit, portion);
  const weightState = d.weightState ?? food.state;
  const conv = toFoodState(food, grams, weightState);
  const warnings: string[] = [];
  if (conv.mismatch) {
    warnings.push(
      `Poids ${weightState === 'raw' ? 'cru' : 'cuit'} saisi pour un aliment ${food.state === 'raw' ? 'cru' : 'cuit'} sans rendement de cuisson connu : valeurs calculées sans conversion.`,
    );
  }
  if (food.kcal == null) warnings.push("Énergie inconnue pour cet aliment dans la source.");
  return {
    d,
    meal,
    food,
    label: food.brand ? `${food.name} (${food.brand})` : food.name,
    grams: Math.round(grams * 10) / 10,
    portionLabel: portion?.label ?? null,
    portionId: portion?.id ?? null,
    weightState,
    nutrients: nutrientsFor(food, conv.grams),
    source: food.source,
    estimated: d.estimated,
    warnings,
  };
}

export async function addFoodEntry(db: Db, input: FoodEntryInput, via: Via = 'app'): Promise<FoodEntry> {
  const p = await previewFoodEntry(db, input);
  const id = newId();
  const now = nowIso();
  const n = p.nutrients;
  await db.transaction(async (tx) => {
    await tx.execute(
      `INSERT INTO food_entry (id, date, meal_category_id, food_id, label, quantity, unit, portion_id, portion_label, grams,
         weight_state, kcal, protein_g, carbs_g, fat_g, fiber_g, sugars_g, sat_fat_g, salt_g, source, is_estimated, note, sort,
         created_via, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
         (SELECT coalesce(max(sort) + 1, 0) FROM food_entry WHERE date = ? AND meal_category_id = ?), ?, ?, ?)`,
      [
        id, p.d.date, p.meal.id, p.d.foodId ?? null, p.label, p.d.quantity, p.d.unit, 'portionId' in p ? p.portionId : null,
        p.portionLabel, p.grams, p.weightState, n.kcal ?? 0, n.proteinG ?? 0, n.carbsG ?? 0, n.fatG ?? 0, n.fiberG, n.sugarsG,
        n.satFatG, n.saltG, p.source, p.estimated, p.d.note ?? null, p.d.date, p.meal.id, via, now, now,
      ],
    );
    if (p.d.foodId) await touchFood(tx, p.d.foodId);
  });
  return (await getFoodEntry(db, id))!;
}

export async function getFoodEntry(db: Db, id: string): Promise<FoodEntry | null> {
  const r = (await db.select<R>('SELECT * FROM food_entry WHERE id = ?', [id]))[0];
  return r ? mapEntry(r) : null;
}

export const foodEntryPatchSchema = z.object({
  quantity: z.number().positive().max(100000).optional(),
  unit: z.enum(['g', 'ml', 'portion']).optional(),
  portionId: z.string().nullable().optional(),
  weightState: z.enum(['raw', 'cooked', 'na']).optional(),
  meal: z.string().optional(),
  date: dateSchema.optional(),
  note: z.string().max(1000).nullable().optional(),
  estimated: z.boolean().optional(),
});
export type FoodEntryPatch = z.input<typeof foodEntryPatchSchema>;

/** Modifie une entrée ; les valeurs sont recalculées depuis l'aliment si la quantité change. */
export async function updateFoodEntry(db: Db, id: string, patch: FoodEntryPatch): Promise<FoodEntry> {
  const d = foodEntryPatchSchema.parse(patch);
  const e = await getFoodEntry(db, id);
  if (!e) throw new DomainError('Entrée introuvable.');
  const meal = d.meal ? await resolveMealCategory(db, d.meal) : null;
  let values: Record<string, unknown> = {};
  const qtyChanged = d.quantity !== undefined || d.unit !== undefined || d.portionId !== undefined || d.weightState !== undefined;
  if (qtyChanged && e.foodId) {
    const p = await previewFoodEntry(db, {
      date: e.date,
      meal: e.mealCategoryId,
      foodId: e.foodId,
      quantity: d.quantity ?? e.quantity,
      unit: d.unit ?? e.unit,
      portionId: d.portionId ?? e.portionId,
      weightState: d.weightState ?? e.weightState,
    });
    const n = p.nutrients;
    values = {
      quantity: p.d.quantity, unit: p.d.unit, portion_id: 'portionId' in p ? p.portionId : null, portion_label: p.portionLabel,
      grams: p.grams, weight_state: p.weightState, kcal: n.kcal ?? 0, protein_g: n.proteinG ?? 0, carbs_g: n.carbsG ?? 0,
      fat_g: n.fatG ?? 0, fiber_g: n.fiberG, sugars_g: n.sugarsG, sat_fat_g: n.satFatG, salt_g: n.saltG,
    };
  } else if (qtyChanged && d.quantity !== undefined) {
    // Estimation libre : mise à l'échelle proportionnelle.
    const f = d.quantity / e.quantity;
    values = {
      quantity: d.quantity, grams: e.grams * f, kcal: Math.round(e.kcal * f), protein_g: e.proteinG * f, carbs_g: e.carbsG * f,
      fat_g: e.fatG * f, fiber_g: e.fiberG == null ? null : e.fiberG * f,
    };
  }
  if (meal) values.meal_category_id = meal.id;
  if (d.date) values.date = d.date;
  if (d.note !== undefined) values.note = d.note;
  if (d.estimated !== undefined) values.is_estimated = d.estimated;
  const cols = Object.keys(values);
  if (cols.length) {
    await db.execute(`UPDATE food_entry SET ${cols.map((c) => `${c} = ?`).join(', ')}, updated_at = ? WHERE id = ?`, [
      ...cols.map((c) => values[c] as number | string | null),
      nowIso(),
      id,
    ]);
  }
  return (await getFoodEntry(db, id))!;
}

export async function deleteFoodEntry(db: Db, id: string): Promise<FoodEntry | null> {
  const e = await getFoodEntry(db, id);
  if (e) await db.execute('DELETE FROM food_entry WHERE id = ?', [id]);
  return e;
}

export async function listFoodEntries(db: Db, from: string, to: string): Promise<FoodEntry[]> {
  return (await db.select<R>('SELECT * FROM food_entry WHERE date BETWEEN ? AND ? ORDER BY date, sort, created_at', [from, to])).map(mapEntry);
}

export interface DayLog {
  date: string;
  dayType: DayType;
  dayTypeManual: boolean;
  goal: NutritionGoal | null;
  meals: { category: MealCategory; entries: FoodEntry[]; totals: MacroTotals }[];
  totals: MacroTotals;
  remaining: MacroTotals | null;
  estimatedCount: number;
}

export async function getDayLog(db: Db, date: string): Promise<DayLog> {
  dateSchema.parse(date);
  const categories = await listMealCategories(db, true);
  const entries = await listFoodEntries(db, date, date);
  const { dayType, manual } = await getDayType(db, date);
  const goal = await getGoalForDay(db, date, dayType);
  const meals = categories
    .filter((c) => c.isActive || entries.some((e) => e.mealCategoryId === c.id))
    .map((category) => {
      const list = entries.filter((e) => e.mealCategoryId === category.id);
      return { category, entries: list, totals: sumTotals(list) };
    });
  const totals = sumTotals(entries);
  const remaining = goal
    ? {
        kcal: Math.round((goal.kcal ?? 0) - totals.kcal),
        proteinG: Math.round(((goal.proteinG ?? 0) - totals.proteinG) * 10) / 10,
        carbsG: Math.round(((goal.carbsG ?? 0) - totals.carbsG) * 10) / 10,
        fatG: Math.round(((goal.fatG ?? 0) - totals.fatG) * 10) / 10,
        fiberG: Math.round(((goal.fiberG ?? 0) - totals.fiberG) * 10) / 10,
      }
    : null;
  return { date, dayType, dayTypeManual: manual, goal, meals, totals, remaining, estimatedCount: entries.filter((e) => e.isEstimated).length };
}

/** Recopie les entrées d'un jour (ou d'un seul repas) vers une autre date. */
export async function copyDay(db: Db, fromDate: string, toDate: string, mealCategoryId?: string): Promise<number> {
  dateSchema.parse(fromDate);
  dateSchema.parse(toDate);
  return db.transaction(async (tx) => {
    const rows = await tx.select<R>(
      `SELECT * FROM food_entry WHERE date = ? ${mealCategoryId ? 'AND meal_category_id = ?' : ''} ORDER BY sort`,
      mealCategoryId ? [fromDate, mealCategoryId] : [fromDate],
    );
    const now = nowIso();
    for (const r of rows) {
      await tx.execute(
        `INSERT INTO food_entry (id, date, meal_category_id, food_id, label, quantity, unit, portion_id, portion_label, grams,
           weight_state, kcal, protein_g, carbs_g, fat_g, fiber_g, sugars_g, sat_fat_g, salt_g, source, is_estimated, note, sort,
           created_via, created_at, updated_at)
         SELECT ?, ?, meal_category_id, food_id, label, quantity, unit, portion_id, portion_label, grams, weight_state, kcal,
           protein_g, carbs_g, fat_g, fiber_g, sugars_g, sat_fat_g, salt_g, source, is_estimated, note,
           (SELECT coalesce(max(sort) + 1, 0) FROM food_entry WHERE date = ? AND meal_category_id = ?), 'app', ?, ?
         FROM food_entry WHERE id = ?`,
        [newId(), toDate, toDate, r.meal_category_id, now, now, r.id],
      );
    }
    return rows.length;
  });
}

// --- Repas enregistrés ------------------------------------------------------------------

export interface SavedMeal {
  id: string;
  name: string;
  mealCategoryId: string | null;
  items: { id: string; foodId: string; foodName: string; quantity: number; unit: string; portionId: string | null; weightState: string }[];
  totals: MacroTotals;
}

export async function listSavedMeals(db: Db, query?: string): Promise<SavedMeal[]> {
  const meals = await db.select<R>('SELECT * FROM saved_meal ORDER BY name');
  const items = await db.select<R>(
    `SELECT i.*, f.name AS food_name FROM saved_meal_item i JOIN food f ON f.id = i.food_id ORDER BY i.sort`,
  );
  const foods = await getFoodsByIds(db, [...new Set(items.map((i) => i.food_id as string))]);
  const out: SavedMeal[] = [];
  for (const m of meals) {
    if (query && !normalizeText(m.name).includes(normalizeText(query))) continue;
    const list = items.filter((i) => i.saved_meal_id === m.id);
    const totals = sumTotals(
      list.map((i) => {
        const food = foods.get(i.food_id)!;
        const portion = food.portions.find((p) => p.id === i.portion_id) ?? food.portions[0];
        const grams = i.unit === 'portion' && !portion ? 0 : quantityToGrams(i.quantity, i.unit, portion);
        return nutrientsFor(food, toFoodState(food, grams, i.weight_state).grams);
      }),
    );
    out.push({
      id: m.id,
      name: m.name,
      mealCategoryId: m.meal_category_id,
      items: list.map((i) => ({ id: i.id, foodId: i.food_id, foodName: i.food_name, quantity: i.quantity, unit: i.unit, portionId: i.portion_id, weightState: i.weight_state })),
      totals,
    });
  }
  return out;
}

/** Enregistre des entrées existantes (issues d'aliments) comme repas réutilisable. */
export async function createSavedMealFromEntries(db: Db, name: string, entryIds: string[], mealCategoryId: string | null = null): Promise<string> {
  if (!name.trim()) throw new DomainError('Nommez le repas.');
  return db.transaction(async (tx) => {
    const rows = await tx.select<R>(
      `SELECT * FROM food_entry WHERE id IN (${entryIds.map(() => '?').join(',')}) AND food_id IS NOT NULL ORDER BY sort`,
      entryIds,
    );
    if (!rows.length) throw new DomainError('Aucune entrée liée à un aliment à enregistrer (les estimations libres sont ignorées).');
    const id = newId();
    const now = nowIso();
    await tx.execute('INSERT INTO saved_meal (id, name, meal_category_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', [
      id, name.trim(), mealCategoryId, now, now,
    ]);
    for (const [i, r] of rows.entries()) {
      await tx.execute(
        'INSERT INTO saved_meal_item (id, saved_meal_id, food_id, quantity, unit, portion_id, weight_state, sort) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [newId(), id, r.food_id, r.quantity, r.unit, r.portion_id, r.weight_state, i],
      );
    }
    return id;
  });
}

export async function deleteSavedMeal(db: Db, id: string): Promise<void> {
  await db.execute('DELETE FROM saved_meal WHERE id = ?', [id]);
}

/** Ajoute un repas enregistré au journal (quantités multipliées par `scale`). */
export async function logSavedMeal(
  db: Db,
  savedMealId: string,
  date: string,
  meal?: string | null,
  scale = 1,
  via: Via = 'app',
): Promise<FoodEntry[]> {
  const sm = (await listSavedMeals(db)).find((m) => m.id === savedMealId);
  if (!sm) throw new DomainError('Repas enregistré introuvable.');
  const target = meal ?? sm.mealCategoryId;
  if (!target) throw new DomainError('Précisez le repas (petit-déjeuner, déjeuner…).');
  if (!(scale > 0)) throw new DomainError('Le facteur doit être positif.');
  const out: FoodEntry[] = [];
  await db.transaction(async (tx) => {
    for (const i of sm.items) {
      out.push(
        await addFoodEntry(
          tx,
          { date, meal: target, foodId: i.foodId, quantity: i.quantity * scale, unit: i.unit as 'g', portionId: i.portionId, weightState: i.weightState as 'na' },
          via,
        ),
      );
    }
  });
  return out;
}

/**
 * Recalcule les entrées enregistrées à 0 kcal parce que l'aliment n'avait pas d'énergie connue
 * (trous de Ciqual), une fois l'aliment complété. Retourne le nombre d'entrées corrigées.
 */
export async function recomputeEntriesMissingEnergy(db: Db): Promise<number> {
  const rows = await db.select<R>(
    `SELECT e.* FROM food_entry e JOIN food f ON f.id = e.food_id
      WHERE e.kcal = 0 AND (e.protein_g + e.carbs_g + e.fat_g) > 0 AND f.kcal > 0 AND e.is_estimated = 0`,
  );
  if (!rows.length) return 0;
  const foods = await getFoodsByIds(db, [...new Set(rows.map((r) => r.food_id as string))]);
  await db.transaction(async (tx) => {
    for (const r of rows) {
      const food = foods.get(r.food_id)!;
      const n = nutrientsFor(food, toFoodState(food, r.grams, r.weight_state).grams);
      await tx.execute(
        'UPDATE food_entry SET kcal = ?, protein_g = ?, carbs_g = ?, fat_g = ?, fiber_g = ?, sugars_g = ?, sat_fat_g = ?, salt_g = ?, updated_at = ? WHERE id = ?',
        [n.kcal ?? 0, n.proteinG ?? 0, n.carbsG ?? 0, n.fatG ?? 0, n.fiberG, n.sugarsG, n.satFatG, n.saltG, nowIso(), r.id],
      );
    }
  });
  return rows.length;
}
