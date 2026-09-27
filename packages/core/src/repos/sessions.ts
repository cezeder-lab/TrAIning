import { z } from 'zod';
import type { Db } from '../db/driver.ts';
import { newId } from '../db/ids.ts';
import { DomainError, bool, nowIso, rewriteSort, updateColumns } from '../db/util.ts';
import { effectiveTargets } from '../services/format.ts';
import type {
  PainEntry,
  SessionExercise,
  SessionSummary,
  SetEntry,
  WorkoutSession,
} from '../types.ts';
import { SESSION_STATUSES } from '../types.ts';
import { listCardio } from './cardio.ts';
import { getProgram } from './program.ts';

type R = Record<string, any>;
export type Via = 'app' | 'mcp';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const dateSchema = z.string().regex(DATE_RE, 'Date attendue au format AAAA-MM-JJ.');

function mapSet(r: R): SetEntry {
  return {
    id: r.id,
    sessionExerciseId: r.session_exercise_id,
    setIndex: r.set_index,
    isWarmup: bool(r.is_warmup),
    plannedLoadKg: r.planned_load_kg,
    plannedValue: r.planned_value,
    loadKg: r.load_kg,
    value: r.value,
    isDone: bool(r.is_done),
    rir: r.rir,
    rpe: r.rpe,
    comment: r.comment,
  };
}

export function mapPain(r: R): PainEntry {
  return {
    id: r.id,
    date: r.date,
    sessionId: r.session_id,
    zone: r.zone,
    side: r.side,
    intensity: r.intensity,
    context: r.context,
    note: r.note,
    createdVia: r.created_via,
    createdAt: r.created_at,
  };
}

// --- Dernière performance ------------------------------------------------------

export interface LastPerformance {
  sessionId: string;
  date: string;
  sets: { loadKg: number | null; value: number | null; rir: number | null }[];
}

/**
 * Séries cochées de la dernière séance (antérieure à `beforeDate`, ou même jour mais autre séance)
 * où l'exercice a été fait. Sert au pré-remplissage et à la comparaison.
 */
export async function getLastPerformance(
  db: Db,
  exerciseId: string,
  opts: { beforeDate?: string; excludeSessionId?: string } = {},
): Promise<LastPerformance | null> {
  const rows = await db.select<R>(
    `SELECT ws.id AS session_id, ws.date, se.id AS se_id
       FROM session_exercise se JOIN workout_session ws ON ws.id = se.session_id
      WHERE se.exercise_id = ? AND ws.id != ? AND ws.date <= ?
        AND EXISTS (SELECT 1 FROM set_entry s WHERE s.session_exercise_id = se.id AND s.is_done = 1 AND s.is_warmup = 0)
      ORDER BY ws.date DESC, ws.created_at DESC LIMIT 1`,
    [exerciseId, opts.excludeSessionId ?? '', opts.beforeDate ?? '9999-12-31'],
  );
  const r = rows[0];
  if (!r) return null;
  const sets = await db.select<R>(
    'SELECT load_kg, value, rir FROM set_entry WHERE session_exercise_id = ? AND is_done = 1 AND is_warmup = 0 ORDER BY set_index',
    [r.se_id],
  );
  return {
    sessionId: r.session_id,
    date: r.date,
    sets: sets.map((s) => ({ loadKg: s.load_kg, value: s.value, rir: s.rir })),
  };
}

// --- Lecture ---------------------------------------------------------------------

