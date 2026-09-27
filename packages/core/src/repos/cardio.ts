import { z } from 'zod';
import type { Db } from '../db/driver.ts';
import { newId } from '../db/ids.ts';
import { DomainError, nowIso, updateColumns } from '../db/util.ts';
import type { CardioSession } from '../types.ts';

type R = Record<string, any>;

/** Activités proposées (saisie libre possible). */
export const CARDIO_ACTIVITIES = ['Marche inclinée', 'Elliptique', 'Vélo', 'Rameur', 'Course', 'HIIT', 'Marche', 'Natation'];

export const cardioInputSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startTime: z.string().nullable().optional(),
  sessionId: z.string().nullable().optional(),
  activity: z.string().trim().min(1, "Indiquez l'activité.").max(80),
  durationS: z.number().int().min(1).max(24 * 3600),
  distanceM: z.number().min(0).max(1_000_000).nullable().optional(),
  speedKmh: z.number().min(0).max(100).nullable().optional(),
  inclineOrLevel: z.string().max(80).nullable().optional(),
  hrAvg: z.number().int().min(20).max(250).nullable().optional(),
  hrMax: z.number().int().min(20).max(250).nullable().optional(),
  caloriesWatchEst: z.number().int().min(0).max(10000).nullable().optional(),
  feeling: z.number().int().min(1).max(5).nullable().optional(),
  comment: z.string().max(2000).nullable().optional(),
});
export type CardioInput = z.input<typeof cardioInputSchema>;

const COLUMNS: Record<string, string> = {
  date: 'date',
  startTime: 'start_time',
  sessionId: 'session_id',
  activity: 'activity',
  durationS: 'duration_s',
  distanceM: 'distance_m',
  speedKmh: 'speed_kmh',
  inclineOrLevel: 'incline_or_level',
  hrAvg: 'hr_avg',
  hrMax: 'hr_max',
  caloriesWatchEst: 'calories_watch_est',
  feeling: 'feeling',
  comment: 'comment',
};

function mapCardio(r: R): CardioSession {
  return {
    id: r.id,
    date: r.date,
    startTime: r.start_time,
    sessionId: r.session_id,
    activity: r.activity,
    durationS: r.duration_s,
    distanceM: r.distance_m,
    speedKmh: r.speed_kmh,
    inclineOrLevel: r.incline_or_level,
    hrAvg: r.hr_avg,
    hrMax: r.hr_max,
    caloriesWatchEst: r.calories_watch_est,
    feeling: r.feeling,
    comment: r.comment,
    createdVia: r.created_via,
  };
}

export async function createCardio(db: Db, input: CardioInput, via: 'app' | 'mcp' = 'app'): Promise<string> {
  const d = cardioInputSchema.parse(input);
  const id = newId();
  const now = nowIso();
  const cols = Object.keys(COLUMNS).filter((k) => (d as R)[k] !== undefined);
  await db.execute(
    `INSERT INTO cardio_session (id, ${cols.map((k) => COLUMNS[k]).join(', ')}, created_via, created_at, updated_at)
     VALUES (?, ${cols.map(() => '?').join(', ')}, ?, ?, ?)`,
    [id, ...cols.map((k) => (d as R)[k]), via, now, now],
  );
  return id;
}

export async function updateCardio(db: Db, id: string, patch: Partial<CardioInput>): Promise<void> {
  const d = cardioInputSchema.partial().parse(patch);
  const n = await updateColumns(db, 'cardio_session', id, d, COLUMNS);
  if (n === 0) throw new DomainError('Séance de cardio introuvable.');
}

export async function deleteCardio(db: Db, id: string): Promise<void> {
  await db.execute('DELETE FROM cardio_session WHERE id = ?', [id]);
}

export async function getCardio(db: Db, id: string): Promise<CardioSession | null> {
  const r = (await db.select<R>('SELECT * FROM cardio_session WHERE id = ?', [id]))[0];
  return r ? mapCardio(r) : null;
}

export async function listCardio(
  db: Db,
  filter: { from?: string; to?: string; sessionId?: string; activity?: string },
): Promise<CardioSession[]> {
  const where: string[] = [];
  const params: string[] = [];
  if (filter.from) (where.push('date >= ?'), params.push(filter.from));
  if (filter.to) (where.push('date <= ?'), params.push(filter.to));
  if (filter.sessionId) (where.push('session_id = ?'), params.push(filter.sessionId));
  if (filter.activity) (where.push('activity = ? COLLATE NOCASE'), params.push(filter.activity));
  const rows = await db.select<R>(
    `SELECT * FROM cardio_session ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY date, start_time, created_at`,
    params,
  );
  return rows.map(mapCardio);
}
