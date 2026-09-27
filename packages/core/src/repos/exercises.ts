import type { Db } from '../db/driver.ts';
import { newId } from '../db/ids.ts';
import { DomainError, bool, normalizeText, nowIso, updateColumns } from '../db/util.ts';
import {
  exerciseInputSchema,
  exercisePatchSchema,
  type ExerciseInput,
  type ExercisePatch,
} from '../schemas/program.ts';
import type { Exercise, ExerciseMuscle, ExerciseOrigin, MuscleGroup } from '../types.ts';

interface ExerciseRow {
  id: string;
  name: string;
  kind: Exercise['kind'];
  equipment: string | null;
  technique_notes: string | null;
  origin: ExerciseOrigin;
  is_archived: number;
  created_at: string;
  updated_at: string;
}

export async function listMuscleGroups(db: Db): Promise<MuscleGroup[]> {
  return db.select<MuscleGroup>('SELECT id, name, region, sort FROM muscle_group ORDER BY sort');
}

async function loadMuscles(db: Db, ids: string[]): Promise<Map<string, ExerciseMuscle[]>> {
  const map = new Map<string, ExerciseMuscle[]>();
  if (ids.length === 0) return map;
  const rows = await db.select<{ exercise_id: string; muscle_group_id: string; role: ExerciseMuscle['role'] }>(
    `SELECT em.exercise_id, em.muscle_group_id, em.role
       FROM exercise_muscle em JOIN muscle_group mg ON mg.id = em.muscle_group_id
      WHERE em.exercise_id IN (${ids.map(() => '?').join(',')})
      ORDER BY em.role, mg.sort`,
    ids,
  );
  for (const r of rows) {
    const list = map.get(r.exercise_id) ?? [];
    list.push({ muscleGroupId: r.muscle_group_id, role: r.role });
    map.set(r.exercise_id, list);
  }
  return map;
}

function mapExercise(r: ExerciseRow, muscles: ExerciseMuscle[]): Exercise {
  return {
    id: r.id,
    name: r.name,
    kind: r.kind,
    equipment: r.equipment,
    techniqueNotes: r.technique_notes,
    origin: r.origin,
    isArchived: bool(r.is_archived),
    muscles,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function listExercises(
  db: Db,
  opts: { includeArchived?: boolean } = {},
): Promise<Exercise[]> {
  const rows = await db.select<ExerciseRow>(
    `SELECT * FROM exercise ${opts.includeArchived ? '' : 'WHERE is_archived = 0'} ORDER BY name_norm`,
  );
  const muscles = await loadMuscles(db, rows.map((r) => r.id));
  return rows.map((r) => mapExercise(r, muscles.get(r.id) ?? []));
}

export async function getExercise(db: Db, id: string): Promise<Exercise | null> {
  const rows = await db.select<ExerciseRow>('SELECT * FROM exercise WHERE id = ?', [id]);
  const r = rows[0];
  if (!r) return null;
  const muscles = await loadMuscles(db, [id]);
  return mapExercise(r, muscles.get(id) ?? []);
}

/** Exercice actif (non archivé) portant ce nom, à la casse et aux accents près. */
export async function findExerciseByName(db: Db, name: string): Promise<Exercise | null> {
  const rows = await db.select<{ id: string }>(
    'SELECT id FROM exercise WHERE name_norm = ? AND is_archived = 0',
    [normalizeText(name)],
  );
  return rows[0] ? getExercise(db, rows[0].id) : null;
}

async function assertNameFree(db: Db, name: string, exceptId?: string): Promise<void> {
  const rows = await db.select<{ id: string }>(
    'SELECT id FROM exercise WHERE name_norm = ? AND is_archived = 0 AND id != ?',
    [normalizeText(name), exceptId ?? ''],
  );
  if (rows.length > 0) throw new DomainError(`Un exercice nommé « ${name.trim()} » existe déjà.`);
}

async function writeMuscles(db: Db, exerciseId: string, muscles: ExerciseMuscle[]): Promise<void> {
  await db.execute('DELETE FROM exercise_muscle WHERE exercise_id = ?', [exerciseId]);
  const seen = new Set<string>();
  for (const m of muscles) {
    if (seen.has(m.muscleGroupId)) continue;
    seen.add(m.muscleGroupId);
    await db.execute(
      `INSERT INTO exercise_muscle (exercise_id, muscle_group_id, role)
       SELECT ?, id, ? FROM muscle_group WHERE id = ?`,
      [exerciseId, m.role, m.muscleGroupId],
    );
  }
}

export async function createExercise(
  db: Db,
  input: ExerciseInput,
  origin: ExerciseOrigin = 'user',
): Promise<Exercise> {
  const data = exerciseInputSchema.parse(input);
  const id = newId();
  const now = nowIso();
  await db.transaction(async (tx) => {
    await assertNameFree(tx, data.name);
    await tx.execute(
      `INSERT INTO exercise (id, name, name_norm, kind, equipment, technique_notes, origin, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, data.name, normalizeText(data.name), data.kind, data.equipment ?? null, data.techniqueNotes ?? null, origin, now, now],
    );
    if (data.muscles) await writeMuscles(tx, id, data.muscles);
  });
  return (await getExercise(db, id))!;
}

export async function updateExercise(db: Db, id: string, patch: ExercisePatch): Promise<Exercise> {
  const data = exercisePatchSchema.parse(patch);
  await db.transaction(async (tx) => {
    const current = await getExercise(tx, id);
    if (!current) throw new DomainError('Exercice introuvable.');
    if (data.name !== undefined) await assertNameFree(tx, data.name, id);
    await updateColumns(
      tx,
      'exercise',
      id,
      { ...data, nameNorm: data.name !== undefined ? normalizeText(data.name) : undefined },
      { name: 'name', nameNorm: 'name_norm', kind: 'kind', equipment: 'equipment', techniqueNotes: 'technique_notes' },
    );
    if (data.muscles) await writeMuscles(tx, id, data.muscles);
  });
  return (await getExercise(db, id))!;
}

/** Nombre de slots du programme actif qui utilisent cet exercice. */
export async function countActiveProgramUsages(db: Db, exerciseId: string): Promise<number> {
  const r = await db.select<{ n: number }>(
    `SELECT count(*) AS n FROM slot_option so
       JOIN template_slot ts ON ts.id = so.slot_id
       JOIN workout_template wt ON wt.id = ts.template_id
       JOIN program p ON p.id = wt.program_id
      WHERE so.exercise_id = ? AND p.is_active = 1`,
    [exerciseId],
  );
  return r[0]?.n ?? 0;
}

/** Archive (masque) un exercice ; l'historique qui le référence reste intact. */
export async function setExerciseArchived(db: Db, id: string, archived: boolean): Promise<void> {
  await db.transaction(async (tx) => {
    const ex = await getExercise(tx, id);
    if (!ex) throw new DomainError('Exercice introuvable.');
    if (archived && (await countActiveProgramUsages(tx, id)) > 0) {
      throw new DomainError('Cet exercice est utilisé dans le programme actif : retirez-le des séances avant de l’archiver.');
    }
    if (!archived) await assertNameFree(tx, ex.name, id);
    await tx.execute('UPDATE exercise SET is_archived = ?, updated_at = ? WHERE id = ?', [archived, nowIso(), id]);
  });
}
