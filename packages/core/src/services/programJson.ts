import type { Db } from '../db/driver.ts';
import { newId } from '../db/ids.ts';
import { DomainError, normalizeText, nowIso } from '../db/util.ts';
import { createExercise, findExerciseByName, getExercise } from '../repos/exercises.ts';
import { getProgram, insertProgram } from '../repos/program.ts';
import {
  PROGRAM_JSON_FORMAT,
  PROGRAM_JSON_VERSION,
  programJsonSchema,
  type ProgramJson,
} from '../schemas/program.ts';
import type { ExerciseOrigin, ProgramOrigin } from '../types.ts';

/** Exporte un programme au format JSON portable (exercices référencés par nom). */
export async function exportProgram(db: Db, programId: string): Promise<ProgramJson> {
  const program = await getProgram(db, programId);
  if (!program) throw new DomainError('Programme introuvable.');
  const exerciseIds = new Set<string>();
  for (const t of program.templates) for (const s of t.slots) for (const o of s.options) exerciseIds.add(o.exerciseId);
  const exercises = [];
  for (const id of exerciseIds) {
    const e = await getExercise(db, id);
    if (!e) continue;
    exercises.push({
      name: e.name,
      kind: e.kind,
      equipment: e.equipment,
      techniqueNotes: e.techniqueNotes,
      muscles: e.muscles.map((m) => ({ id: m.muscleGroupId, role: m.role })),
    });
  }
  exercises.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  return {
    format: PROGRAM_JSON_FORMAT,
    version: PROGRAM_JSON_VERSION,
    exportedAt: nowIso(),
    program: {
      name: program.name,
      comment: program.comment,
      templates: program.templates.map((t) => ({
        name: t.name,
        comment: t.comment,
        slots: t.slots.map((s) => ({
          block: s.block,
          blockLabel: s.blockLabel,
          label: s.label,
          sets: s.sets,
          targetMin: s.targetMin,
          targetMax: s.targetMax,
          targetUnit: s.targetUnit,
          perSide: s.perSide,
          loadKg: s.loadKg,
          loadNextKg: s.loadNextKg,
          loadNote: s.loadNote,
          rirMin: s.rirMin,
          rirMax: s.rirMax,
          restS: s.restS,
          comment: s.comment,
          isOptional: s.isOptional,
          enabledByDefault: s.enabledByDefault,
          options: s.options.map((o) => ({
            exercise: o.exerciseName,
            sets: o.sets,
            targetMin: o.targetMin,
            targetMax: o.targetMax,
            loadKg: o.loadKg,
            loadNextKg: o.loadNextKg,
            note: o.note,
          })),
        })),
      })),
    },
    exercises,
  };
}

/** Transforme une erreur de validation Zod en message lisible. */
function describeValidationError(err: unknown): string {
  const issues = (err as { issues?: { path: PropertyKey[]; message: string }[] }).issues;
  if (!issues?.length) return 'Fichier de programme invalide.';
  const format = issues.find((i) => i.path[0] === 'format');
  if (format) return format.message;
  const first = issues
    .slice(0, 3)
    .map((i) => `${i.path.map(String).join('.') || '(racine)'} : ${i.message}`)
    .join(' ; ');
  return `Fichier de programme invalide — ${first}`;
}

export function parseProgramJson(input: unknown): ProgramJson {
  const r = programJsonSchema.safeParse(input);
  if (!r.success) throw new DomainError(describeValidationError(r.error));
  return r.data;
}

/**
 * Importe un programme comme nouveau programme (activé par défaut ; l'ancien est archivé,
 * jamais supprimé). Les exercices existants sont réutilisés par nom, les autres sont créés.
 */
export async function importProgram(
  db: Db,
  input: unknown,
  opts: { activate?: boolean; origin?: ProgramOrigin } = {},
): Promise<string> {
  const data = parseProgramJson(input);
  const origin = opts.origin ?? 'import';
  const exerciseOrigin: ExerciseOrigin = origin === 'seed' ? 'seed' : 'import';
  return db.transaction(async (tx) => {
    const declared = new Map(data.exercises.map((e) => [normalizeText(e.name), e]));
    const resolved = new Map<string, string>();
    const resolve = async (name: string): Promise<string> => {
      const key = normalizeText(name);
      const cached = resolved.get(key);
      if (cached) return cached;
      const existing = await findExerciseByName(tx, name);
      let id: string;
      if (existing) {
        id = existing.id;
      } else {
        const d = declared.get(key);
        const created = await createExercise(
          tx,
          {
            name: d?.name ?? name,
            kind: d?.kind ?? 'weight',
            equipment: d?.equipment ?? null,
            techniqueNotes: d?.techniqueNotes ?? null,
            muscles: (d?.muscles ?? []).map((m) => ({ muscleGroupId: m.id, role: m.role })),
          },
          exerciseOrigin,
        );
        id = created.id;
      }
      resolved.set(key, id);
      return id;
    };

    const programId = await insertProgram(tx, {
      name: data.program.name,
      comment: data.program.comment ?? null,
      origin,
      activate: opts.activate ?? true,
    });
    const now = nowIso();
    for (const [ti, t] of data.program.templates.entries()) {
      const templateId = newId();
      await tx.execute(
        `INSERT INTO workout_template (id, program_id, name, comment, sort, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [templateId, programId, t.name, t.comment ?? null, ti, now, now],
      );
      for (const [si, s] of t.slots.entries()) {
        const slotId = newId();
        await tx.execute(
          `INSERT INTO template_slot (id, template_id, sort, block, block_label, label, sets, target_min, target_max,
             target_unit, per_side, load_kg, load_next_kg, load_note, rir_min, rir_max, rest_s, comment,
             is_optional, enabled_by_default, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            slotId, templateId, si, s.block, s.blockLabel, s.label, s.sets, s.targetMin, s.targetMax,
            s.targetUnit, s.perSide, s.loadKg, s.loadNextKg, s.loadNote, s.rirMin, s.rirMax, s.restS, s.comment,
            s.isOptional, s.enabledByDefault, now, now,
          ],
        );
        const seen = new Set<string>();
        let oi = 0;
        for (const o of s.options) {
          const exerciseId = await resolve(o.exercise);
          if (seen.has(exerciseId)) continue;
          seen.add(exerciseId);
          await tx.execute(
            `INSERT INTO slot_option (id, slot_id, exercise_id, sort, sets, target_min, target_max, load_kg, load_next_kg, note)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [newId(), slotId, exerciseId, oi++, o.sets, o.targetMin, o.targetMax, o.loadKg, o.loadNextKg, o.note],
          );
        }
      }
    }
    return programId;
  });
}