export async function getSession(db: Db, id: string): Promise<WorkoutSession | null> {
  const s = (await db.select<R>('SELECT * FROM workout_session WHERE id = ?', [id]))[0];
  if (!s) return null;
  const exRows = await db.select<R>(
    `SELECT se.*, e.name AS exercise_name, e.kind AS exercise_kind
       FROM session_exercise se JOIN exercise e ON e.id = se.exercise_id
      WHERE se.session_id = ? ORDER BY se.sort`,
    [id],
  );
  const setRows = await db.select<R>(
    `SELECT s.* FROM set_entry s JOIN session_exercise se ON se.id = s.session_exercise_id
      WHERE se.session_id = ? ORDER BY s.set_index`,
    [id],
  );
  const altIds = new Set<string>();
  for (const e of exRows) for (const a of JSON.parse(e.alternatives ?? '[]') as string[]) altIds.add(a);
  const names = new Map<string, string>();
  if (altIds.size) {
    const rows = await db.select<R>(
      `SELECT id, name FROM exercise WHERE id IN (${[...altIds].map(() => '?').join(',')})`,
      [...altIds],
    );
    for (const r of rows) names.set(r.id, r.name);
  }
  const setsBy = new Map<string, SetEntry[]>();
  for (const r of setRows) {
    const list = setsBy.get(r.session_exercise_id) ?? [];
    list.push(mapSet(r));
    setsBy.set(r.session_exercise_id, list);
  }
  const exercises: SessionExercise[] = exRows.map((e) => ({
    id: e.id,
    sessionId: e.session_id,
    templateSlotId: e.template_slot_id,
    sort: e.sort,
    block: e.block,
    blockLabel: e.block_label,
    label: e.label,
    exerciseId: e.exercise_id,
    exerciseName: e.exercise_name,
    exerciseKind: e.exercise_kind,
    alternatives: (JSON.parse(e.alternatives ?? '[]') as string[])
      .filter((a) => names.has(a))
      .map((a) => ({ exerciseId: a, name: names.get(a)! })),
    sets: e.sets,
    targetMin: e.target_min,
    targetMax: e.target_max,
    targetUnit: e.target_unit,
    perSide: bool(e.per_side),
    loadKg: e.load_kg,
    loadNote: e.load_note,
    rirMin: e.rir_min,
    rirMax: e.rir_max,
    restS: e.rest_s,
    plannedComment: e.planned_comment,
    note: e.note,
    isOptional: bool(e.is_optional),
    isEnabled: bool(e.is_enabled),
    status: e.status,
    setEntries: setsBy.get(e.id) ?? [],
  }));
  const pains = (await db.select<R>('SELECT * FROM pain_entry WHERE session_id = ? ORDER BY created_at', [id])).map(mapPain);
  const cardio = (await listCardio(db, { sessionId: id }));
  return {
    id: s.id,
    templateId: s.template_id,
    name: s.name,
    date: s.date,
    status: s.status,
    startedAt: s.started_at,
    endedAt: s.ended_at,
    fatigue: s.fatigue,
    soreness: s.soreness,
    comment: s.comment,
    createdVia: s.created_via,
    exercises,
    pains,
    cardio,
  };
}

export async function listSessions(db: Db, from: string, to: string): Promise<SessionSummary[]> {
  const rows = await db.select<R>(
    `SELECT ws.*,
       (SELECT count(*) FROM session_exercise se WHERE se.session_id = ws.id AND se.is_enabled = 1) AS exercise_count,
       (SELECT count(*) FROM set_entry s JOIN session_exercise se ON se.id = s.session_exercise_id
          WHERE se.session_id = ws.id AND s.is_done = 1 AND s.is_warmup = 0) AS done_sets,
       (SELECT count(*) FROM set_entry s JOIN session_exercise se ON se.id = s.session_exercise_id
          WHERE se.session_id = ws.id AND se.is_enabled = 1 AND s.is_warmup = 0) AS planned_sets,
       (SELECT max(intensity) FROM pain_entry p WHERE p.session_id = ws.id) AS max_pain
       FROM workout_session ws WHERE ws.date BETWEEN ? AND ? ORDER BY ws.date, ws.created_at`,
    [from, to],
  );
  return rows.map((r) => ({
    id: r.id,
    templateId: r.template_id,
    name: r.name,
    date: r.date,
    status: r.status,
    exerciseCount: r.exercise_count,
    doneSets: r.done_sets,
    plannedSets: r.planned_sets,
    maxPain: r.max_pain,
    fatigue: r.fatigue,
  }));
}

// --- Création ----------------------------------------------------------------------

