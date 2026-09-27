import type { Db } from '../db/driver.ts';
import { newId } from '../db/ids.ts';
import { DomainError, bool, nowIso, rewriteSort, updateColumns } from '../db/util.ts';
import { optionPatchSchema, slotPatchSchema, type OptionPatch, type SlotPatch } from '../schemas/program.ts';
import type {
  Block,
  Program,
  ProgramOrigin,
  ProgramSummary,
  SlotOption,
  TemplateSlot,
  WorkoutTemplate,
} from '../types.ts';

type R = Record<string, any>;

const SLOT_COLUMNS: Record<string, string> = {
  block: 'block',
  blockLabel: 'block_label',
  label: 'label',
  sets: 'sets',
  targetMin: 'target_min',
  targetMax: 'target_max',
  targetUnit: 'target_unit',
  perSide: 'per_side',
  loadKg: 'load_kg',
  loadNextKg: 'load_next_kg',
  loadNote: 'load_note',
  rirMin: 'rir_min',
  rirMax: 'rir_max',
  restS: 'rest_s',
  comment: 'comment',
  isOptional: 'is_optional',
  enabledByDefault: 'enabled_by_default',
};

const OPTION_COLUMNS: Record<string, string> = {
  sets: 'sets',
  targetMin: 'target_min',
  targetMax: 'target_max',
  loadKg: 'load_kg',
  loadNextKg: 'load_next_kg',
  note: 'note',
};

function mapOption(r: R): SlotOption {
  return {
    id: r.id,
    slotId: r.slot_id,
    exerciseId: r.exercise_id,
    exerciseName: r.exercise_name,
    exerciseKind: r.exercise_kind,
    sort: r.sort,
    sets: r.sets,
    targetMin: r.target_min,
    targetMax: r.target_max,
    loadKg: r.load_kg,
    loadNextKg: r.load_next_kg,
    note: r.note,
  };
}

function mapSlot(r: R, options: SlotOption[]): TemplateSlot {
  return {
    id: r.id,
    templateId: r.template_id,
    sort: r.sort,
    block: r.block,
    blockLabel: r.block_label,
    label: r.label,
    sets: r.sets,
    targetMin: r.target_min,
    targetMax: r.target_max,
    targetUnit: r.target_unit,
    perSide: bool(r.per_side),
    loadKg: r.load_kg,
    loadNextKg: r.load_next_kg,
    loadNote: r.load_note,
    rirMin: r.rir_min,
    rirMax: r.rir_max,
    restS: r.rest_s,
    comment: r.comment,
    isOptional: bool(r.is_optional),
    enabledByDefault: bool(r.enabled_by_default),
    options,
  };
}

/** Charge un programme complet (templates → slots → alternatives) en 4 requêtes. */
export async function getProgram(db: Db, programId: string): Promise<Program | null> {
  const p = (await db.select<R>('SELECT * FROM program WHERE id = ?', [programId]))[0];
  if (!p) return null;
  const templates = await db.select<R>(
    'SELECT * FROM workout_template WHERE program_id = ? ORDER BY sort',
    [programId],
  );
  const slots = await db.select<R>(
    `SELECT ts.* FROM template_slot ts JOIN workout_template wt ON wt.id = ts.template_id
      WHERE wt.program_id = ? ORDER BY ts.sort`,
    [programId],
  );
  const options = await db.select<R>(
    `SELECT so.*, e.name AS exercise_name, e.kind AS exercise_kind
       FROM slot_option so
       JOIN template_slot ts ON ts.id = so.slot_id
       JOIN workout_template wt ON wt.id = ts.template_id
       JOIN exercise e ON e.id = so.exercise_id
      WHERE wt.program_id = ? ORDER BY so.sort`,
    [programId],
  );
  const optionsBySlot = new Map<string, SlotOption[]>();
  for (const o of options) {
    const list = optionsBySlot.get(o.slot_id) ?? [];
    list.push(mapOption(o));
    optionsBySlot.set(o.slot_id, list);
  }
  const slotsByTemplate = new Map<string, TemplateSlot[]>();
  for (const s of slots) {
    const list = slotsByTemplate.get(s.template_id) ?? [];
    list.push(mapSlot(s, optionsBySlot.get(s.id) ?? []));
    slotsByTemplate.set(s.template_id, list);
  }
  return {
    id: p.id,
    name: p.name,
    comment: p.comment,
    isActive: bool(p.is_active),
    origin: p.origin,
    createdAt: p.created_at,
    updatedAt: p.updated_at,
    templates: templates.map(
      (t): WorkoutTemplate => ({
        id: t.id,
        programId: t.program_id,
        name: t.name,
        comment: t.comment,
        sort: t.sort,
        slots: slotsByTemplate.get(t.id) ?? [],
      }),
    ),
  };
}

