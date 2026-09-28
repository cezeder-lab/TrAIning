import { z } from 'zod';
import type { Db } from '../db/driver.ts';
import { newId } from '../db/ids.ts';
import { DomainError, bool, normalizeText, nowIso, updateColumns } from '../db/util.ts';
import type { Food, FoodPortion, FoodSource } from '../types.ts';

type R = Record<string, any>;

export const FOOD_COLUMNS: Record<string, string> = {
  name: 'name',
  brand: 'brand',
  aliases: 'aliases',
  category: 'category',
  basis: 'basis',
  state: 'state',
  cookedYield: 'cooked_yield',
  kcal: 'kcal',
  proteinG: 'protein_g',
  carbsG: 'carbs_g',
  sugarsG: 'sugars_g',
  fatG: 'fat_g',
  satFatG: 'sat_fat_g',
  fiberG: 'fiber_g',
  saltG: 'salt_g',
  alcoholG: 'alcohol_g',
};

export function mapFood(r: R, portions: FoodPortion[] = []): Food {
  let flags: Record<string, string> = {};
  try {
    flags = r.value_flags ? JSON.parse(r.value_flags) : {};
  } catch {
    flags = {};
  }
  return {
    id: r.id,
    source: r.source,
    sourceRef: r.source_ref,
    name: r.name,
    brand: r.brand,
    category: r.category,
    basis: r.basis,
    state: r.state,
    cookedYield: r.cooked_yield,
    kcal: r.kcal,
    proteinG: r.protein_g,
    carbsG: r.carbs_g,
    sugarsG: r.sugars_g,
    fatG: r.fat_g,
    satFatG: r.sat_fat_g,
    fiberG: r.fiber_g,
    saltG: r.salt_g,
    alcoholG: r.alcohol_g,
    valueFlags: flags,
    isFavorite: bool(r.is_favorite),
    useCount: r.use_count,
    lastUsedAt: r.last_used_at,
    sourceVersion: r.source_version,
    isArchived: bool(r.is_archived),
    portions,
  };
}

function mapPortion(r: R): FoodPortion {
  return { id: r.id, foodId: r.food_id, label: r.label, grams: r.grams, isDefault: bool(r.is_default) };
}

export async function loadPortions(db: Db, foodIds: string[]): Promise<Map<string, FoodPortion[]>> {
  const map = new Map<string, FoodPortion[]>();
  if (!foodIds.length) return map;
  for (let i = 0; i < foodIds.length; i += 500) {
    const chunk = foodIds.slice(i, i + 500);
    const rows = await db.select<R>(
      `SELECT * FROM food_portion WHERE food_id IN (${chunk.map(() => '?').join(',')}) ORDER BY sort`,
      chunk,
    );
    for (const r of rows) {
      const list = map.get(r.food_id) ?? [];
      list.push(mapPortion(r));
      map.set(r.food_id, list);
    }
  }
  return map;
}

export async function getFood(db: Db, id: string): Promise<Food | null> {
  const r = (await db.select<R>('SELECT * FROM food WHERE id = ?', [id]))[0];
  if (!r) return null;
  return mapFood(r, (await loadPortions(db, [id])).get(id) ?? []);
}