async function insertSets(
  db: Db,
  seId: string,
  count: number,
  load: number | null,
  value: number | null,
  last: LastPerformance | null,
): Promise<void> {
  for (let i = 0; i < count; i++) {
    const lastSet = last?.sets[i] ?? last?.sets.at(-1);
    const plannedLoad = load ?? lastSet?.loadKg ?? null;
    const plannedValue = value ?? lastSet?.value ?? null;
    await db.execute(
      `INSERT INTO set_entry (id, session_exercise_id, set_index, planned_load_kg, planned_value, load_kg, value, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [newId(), seId, i, plannedLoad, plannedValue, plannedLoad, plannedValue, nowIso()],
    );
  }
}

/**
 * Crée une séance datée, copie indépendante du template : les exercices reprennent
 * l'alternative par défaut et ses cibles ; chaque série est pré-remplie (charge prévue,
 * sinon celle de la dernière fois ; haut de la plage de répétitions visée).
 */
export async function createSessionFromTemplate(
  db: Db,
  templateId: string,
  date: string,
  via: Via = 'app',
): Promise<string> {
  dateSchema.parse(date);
  return db.transaction(async (tx) => {
    const t = (await tx.select<R>('SELECT program_id FROM workout_template WHERE id = ?', [templateId]))[0];
    if (!t) throw new DomainError('Séance type introuvable.');
    const program = await getProgram(tx, t.program_id);
    const template = program!.templates.find((x) => x.id === templateId)!;
    const sessionId = newId();
    const now = nowIso();
    await tx.execute(
      `INSERT INTO workout_session (id, template_id, name, date, status, created_via, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'planned', ?, ?, ?)`,
      [sessionId, templateId, template.name, date, via, now, now],
    );
    for (const [i, slot] of template.slots.entries()) {
      const option = slot.options[0];
      if (!option) continue;
      const tg = effectiveTargets(slot, option);
      const seId = newId();
      const loadNote = [slot.loadNote, option.note].filter(Boolean).join(' · ') || null;
      await tx.execute(
        `INSERT INTO session_exercise (id, session_id, template_slot_id, sort, block, block_label, label, exercise_id,
           alternatives, sets, target_min, target_max, target_unit, per_side, load_kg, load_note, rir_min, rir_max,
           rest_s, planned_comment, is_optional, is_enabled)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          seId, sessionId, slot.id, i, slot.block, slot.blockLabel, slot.label, option.exerciseId,
          JSON.stringify(slot.options.map((o) => o.exerciseId)), tg.sets, tg.targetMin, tg.targetMax,
          slot.targetUnit, slot.perSide, tg.loadKg, loadNote, slot.rirMin, slot.rirMax, slot.restS, slot.comment,
          slot.isOptional, !slot.isOptional || slot.enabledByDefault,
        ],
      );
      const last = await getLastPerformance(tx, option.exerciseId, { beforeDate: date, excludeSessionId: sessionId });
      await insertSets(tx, seId, tg.sets ?? 1, tg.loadKg, tg.targetMax ?? tg.targetMin, last);
    }
    return sessionId;
  });
}

/** Séance libre (sans template). */
export async function createFreeSession(db: Db, date: string, name: string, via: Via = 'app'): Promise<string> {
  dateSchema.parse(date);
  if (!name.trim()) throw new DomainError('Le nom de la séance est obligatoire.');
  const id = newId();
  const now = nowIso();
  await db.execute(
    `INSERT INTO workout_session (id, name, date, status, created_via, created_at, updated_at)
     VALUES (?, ?, ?, 'planned', ?, ?, ?)`,
    [id, name.trim(), date, via, now, now],
  );
  return id;
}

export async function addSessionExercise(db: Db, sessionId: string, exerciseId: string): Promise<string> {
  return db.transaction(async (tx) => {
    const s = (await tx.select<R>('SELECT date FROM workout_session WHERE id = ?', [sessionId]))[0];
    if (!s) throw new DomainError('Séance introuvable.');
    const seId = newId();
    await tx.execute(
      `INSERT INTO session_exercise (id, session_id, sort, block, exercise_id, alternatives, sets)
       VALUES (?, ?, (SELECT coalesce(max(sort) + 1, 0) FROM session_exercise WHERE session_id = ?), 'work', ?, ?, 3)`,
      [seId, sessionId, sessionId, exerciseId, JSON.stringify([exerciseId])],
    );
    const last = await getLastPerformance(tx, exerciseId, { beforeDate: s.date, excludeSessionId: sessionId });
    await insertSets(tx, seId, last?.sets.length || 3, null, null, last);
    return seId;
  });
}