export async function getActiveProgram(db: Db): Promise<Program | null> {
  const r = await db.select<{ id: string }>('SELECT id FROM program WHERE is_active = 1');
  return r[0] ? getProgram(db, r[0].id) : null;
}

export async function listPrograms(db: Db): Promise<ProgramSummary[]> {
  const rows = await db.select<R>(
    `SELECT p.*, (SELECT count(*) FROM workout_template t WHERE t.program_id = p.id) AS template_count
       FROM program p ORDER BY p.is_active DESC, p.updated_at DESC`,
  );
  return rows.map((p) => ({
    id: p.id,
    name: p.name,
    isActive: bool(p.is_active),
    origin: p.origin,
    templateCount: p.template_count,
    createdAt: p.created_at,
    updatedAt: p.updated_at,
  }));
}

export async function insertProgram(
  db: Db,
  data: { name: string; comment?: string | null; origin: ProgramOrigin; activate: boolean },
): Promise<string> {
  const id = newId();
  const now = nowIso();
  await db.transaction(async (tx) => {
    if (data.activate) await tx.execute('UPDATE program SET is_active = 0 WHERE is_active = 1');
    await tx.execute(
      'INSERT INTO program (id, name, comment, is_active, origin, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [id, data.name, data.comment ?? null, data.activate, data.origin, now, now],
    );
  });
  return id;
}

export async function updateProgram(
  db: Db,
  id: string,
  patch: { name?: string; comment?: string | null },
): Promise<void> {
  if (patch.name !== undefined && patch.name.trim() === '') throw new DomainError('Le nom du programme est obligatoire.');
  await updateColumns(db, 'program', id, patch, { name: 'name', comment: 'comment' });
}

export async function activateProgram(db: Db, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    const exists = await tx.select('SELECT 1 FROM program WHERE id = ?', [id]);
    if (exists.length === 0) throw new DomainError('Programme introuvable.');
    await tx.execute('UPDATE program SET is_active = 0 WHERE is_active = 1');
    await tx.execute('UPDATE program SET is_active = 1, updated_at = ? WHERE id = ?', [nowIso(), id]);
  });
}

/** Supprime un programme archivé. Les séances passées gardent leur copie (template_id → NULL). */
export async function deleteArchivedProgram(db: Db, id: string): Promise<void> {
  const r = await db.select<{ is_active: number }>('SELECT is_active FROM program WHERE id = ?', [id]);
  if (!r[0]) throw new DomainError('Programme introuvable.');
  if (r[0].is_active) throw new DomainError('Le programme actif ne peut pas être supprimé.');
  await db.execute('DELETE FROM program WHERE id = ?', [id]);
}

// --- Templates ---------------------------------------------------------------

export async function createTemplate(db: Db, programId: string, name: string): Promise<string> {
  const clean = name.trim();
  if (!clean) throw new DomainError('Le nom de la séance est obligatoire.');
  const id = newId();
  const now = nowIso();
  await db.execute(
    `INSERT INTO workout_template (id, program_id, name, sort, created_at, updated_at)
     VALUES (?, ?, ?, (SELECT coalesce(max(sort) + 1, 0) FROM workout_template WHERE program_id = ?), ?, ?)`,
    [id, programId, clean, programId, now, now],
  );
  return id;
}

export async function updateTemplate(
  db: Db,
  id: string,
  patch: { name?: string; comment?: string | null },
): Promise<void> {
  if (patch.name !== undefined && patch.name.trim() === '') throw new DomainError('Le nom de la séance est obligatoire.');
  await updateColumns(db, 'workout_template', id, patch, { name: 'name', comment: 'comment' });
}

export async function deleteTemplate(db: Db, id: string): Promise<void> {
  await db.execute('DELETE FROM workout_template WHERE id = ?', [id]);
}

export async function reorderTemplates(db: Db, programId: string, orderedIds: string[]): Promise<void> {
  await rewriteSort(db, 'workout_template', 'program_id', programId, orderedIds);
}