export async function getFoodsByIds(db: Db, ids: string[]): Promise<Map<string, Food>> {
  const map = new Map<string, Food>();
  if (!ids.length) return map;
  const rows = await db.select<R>(`SELECT * FROM food WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
  const portions = await loadPortions(db, rows.map((r) => r.id));
  for (const r of rows) map.set(r.id, mapFood(r, portions.get(r.id) ?? []));
  return map;
}

export async function listFoods(
  db: Db,
  filter: { sources?: FoodSource[]; favoritesOnly?: boolean; includeArchived?: boolean } = {},
): Promise<Food[]> {
  const where: string[] = [];
  const params: string[] = [];
  if (!filter.includeArchived) where.push('is_archived = 0');
  if (filter.sources?.length) {
    where.push(`source IN (${filter.sources.map(() => '?').join(',')})`);
    params.push(...filter.sources);
  }
  if (filter.favoritesOnly) where.push('is_favorite = 1');
  const rows = await db.select<R>(`SELECT * FROM food ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY name_norm`, params);
  const portions = await loadPortions(db, rows.map((r) => r.id));
  return rows.map((r) => mapFood(r, portions.get(r.id) ?? []));
}

export async function countFoodsBySource(db: Db): Promise<Record<string, number>> {
  const rows = await db.select<{ source: string; n: number }>('SELECT source, count(*) AS n FROM food WHERE is_archived = 0 GROUP BY source');
  return Object.fromEntries(rows.map((r) => [r.source, r.n]));
}

const nutrient = z.number().min(0).max(1000).nullable().optional();

export const foodInputSchema = z.object({
  name: z.string().trim().min(1, 'Le nom est obligatoire.').max(200),
  brand: z.string().trim().max(120).nullable().optional(),
  category: z.string().max(120).nullable().optional(),
  basis: z.enum(['100g', '100ml']).default('100g'),
  state: z.enum(['raw', 'cooked', 'na']).default('na'),
  cookedYield: z.number().min(0.05).max(10).nullable().optional(),
  kcal: z.number().min(0).max(1000),
  proteinG: z.number().min(0).max(100),
  carbsG: z.number().min(0).max(100),
  fatG: z.number().min(0).max(100),
  sugarsG: nutrient,
  satFatG: nutrient,
  fiberG: nutrient,
  saltG: nutrient,
  alcoholG: nutrient,
  portions: z.array(z.object({ label: z.string().trim().min(1).max(80), grams: z.number().positive().max(10000) })).optional(),
  sourceNote: z.string().max(200).nullable().optional(),
});
export type FoodInput = z.input<typeof foodInputSchema>;

/** Aliment personnel (étiquette, recette du commerce…). */
export async function createCustomFood(db: Db, input: FoodInput, via: 'app' | 'mcp' = 'app'): Promise<string> {
  const d = foodInputSchema.parse(input);
  return insertFood(db, 'custom', null, d, { via, sourceVersion: d.sourceNote ?? null });
}

export async function insertFood(
  db: Db,
  source: FoodSource,
  sourceRef: string | null,
  d: z.output<typeof foodInputSchema> | (Record<string, unknown> & { name: string }),
  opts: { via?: string; sourceVersion?: string | null; flags?: Record<string, string> } = {},
): Promise<string> {
  const id = newId();
  const now = nowIso();
  const data = d as Record<string, unknown>;
  const keys = Object.keys(FOOD_COLUMNS).filter((k) => data[k] !== undefined);
  await db.transaction(async (tx) => {
    await tx.execute(
      `INSERT INTO food (id, source, source_ref, name_norm, source_version, value_flags, created_via, created_at, updated_at,
         ${keys.map((k) => FOOD_COLUMNS[k]).join(', ')})
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ${keys.map(() => '?').join(', ')})`,
      [
        id, source, sourceRef, normalizeText(`${d.name} ${(data.brand as string) ?? ''}`), opts.sourceVersion ?? null,
        opts.flags && Object.keys(opts.flags).length ? JSON.stringify(opts.flags) : null, opts.via ?? 'app', now, now,
        ...keys.map((k) => data[k] as number | string | null),
      ],
    );
    const portions = (data.portions as { label: string; grams: number }[] | undefined) ?? [];
    for (const [i, p] of portions.entries()) {
      await tx.execute('INSERT INTO food_portion (id, food_id, label, grams, is_default, sort) VALUES (?, ?, ?, ?, ?, ?)', [
        newId(), id, p.label, p.grams, i === 0, i,
      ]);
    }
  });
  return id;
}

/** Modification d'un aliment. Les valeurs nutritionnelles ne sont modifiables que pour les aliments perso. */
export async function updateFood(db: Db, id: string, patch: Partial<FoodInput>): Promise<void> {
  const food = await getFood(db, id);
  if (!food) throw new DomainError('Aliment introuvable.');
  const parsed = foodInputSchema.partial().parse(patch) as Record<string, unknown>;
  // .partial() conserve les valeurs par défaut du schéma : on ne garde que les champs fournis.
  const d = Object.fromEntries(Object.entries(parsed).filter(([k]) => k in patch));
  const editable = food.source === 'custom' ? Object.keys(FOOD_COLUMNS).filter((k) => k !== 'aliases') : ['cookedYield', 'state', 'category'];
  const blocked = Object.keys(d).filter((k) => k in FOOD_COLUMNS && !editable.includes(k) && d[k] !== undefined);
  if (blocked.length) throw new DomainError('Les valeurs des aliments Ciqual, FCÉN, Open Food Facts et des recettes ne sont pas modifiables ici.');
  const cols = Object.fromEntries(Object.entries(FOOD_COLUMNS).filter(([k]) => editable.includes(k)));
  if (d.name !== undefined || d.brand !== undefined) {
    cols.nameNorm = 'name_norm';
    d.nameNorm = normalizeText(`${(d.name as string) ?? food.name} ${((d.brand as string) ?? food.brand) ?? ''}`);
  }
  await updateColumns(db, 'food', id, d, cols);
}

export async function setFoodFavorite(db: Db, id: string, favorite: boolean): Promise<void> {
  await db.execute('UPDATE food SET is_favorite = ? WHERE id = ?', [favorite, id]);
}

export async function setFoodArchived(db: Db, id: string, archived: boolean): Promise<void> {
  await db.execute('UPDATE food SET is_archived = ?, updated_at = ? WHERE id = ?', [archived, nowIso(), id]);
}

export async function addFoodPortion(db: Db, foodId: string, label: string, grams: number): Promise<string> {
  if (!label.trim()) throw new DomainError('Nommez la portion (ex. « 1 pot »).');
  if (!(grams > 0)) throw new DomainError('Le poids de la portion doit être positif.');
  const id = newId();
  await db.execute(
    `INSERT INTO food_portion (id, food_id, label, grams, is_default, sort)
     VALUES (?, ?, ?, ?, (SELECT count(*) = 0 FROM food_portion WHERE food_id = ?),
             (SELECT coalesce(max(sort) + 1, 0) FROM food_portion WHERE food_id = ?))`,
    [id, foodId, label.trim(), grams, foodId, foodId],
  );
  return id;
}

export async function deleteFoodPortion(db: Db, id: string): Promise<void> {
  await db.execute('DELETE FROM food_portion WHERE id = ?', [id]);
}

/** Marque l'aliment comme utilisé (alimente « récents »). */
export async function touchFood(db: Db, id: string): Promise<void> {
  await db.execute('UPDATE food SET use_count = use_count + 1, last_used_at = ? WHERE id = ?', [nowIso(), id]);
}

/**
 * Insertion ou mise à jour en masse depuis une source externe (Ciqual, FCÉN, Open Food Facts),
 * identifiée par (source, source_ref) : les identifiants restent stables.
 */
export async function upsertExternalFoods(
  db: Db,
  source: 'ciqual' | 'cnf' | 'off',
  foods: (Record<string, unknown> & { sourceRef: string; name: string; flags?: Record<string, string> })[],
  sourceVersion: string,
): Promise<{ inserted: number; updated: number }> {
  let inserted = 0;
  let updated = 0;
  for (let i = 0; i < foods.length; i += 250) {
    await db.transaction(async (tx) => {
      for (const f of foods.slice(i, i + 250)) {
        const existing = (await tx.select<{ id: string }>('SELECT id FROM food WHERE source = ? AND source_ref = ?', [source, f.sourceRef]))[0];
        if (!existing) {
          await insertFood(tx, source, f.sourceRef, f, { sourceVersion, flags: f.flags });
          inserted++;
          continue;
        }
        const keys = Object.keys(FOOD_COLUMNS).filter((k) => k !== 'cookedYield' && f[k] !== undefined);
        await tx.execute(
          `UPDATE food SET ${keys.map((k) => `${FOOD_COLUMNS[k]} = ?`).join(', ')}, name_norm = ?, source_version = ?,
             value_flags = ?, updated_at = ? WHERE id = ?`,
          [
            ...keys.map((k) => f[k] as number | string | null),
            normalizeText(`${f.name} ${(f.brand as string) ?? ''}`), sourceVersion,
            f.flags && Object.keys(f.flags).length ? JSON.stringify(f.flags) : null, nowIso(), existing.id,
          ],
        );
        updated++;
      }
    });
  }
  return { inserted, updated };
}