// --- Modification -------------------------------------------------------------------

export const sessionPatchSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    date: dateSchema,
    status: z.enum(SESSION_STATUSES),
    fatigue: z.number().int().min(0).max(10).nullable(),
    soreness: z.number().int().min(0).max(10).nullable(),
    comment: z.string().max(5000).nullable(),
    startedAt: z.string().nullable(),
    endedAt: z.string().nullable(),
  })
  .partial();
export type SessionPatch = z.input<typeof sessionPatchSchema>;

export async function updateSession(db: Db, id: string, patch: SessionPatch): Promise<void> {
  const data = sessionPatchSchema.parse(patch);
  const n = await updateColumns(db, 'workout_session', id, data, {
    name: 'name',
    date: 'date',
    status: 'status',
    fatigue: 'fatigue',
    soreness: 'soreness',
    comment: 'comment',
    startedAt: 'started_at',
    endedAt: 'ended_at',
  });
  if (n === 0) throw new DomainError('Séance introuvable.');
}

export async function deleteSession(db: Db, id: string): Promise<void> {
  await db.execute('DELETE FROM workout_session WHERE id = ?', [id]);
}

export async function updateSessionExercise(
  db: Db,
  id: string,
  patch: { isEnabled?: boolean; note?: string | null; status?: 'pending' | 'done' | 'skipped' },
): Promise<void> {
  await updateColumns(db, 'session_exercise', id, patch, { isEnabled: 'is_enabled', note: 'note', status: 'status' }, false);
}

export async function removeSessionExercise(db: Db, id: string): Promise<void> {
  await db.execute('DELETE FROM session_exercise WHERE id = ?', [id]);
}

export async function reorderSessionExercises(db: Db, sessionId: string, orderedIds: string[]): Promise<void> {
  await rewriteSort(db, 'session_exercise', 'session_id', sessionId, orderedIds);
}

/**
 * Change l'alternative réalisée. Les séries non cochées reprennent la charge prévue
 * pour cette alternative (programme), sinon celle de la dernière fois.
 */
export async function switchSessionAlternative(db: Db, seId: string, exerciseId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const se = (await tx.select<R>(
      `SELECT se.*, ws.date FROM session_exercise se JOIN workout_session ws ON ws.id = se.session_id WHERE se.id = ?`,
      [seId],
    ))[0];
    if (!se) throw new DomainError('Exercice de séance introuvable.');
    const alternatives = JSON.parse(se.alternatives ?? '[]') as string[];
    if (!alternatives.includes(exerciseId)) throw new DomainError("Cet exercice n'est pas une alternative de ce slot.");
    let load: number | null = null;
    let loadNote: string | null = se.load_note;
    if (se.template_slot_id) {
      const o = (await tx.select<R>(
        `SELECT so.load_kg AS o_load, so.note, ts.load_kg AS s_load, ts.load_note
           FROM slot_option so JOIN template_slot ts ON ts.id = so.slot_id
          WHERE so.slot_id = ? AND so.exercise_id = ?`,
        [se.template_slot_id, exerciseId],
      ))[0];
      if (o) {
        load = o.o_load ?? o.s_load;
        loadNote = [o.load_note, o.note].filter(Boolean).join(' · ') || null;
      }
    }
    const last = await getLastPerformance(tx, exerciseId, { beforeDate: se.date, excludeSessionId: se.session_id });
    await tx.execute('UPDATE session_exercise SET exercise_id = ?, load_kg = ?, load_note = ? WHERE id = ?', [
      exerciseId, load, loadNote, seId,
    ]);
    const sets = await tx.select<R>('SELECT id, set_index FROM set_entry WHERE session_exercise_id = ? AND is_done = 0', [seId]);
    for (const s of sets) {
      const l = load ?? last?.sets[s.set_index]?.loadKg ?? last?.sets.at(-1)?.loadKg ?? null;
      await tx.execute('UPDATE set_entry SET planned_load_kg = ?, load_kg = ?, updated_at = ? WHERE id = ?', [l, l, nowIso(), s.id]);
    }
  });
}

// --- Séries ---------------------------------------------------------------------------