/** Copie un template (slots et alternatives compris) juste après l'original. */
export async function duplicateTemplate(db: Db, id: string): Promise<string> {
  return db.transaction(async (tx) => {
    const t = (await tx.select<R>('SELECT * FROM workout_template WHERE id = ?', [id]))[0];
    if (!t) throw new DomainError('Séance introuvable.');
    const newTemplateId = newId();
    const now = nowIso();
    await tx.execute('UPDATE workout_template SET sort = sort + 1 WHERE program_id = ? AND sort > ?', [t.program_id, t.sort]);
    await tx.execute(
      `INSERT INTO workout_template (id, program_id, name, comment, sort, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [newTemplateId, t.program_id, `${t.name} (copie)`, t.comment, t.sort + 1, now, now],
    );
    const slots = await tx.select<{ id: string }>('SELECT id FROM template_slot WHERE template_id = ? ORDER BY sort', [id]);
    for (const s of slots) await copySlot(tx, s.id, newTemplateId);
    return newTemplateId;
  });
}

async function copySlot(db: Db, slotId: string, templateId: string, sort?: number): Promise<string> {
  const newSlotId = newId();
  const now = nowIso();
  const cols = Object.values(SLOT_COLUMNS).join(', ');
  await db.execute(
    `INSERT INTO template_slot (id, template_id, sort, ${cols}, created_at, updated_at)
     SELECT ?, ?, ${sort === undefined ? 'sort' : '?'}, ${cols}, ?, ? FROM template_slot WHERE id = ?`,
    sort === undefined ? [newSlotId, templateId, now, now, slotId] : [newSlotId, templateId, sort, now, now, slotId],
  );
  const optCols = ['exercise_id', 'sort', ...Object.values(OPTION_COLUMNS)].join(', ');
  const options = await db.select<{ id: string }>('SELECT id FROM slot_option WHERE slot_id = ?', [slotId]);
  for (const o of options) {
    await db.execute(
      `INSERT INTO slot_option (id, slot_id, ${optCols}) SELECT ?, ?, ${optCols} FROM slot_option WHERE id = ?`,
      [newId(), newSlotId, o.id],
    );
  }
  return newSlotId;
}

// --- Slots -------------------------------------------------------------------

/**
 * Ajoute un slot contenant un exercice. Inséré après `afterSlotId` (même bloc)
 * ou en fin de template.
 */
export async function createSlot(
  db: Db,
  templateId: string,
  data: { exerciseId: string; block?: Block; afterSlotId?: string | null; patch?: SlotPatch },
): Promise<string> {
  const patch = slotPatchSchema.parse(data.patch ?? {});
  return db.transaction(async (tx) => {
    let sort: number;
    let block: Block = data.block ?? 'work';
    let blockLabel: string | null = null;
    if (data.afterSlotId) {
      const after = (await tx.select<R>('SELECT sort, block, block_label FROM template_slot WHERE id = ? AND template_id = ?', [data.afterSlotId, templateId]))[0];
      if (!after) throw new DomainError('Slot de référence introuvable.');
      sort = after.sort + 1;
      block = data.block ?? after.block;
      blockLabel = after.block_label;
      await tx.execute('UPDATE template_slot SET sort = sort + 1 WHERE template_id = ? AND sort >= ?', [templateId, sort]);
    } else {
      const r = await tx.select<{ s: number }>('SELECT coalesce(max(sort) + 1, 0) AS s FROM template_slot WHERE template_id = ?', [templateId]);
      sort = r[0]!.s;
    }
    const id = newId();
    const now = nowIso();
    await tx.execute(
      `INSERT INTO template_slot (id, template_id, sort, block, block_label, sets, target_min, target_max, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 3, 8, 12, ?, ?)`,
      [id, templateId, sort, block, blockLabel, now, now],
    );
    await tx.execute('INSERT INTO slot_option (id, slot_id, exercise_id, sort) VALUES (?, ?, ?, 0)', [newId(), id, data.exerciseId]);
    if (Object.keys(patch).length > 0) await updateColumns(tx, 'template_slot', id, patch, SLOT_COLUMNS);
    return id;
  });
}

export async function updateSlot(db: Db, id: string, patch: SlotPatch): Promise<void> {
  const data = slotPatchSchema.parse(patch);
  const n = await updateColumns(db, 'template_slot', id, data, SLOT_COLUMNS);
  if (n === 0) throw new DomainError('Slot introuvable.');
}

export async function deleteSlot(db: Db, id: string): Promise<void> {
  await db.execute('DELETE FROM template_slot WHERE id = ?', [id]);
}

export async function duplicateSlot(db: Db, id: string): Promise<string> {
  return db.transaction(async (tx) => {
    const s = (await tx.select<R>('SELECT template_id, sort FROM template_slot WHERE id = ?', [id]))[0];
    if (!s) throw new DomainError('Slot introuvable.');
    await tx.execute('UPDATE template_slot SET sort = sort + 1 WHERE template_id = ? AND sort > ?', [s.template_id, s.sort]);
    return copySlot(tx, id, s.template_id, s.sort + 1);
  });
}

export async function reorderSlots(db: Db, templateId: string, orderedIds: string[]): Promise<void> {
  await rewriteSort(db, 'template_slot', 'template_id', templateId, orderedIds);
}

/** Déplace un slot dans un autre template (ajouté à la fin). */
export async function moveSlotToTemplate(db: Db, slotId: string, templateId: string): Promise<void> {
  await db.execute(
    `UPDATE template_slot SET template_id = ?, updated_at = ?,
       sort = (SELECT coalesce(max(sort) + 1, 0) FROM template_slot WHERE template_id = ?)
     WHERE id = ?`,
    [templateId, nowIso(), templateId, slotId],
  );
}

// --- Alternatives --------------------------------------------------------------

export async function addSlotOption(db: Db, slotId: string, exerciseId: string): Promise<string> {
  return db.transaction(async (tx) => {
    const dup = await tx.select('SELECT 1 FROM slot_option WHERE slot_id = ? AND exercise_id = ?', [slotId, exerciseId]);
    if (dup.length > 0) throw new DomainError('Cet exercice est déjà une alternative de ce slot.');
    const id = newId();
    await tx.execute(
      `INSERT INTO slot_option (id, slot_id, exercise_id, sort)
       VALUES (?, ?, ?, (SELECT coalesce(max(sort) + 1, 0) FROM slot_option WHERE slot_id = ?))`,
      [id, slotId, exerciseId, slotId],
    );
    await tx.execute('UPDATE template_slot SET updated_at = ? WHERE id = ?', [nowIso(), slotId]);
    return id;
  });
}

export async function updateSlotOption(db: Db, id: string, patch: OptionPatch): Promise<void> {
  const data = optionPatchSchema.parse(patch);
  await updateColumns(db, 'slot_option', id, data, OPTION_COLUMNS, false);
}

/** Remplace l'exercice d'une alternative (en gardant ses surcharges). */
export async function replaceOptionExercise(db: Db, optionId: string, exerciseId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const o = (await tx.select<R>('SELECT slot_id FROM slot_option WHERE id = ?', [optionId]))[0];
    if (!o) throw new DomainError('Alternative introuvable.');
    const dup = await tx.select('SELECT 1 FROM slot_option WHERE slot_id = ? AND exercise_id = ? AND id != ?', [o.slot_id, exerciseId, optionId]);
    if (dup.length > 0) throw new DomainError('Cet exercice est déjà une alternative de ce slot.');
    await tx.execute('UPDATE slot_option SET exercise_id = ? WHERE id = ?', [exerciseId, optionId]);
  });
}

export async function removeSlotOption(db: Db, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    const o = (await tx.select<R>('SELECT slot_id FROM slot_option WHERE id = ?', [id]))[0];
    if (!o) return;
    const n = (await tx.select<{ n: number }>('SELECT count(*) AS n FROM slot_option WHERE slot_id = ?', [o.slot_id]))[0]!.n;
    if (n <= 1) throw new DomainError('Un slot doit garder au moins un exercice. Supprimez le slot pour le retirer.');
    await tx.execute('DELETE FROM slot_option WHERE id = ?', [id]);
    const rest = await tx.select<{ id: string }>('SELECT id FROM slot_option WHERE slot_id = ? ORDER BY sort', [o.slot_id]);
    await rewriteSort(tx, 'slot_option', 'slot_id', o.slot_id, rest.map((r) => r.id));
  });
}

export async function reorderSlotOptions(db: Db, slotId: string, orderedIds: string[]): Promise<void> {
  await rewriteSort(db, 'slot_option', 'slot_id', slotId, orderedIds);
}
