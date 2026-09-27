import { z } from 'zod';
import type { Db } from '../db/driver.ts';
import { newId } from '../db/ids.ts';
import { nowIso } from '../db/util.ts';
import type { DayType, GoalDayType, NutritionGoal } from '../types.ts';

type R = Record<string, any>;

export const DAY_TYPE_LABELS: Record<GoalDayType, string> = {
  default: 'Par défaut',
  rest: 'Repos',
  training: 'Musculation',
  cardio: 'Cardio',
};

function mapGoal(r: R): NutritionGoal {
  return {
    id: r.id,
    dayType: r.day_type,
    validFrom: r.valid_from,
    kcal: r.kcal,
    proteinG: r.protein_g,
    carbsG: r.carbs_g,
    fatG: r.fat_g,
    fiberG: r.fiber_g,
  };
}

/** Objectifs en vigueur à une date (le plus récent `valid_from` <= date), par type de jour. */
export async function getGoalsAt(db: Db, date: string): Promise<Partial<Record<GoalDayType, NutritionGoal>>> {
  const rows = await db.select<R>(
    `SELECT g.* FROM nutrition_goal g
      WHERE g.valid_from = (SELECT max(valid_from) FROM nutrition_goal x WHERE x.day_type = g.day_type AND x.valid_from <= ?)`,
    [date],
  );
  return Object.fromEntries(rows.map((r) => [r.day_type, mapGoal(r)]));
}

/** Objectif applicable : celui du type de jour, chaque valeur absente reprenant celle « par défaut ». */
export async function getGoalForDay(db: Db, date: string, dayType: DayType): Promise<NutritionGoal | null> {
  const goals = await getGoalsAt(db, date);
  const specific = goals[dayType];
  const def = goals.default;
  if (!specific) return def ?? null;
  if (!def) return specific;
  return {
    ...specific,
    kcal: specific.kcal ?? def.kcal,
    proteinG: specific.proteinG ?? def.proteinG,
    carbsG: specific.carbsG ?? def.carbsG,
    fatG: specific.fatG ?? def.fatG,
    fiberG: specific.fiberG ?? def.fiberG,
  };
}

export const goalInputSchema = z.object({
  kcal: z.number().min(0).max(10000).nullable(),
  proteinG: z.number().min(0).max(1000).nullable(),
  carbsG: z.number().min(0).max(2000).nullable(),
  fatG: z.number().min(0).max(1000).nullable(),
  fiberG: z.number().min(0).max(200).nullable(),
});

/**
 * Enregistre un objectif applicable à partir de `validFrom` (aujourd'hui par défaut) :
 * les jours passés gardent les objectifs d'alors.
 */
export async function setGoal(
  db: Db,
  dayType: GoalDayType,
  values: Partial<z.input<typeof goalInputSchema>>,
  validFrom: string,
): Promise<void> {
  const current = (await getGoalsAt(db, validFrom))[dayType];
  const merged = goalInputSchema.parse({
    kcal: current?.kcal ?? null,
    proteinG: current?.proteinG ?? null,
    carbsG: current?.carbsG ?? null,
    fatG: current?.fatG ?? null,
    fiberG: current?.fiberG ?? null,
    ...values,
  });
  await db.execute(
    `INSERT INTO nutrition_goal (id, day_type, valid_from, kcal, protein_g, carbs_g, fat_g, fiber_g)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (day_type, valid_from) DO UPDATE SET kcal = excluded.kcal, protein_g = excluded.protein_g,
       carbs_g = excluded.carbs_g, fat_g = excluded.fat_g, fiber_g = excluded.fiber_g`,
    [newId(), dayType, validFrom, merged.kcal, merged.proteinG, merged.carbsG, merged.fatG, merged.fiberG],
  );
}

/**
 * Type de jour : choisi manuellement, sinon déduit (séance de musculation ce jour-là → musculation,
 * cardio seul → cardio, sinon repos).
 */
export async function getDayType(db: Db, date: string): Promise<{ dayType: DayType; manual: boolean }> {
  const info = (await db.select<R>('SELECT day_type FROM day_info WHERE date = ?', [date]))[0];
  if (info?.day_type) return { dayType: info.day_type, manual: true };
  const s = (await db.select<R>("SELECT 1 FROM workout_session WHERE date = ? AND status != 'skipped' LIMIT 1", [date]))[0];
  if (s) return { dayType: 'training', manual: false };
  const c = (await db.select<R>('SELECT 1 FROM cardio_session WHERE date = ? LIMIT 1', [date]))[0];
  return { dayType: c ? 'cardio' : 'rest', manual: false };
}

export async function setDayType(db: Db, date: string, dayType: DayType | null): Promise<void> {
  await db.execute(
    `INSERT INTO day_info (date, day_type, updated_at) VALUES (?, ?, ?)
     ON CONFLICT (date) DO UPDATE SET day_type = excluded.day_type, updated_at = excluded.updated_at`,
    [date, dayType, nowIso()],
  );
}

/** Ajoute une note au jour (sans écraser la note existante). */
export async function appendDayNote(db: Db, date: string, note: string): Promise<void> {
  await db.execute(
    `INSERT INTO day_info (date, note, updated_at) VALUES (?, ?, ?)
     ON CONFLICT (date) DO UPDATE SET note = CASE WHEN day_info.note IS NULL OR day_info.note = '' THEN excluded.note
       ELSE day_info.note || char(10) || excluded.note END, updated_at = excluded.updated_at`,
    [date, note, nowIso()],
  );
}

export async function getDayNote(db: Db, date: string): Promise<string | null> {
  return (await db.select<{ note: string | null }>('SELECT note FROM day_info WHERE date = ?', [date]))[0]?.note ?? null;
}