export const setPatchSchema = z
  .object({
    loadKg: z.number().min(0).max(1000).nullable(),
    value: z.number().min(0).max(100000).nullable(),
    isDone: z.boolean(),
    isWarmup: z.boolean(),
    rir: z.number().min(0).max(10).nullable(),
    rpe: z.number().min(0).max(10).nullable(),
    comment: z.string().max(1000).nullable(),
  })
  .partial();
export type SetPatch = z.input<typeof setPatchSchema>;

export async function updateSet(db: Db, id: string, patch: SetPatch): Promise<void> {
  const data = setPatchSchema.parse(patch);
  await updateColumns(db, 'set_entry', id, data, {
    loadKg: 'load_kg',
    value: 'value',
    isDone: 'is_done',
    isWarmup: 'is_warmup',
    rir: 'rir',
    rpe: 'rpe',
    comment: 'comment',
  });
}

/** Ajoute une série en recopiant la dernière (valeurs prévues et réelles). */
export async function addSet(db: Db, seId: string): Promise<string> {
  return db.transaction(async (tx) => {
    const last = (await tx.select<R>('SELECT * FROM set_entry WHERE session_exercise_id = ? ORDER BY set_index DESC LIMIT 1', [seId]))[0];
    const id = newId();
    await tx.execute(
      `INSERT INTO set_entry (id, session_exercise_id, set_index, planned_load_kg, planned_value, load_kg, value, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, seId, last ? last.set_index + 1 : 0, last?.planned_load_kg ?? null, last?.planned_value ?? null, last?.load_kg ?? null, last?.value ?? null, nowIso()],
    );
    return id;
  });
}

export async function removeSet(db: Db, setId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const s = (await tx.select<R>('SELECT session_exercise_id FROM set_entry WHERE id = ?', [setId]))[0];
    if (!s) return;
    await tx.execute('DELETE FROM set_entry WHERE id = ?', [setId]);
    const rest = await tx.select<{ id: string }>('SELECT id FROM set_entry WHERE session_exercise_id = ? ORDER BY set_index', [s.session_exercise_id]);
    // Deux passes pour ne pas violer UNIQUE(session_exercise_id, set_index).
    for (const [i, r] of rest.entries()) await tx.execute('UPDATE set_entry SET set_index = ? WHERE id = ?', [-1 - i, r.id]);
    for (const [i, r] of rest.entries()) await tx.execute('UPDATE set_entry SET set_index = ? WHERE id = ?', [i, r.id]);
  });
}

/** Coche toutes les séries d'un exercice (valeurs saisies ou prévues). */
export async function completeAllSets(db: Db, seId: string, done = true): Promise<void> {
  await db.execute('UPDATE set_entry SET is_done = ?, updated_at = ? WHERE session_exercise_id = ?', [done, nowIso(), seId]);
}

// --- Douleurs ----------------------------------------------------------------------------

export const painInputSchema = z.object({
  date: dateSchema,
  sessionId: z.string().nullable().optional(),
  zone: z.string().trim().min(1, 'Indiquez la zone.').max(80),
  side: z.enum(['left', 'right', 'both', 'center']).nullable().optional(),
  intensity: z.number().int().min(0).max(10),
  context: z.string().max(200).nullable().optional(),
  note: z.string().max(1000).nullable().optional(),
});
export type PainInput = z.input<typeof painInputSchema>;

export async function addPain(db: Db, input: PainInput, via: Via = 'app'): Promise<string> {
  const d = painInputSchema.parse(input);
  const id = newId();
  await db.execute(
    `INSERT INTO pain_entry (id, date, session_id, zone, side, intensity, context, note, created_via, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, d.date, d.sessionId ?? null, d.zone, d.side ?? null, d.intensity, d.context ?? null, d.note ?? null, via, nowIso()],
  );
  return id;
}

export async function deletePain(db: Db, id: string): Promise<void> {
  await db.execute('DELETE FROM pain_entry WHERE id = ?', [id]);
}

export async function listPains(db: Db, from: string, to: string): Promise<PainEntry[]> {
  return (await db.select<R>('SELECT * FROM pain_entry WHERE date BETWEEN ? AND ? ORDER BY date, created_at', [from, to])).map(mapPain);
}
