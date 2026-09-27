import { z } from 'zod';
import type { Db } from '../db/driver.ts';
import { newId } from '../db/ids.ts';
import { DomainError, nowIso } from '../db/util.ts';
import { dateSchema } from './sessions.ts';

type R = Record<string, any>;

export interface WeightEntry {
  id: string;
  date: string;
  time: string | null;
  weightKg: number;
  note: string | null;
  createdVia: string;
}

export interface WaistEntry {
  id: string;
  date: string;
  valueCm: number;
  note: string | null;
}

export interface BodyPhoto {
  id: string;
  date: string;
  filePath: string;
  pose: string | null;
  note: string | null;
}

const mapWeight = (r: R): WeightEntry => ({ id: r.id, date: r.date, time: r.time, weightKg: r.weight_kg, note: r.note, createdVia: r.created_via });

export const weightInputSchema = z.object({
  date: dateSchema,
  weightKg: z.number().min(20).max(400),
  time: z.string().nullable().optional(),
  note: z.string().max(500).nullable().optional(),
  replaceExisting: z.boolean().default(false),
});

/** Au plus une pesée par jour ; une nouvelle pesée remplace l'ancienne seulement si demandé. */
export async function addWeightEntry(db: Db, input: z.input<typeof weightInputSchema>, via: 'app' | 'mcp' = 'app'): Promise<WeightEntry> {
  const d = weightInputSchema.parse(input);
  const existing = (await db.select<R>('SELECT * FROM body_weight WHERE date = ?', [d.date]))[0];
  if (existing && !d.replaceExisting) {
    throw new DomainError(`Une pesée existe déjà le ${d.date} (${existing.weight_kg} kg). Confirmez le remplacement pour l'écraser.`);
  }
  const now = nowIso();
  if (existing) {
    await db.execute('UPDATE body_weight SET weight_kg = ?, time = ?, note = ?, updated_at = ? WHERE id = ?', [
      d.weightKg, d.time ?? null, d.note ?? null, now, existing.id,
    ]);
  } else {
    await db.execute(
      'INSERT INTO body_weight (id, date, time, weight_kg, note, created_via, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [newId(), d.date, d.time ?? null, d.weightKg, d.note ?? null, via, now, now],
    );
  }
  return mapWeight((await db.select<R>('SELECT * FROM body_weight WHERE date = ?', [d.date]))[0]!);
}

export async function deleteWeightEntry(db: Db, id: string): Promise<void> {
  await db.execute('DELETE FROM body_weight WHERE id = ?', [id]);
}

export async function listWeights(db: Db, from: string, to: string): Promise<WeightEntry[]> {
  return (await db.select<R>('SELECT * FROM body_weight WHERE date BETWEEN ? AND ? ORDER BY date', [from, to])).map(mapWeight);
}

export async function addWaistMeasurement(
  db: Db,
  input: { date: string; valueCm: number; note?: string | null; replaceExisting?: boolean },
  via: 'app' | 'mcp' = 'app',
): Promise<WaistEntry> {
  const d = z
    .object({ date: dateSchema, valueCm: z.number().min(20).max(300), note: z.string().max(500).nullable().optional(), replaceExisting: z.boolean().default(false) })
    .parse(input);
  const existing = (await db.select<R>("SELECT * FROM body_measurement WHERE date = ? AND kind = 'waist'", [d.date]))[0];
  if (existing && !d.replaceExisting) throw new DomainError(`Un tour de taille existe déjà le ${d.date} (${existing.value_cm} cm).`);
  if (existing) await db.execute('UPDATE body_measurement SET value_cm = ?, note = ? WHERE id = ?', [d.valueCm, d.note ?? null, existing.id]);
  else {
    await db.execute(
      "INSERT INTO body_measurement (id, date, kind, value_cm, note, created_via, created_at) VALUES (?, ?, 'waist', ?, ?, ?, ?)",
      [newId(), d.date, d.valueCm, d.note ?? null, via, nowIso()],
    );
  }
  const r = (await db.select<R>("SELECT * FROM body_measurement WHERE date = ? AND kind = 'waist'", [d.date]))[0]!;
  return { id: r.id, date: r.date, valueCm: r.value_cm, note: r.note };
}

export async function listWaist(db: Db, from: string, to: string): Promise<WaistEntry[]> {
  return (await db.select<R>("SELECT * FROM body_measurement WHERE kind = 'waist' AND date BETWEEN ? AND ? ORDER BY date", [from, to])).map(
    (r) => ({ id: r.id, date: r.date, valueCm: r.value_cm, note: r.note }),
  );
}

export async function deleteMeasurement(db: Db, id: string): Promise<void> {
  await db.execute('DELETE FROM body_measurement WHERE id = ?', [id]);
}

export async function addBodyPhoto(db: Db, date: string, filePath: string, pose: string | null = null, note: string | null = null): Promise<string> {
  dateSchema.parse(date);
  const id = newId();
  await db.execute('INSERT INTO body_photo (id, date, file_path, pose, note, created_at) VALUES (?, ?, ?, ?, ?, ?)', [id, date, filePath, pose, note, nowIso()]);
  return id;
}

export async function listBodyPhotos(db: Db): Promise<BodyPhoto[]> {
  return (await db.select<R>('SELECT * FROM body_photo ORDER BY date DESC, created_at DESC')).map((r) => ({
    id: r.id, date: r.date, filePath: r.file_path, pose: r.pose, note: r.note,
  }));
}

export async function deleteBodyPhoto(db: Db, id: string): Promise<string | null> {
  const r = (await db.select<R>('SELECT file_path FROM body_photo WHERE id = ?', [id]))[0];
  await db.execute('DELETE FROM body_photo WHERE id = ?', [id]);
  return r?.file_path ?? null;
}
