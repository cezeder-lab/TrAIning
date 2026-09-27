import type { Db } from '../db/driver.ts';

type R = Record<string, any>;

/** 1RM estimé (Epley), seulement pour 1 à 12 répétitions avec charge : au-delà, l'estimation n'est pas fiable. */
export function estimateOneRepMax(loadKg: number | null, reps: number | null): number | null {
  if (!loadKg || !reps || reps < 1 || reps > 12) return null;
  return reps === 1 ? loadKg : Math.round(loadKg * (1 + reps / 30) * 10) / 10;
}

export interface ExerciseHistoryPoint {
  sessionId: string;
  sessionName: string;
  date: string;
  unit: string;
  sets: { loadKg: number | null; value: number | null; rir: number | null }[];
  maxLoadKg: number | null;
  /** Σ charge × répétitions (séries cochées hors échauffement). */
  volumeKg: number | null;
  totalValue: number;
  bestSet: { loadKg: number | null; value: number | null } | null;
  /** Estimation, pas une mesure. */
  e1rmKg: number | null;
}

/**
 * Historique d'un exercice : une ligne par séance où il a été fait (séries cochées uniquement,
 * hors échauffement ; un exercice optionnel non fait n'apparaît donc pas).
 */
export async function getExerciseHistory(
  db: Db,
  exerciseId: string,
  opts: { from?: string; to?: string; limit?: number } = {},
): Promise<ExerciseHistoryPoint[]> {
  const rows = await db.select<R>(
    `SELECT ws.id AS session_id, ws.name AS session_name, ws.date, se.target_unit, s.load_kg, s.value, s.rir, s.set_index, se.id AS se_id
       FROM set_entry s
       JOIN session_exercise se ON se.id = s.session_exercise_id
       JOIN workout_session ws ON ws.id = se.session_id
      WHERE se.exercise_id = ? AND s.is_done = 1 AND s.is_warmup = 0 AND ws.date BETWEEN ? AND ?
      ORDER BY ws.date, ws.created_at, se.sort, s.set_index`,
    [exerciseId, opts.from ?? '0000-01-01', opts.to ?? '9999-12-31'],
  );
  const bySession = new Map<string, ExerciseHistoryPoint>();
  for (const r of rows) {
    let p = bySession.get(r.session_id);
    if (!p) {
      p = {
        sessionId: r.session_id,
        sessionName: r.session_name,
        date: r.date,
        unit: r.target_unit,
        sets: [],
        maxLoadKg: null,
        volumeKg: null,
        totalValue: 0,
        bestSet: null,
        e1rmKg: null,
      };
      bySession.set(r.session_id, p);
    }
    p.sets.push({ loadKg: r.load_kg, value: r.value, rir: r.rir });
  }
  const points = [...bySession.values()];
  for (const p of points) {
    let best: { loadKg: number | null; value: number | null } | null = null;
    let bestScore = -1;
    for (const s of p.sets) {
      if (s.loadKg != null) p.maxLoadKg = Math.max(p.maxLoadKg ?? 0, s.loadKg);
      p.totalValue += s.value ?? 0;
      if (p.unit === 'reps' && s.loadKg != null && s.value != null) p.volumeKg = (p.volumeKg ?? 0) + s.loadKg * s.value;
      const e1rm = p.unit === 'reps' ? estimateOneRepMax(s.loadKg, s.value) : null;
      if (e1rm != null) p.e1rmKg = Math.max(p.e1rmKg ?? 0, e1rm);
      const score = e1rm ?? (s.loadKg ?? 0) * 1000 + (s.value ?? 0);
      if (score > bestScore) {
        bestScore = score;
        best = s;
      }
    }
    p.bestSet = best;
    if (p.volumeKg != null) p.volumeKg = Math.round(p.volumeKg * 10) / 10;
  }
  return opts.limit ? points.slice(-opts.limit) : points;
}
