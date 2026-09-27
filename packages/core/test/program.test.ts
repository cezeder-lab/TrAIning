import { describe, expect, it } from 'vitest';
import { openNodeDb } from '../src/drivers/node.ts';
import {
  addSlotOption,
  createExercise,
  createSlot,
  createTemplate,
  deleteArchivedProgram,
  duplicateSlot,
  duplicateTemplate,
  effectiveTargets,
  exportProgram,
  formatLoad,
  formatTarget,
  getActiveProgram,
  getSchemaVersion,
  importProgram,
  initDatabase,
  LATEST_SCHEMA_VERSION,
  listExercises,
  listPrograms,
  removeSlotOption,
  reorderSlots,
  restoreInitialProgram,
  setExerciseArchived,
  updateExercise,
  updateSlot,
} from '../src/index.ts';
import { freshDb } from './helpers.ts';

describe('initialisation', () => {
  it('applique les migrations et insère le programme initial une seule fois', async () => {
    const h = openNodeDb(':memory:');
    expect(await initDatabase(h.db)).toEqual({ seededProgram: true });
    expect(await initDatabase(h.db)).toEqual({ seededProgram: false });
    expect(await getSchemaVersion(h.db)).toBe(LATEST_SCHEMA_VERSION);
    expect(await listPrograms(h.db)).toHaveLength(1);
  });

  it('respecte le contenu du programme initial', async () => {
    const db = await freshDb();
    const p = (await getActiveProgram(db))!;
    expect(p.templates.map((t) => t.name)).toEqual(['Push', 'Pull', 'Legs', 'Abdos / Gainage']);
    expect(p.comment).toContain('2-3 reps en réserve');

    const push = p.templates[0]!;
    expect(push.slots[0]!.block).toBe('warmup');
    const incline = push.slots[1]!;
    expect(formatTarget(incline, incline.targetUnit, incline.perSide)).toBe('4 × 6-8');
    expect(formatLoad(incline.loadKg, incline.loadNextKg)).toBe('22 → 24 kg');
    const dips = push.slots.at(-1)!;
    expect(dips.options[0]!.exerciseName).toBe('Dips');
    expect([dips.isOptional, dips.enabledByDefault]).toEqual([true, false]);

    const pull = p.templates[1]!;
    const row = pull.slots.find((s) => s.label === 'Tirage horizontal')!;
    expect(row.options.map((o) => o.exerciseName)).toEqual([
      'Rowing haltère',
      'Tirage horizontal poulie basse (prise V)',
      'Tirage horizontal poulie (unilatéral)',
    ]);
    expect(effectiveTargets(row, row.options[0]).loadKg).toBe(26);
    expect(effectiveTargets(row, row.options[1]).loadKg).toBeNull();

    const legs = p.templates[2]!;
    const post = legs.slots.find((s) => s.label === 'Chaîne postérieure')!;
    expect(effectiveTargets(post, post.options[1]).loadKg).toBe(20);
    expect(legs.slots.at(-1)).toMatchObject({ block: 'cooldown', isOptional: true });

    const abs = p.templates[3]!;
    expect(abs.slots.every((s) => s.isOptional)).toBe(true);
    const deadBug = abs.slots.find((s) => s.options[0]!.exerciseName === 'Dead bug')!;
    expect(formatTarget(deadBug, deadBug.targetUnit, deadBug.perSide)).toBe('3 × 8-10 / côté');
    const farmer = abs.slots.at(-1)!;
    expect(formatTarget(farmer, farmer.targetUnit, farmer.perSide)).toBe('3 × 30-40 m');
  });
});

describe('éditeur de programme', () => {
  it('ajoute, modifie, réordonne et supprime des slots', async () => {
    const db = await freshDb();
    const p = (await getActiveProgram(db))!;
    const push = p.templates[0]!;
    const ex = await createExercise(db, { name: 'Pec deck', kind: 'weight' });
    const slotId = await createSlot(db, push.id, { exerciseId: ex.id, afterSlotId: push.slots[1]!.id });
    await updateSlot(db, slotId, { sets: 2, targetMin: 12, targetMax: 15, comment: '  ' });

    let t = (await getActiveProgram(db))!.templates[0]!;
    expect(t.slots[2]!.id).toBe(slotId);
    expect(t.slots[2]!.comment).toBeNull();
    expect(t.slots.map((s) => s.sort)).toEqual(t.slots.map((_, i) => i));

    const reversed = t.slots.map((s) => s.id).reverse();
    await reorderSlots(db, push.id, reversed);
    t = (await getActiveProgram(db))!.templates[0]!;
    expect(t.slots.map((s) => s.id)).toEqual(reversed);

    await expect(reorderSlots(db, push.id, reversed.slice(1))).rejects.toThrow(/ordre/);
  });

  it('gère les alternatives', async () => {
    const db = await freshDb();
    const slot = (await getActiveProgram(db))!.templates[0]!.slots[1]!;
    const ex = await createExercise(db, { name: 'Développé incliné (barre)', kind: 'weight' });
    const optId = await addSlotOption(db, slot.id, ex.id);
    await expect(addSlotOption(db, slot.id, ex.id)).rejects.toThrow(/déjà/);
    await removeSlotOption(db, optId);
    await expect(removeSlotOption(db, slot.options[0]!.id)).rejects.toThrow(/au moins un exercice/);
  });

  it('duplique un template et un slot', async () => {
    const db = await freshDb();
    const p = (await getActiveProgram(db))!;
    const copyId = await duplicateTemplate(db, p.templates[1]!.id);
    const p2 = (await getActiveProgram(db))!;
    expect(p2.templates.map((t) => t.name)).toEqual(['Push', 'Pull', 'Pull (copie)', 'Legs', 'Abdos / Gainage']);
    const copy = p2.templates.find((t) => t.id === copyId)!;
    expect(copy.slots.map((s) => s.options.length)).toEqual(p.templates[1]!.slots.map((s) => s.options.length));

    const newSlot = await duplicateSlot(db, copy.slots[0]!.id);
    const c2 = (await getActiveProgram(db))!.templates.find((t) => t.id === copyId)!;
    expect(c2.slots[1]!.id).toBe(newSlot);
    expect(c2.slots[1]!.label).toBe(c2.slots[0]!.label);
  });

  it('crée un template vide en fin de programme', async () => {
    const db = await freshDb();
    const p = (await getActiveProgram(db))!;
    await createTemplate(db, p.id, 'Full body');
    expect((await getActiveProgram(db))!.templates.at(-1)!.name).toBe('Full body');
    await expect(createTemplate(db, p.id, '  ')).rejects.toThrow(/obligatoire/);
  });
});

describe('exercices', () => {
  it('refuse les doublons de nom (casse et accents ignorés)', async () => {
    const db = await freshDb();
    await expect(createExercise(db, { name: 'DIPS', kind: 'weight' })).rejects.toThrow(/existe déjà/);
    await expect(createExercise(db, { name: 'etirements', kind: 'weight' })).rejects.toThrow(/existe déjà/);
  });

  it("n'archive pas un exercice utilisé par le programme actif", async () => {
    const db = await freshDb();
    const dips = (await listExercises(db)).find((e) => e.name === 'Dips')!;
    await expect(setExerciseArchived(db, dips.id, true)).rejects.toThrow(/programme actif/);
    const ex = await createExercise(db, { name: 'Pull-over', kind: 'weight', muscles: [{ muscleGroupId: 'lats', role: 'primary' }] });
    await setExerciseArchived(db, ex.id, true);
    expect((await listExercises(db)).some((e) => e.id === ex.id)).toBe(false);
  });

  it('renomme un exercice et ses muscles', async () => {
    const db = await freshDb();
    const dips = (await listExercises(db)).find((e) => e.name === 'Dips')!;
    const updated = await updateExercise(db, dips.id, { name: 'Dips lestés', muscles: [{ muscleGroupId: 'triceps', role: 'primary' }] });
    expect(updated.name).toBe('Dips lestés');
    expect(updated.muscles).toEqual([{ muscleGroupId: 'triceps', role: 'primary' }]);
  });
});

describe('export / import JSON', () => {
  it('fait un aller-retour sans perte', async () => {
    const db = await freshDb();
    const p = (await getActiveProgram(db))!;
    const json = await exportProgram(db, p.id);

    const other = await freshDb();
    const importedId = await importProgram(other, JSON.parse(JSON.stringify(json)));
    const reexported = await exportProgram(other, importedId);
    expect({ ...reexported, exportedAt: null }).toEqual({ ...json, exportedAt: null });
  });

  it('archive le programme courant et réutilise les exercices existants', async () => {
    const db = await freshDb();
    const before = (await listExercises(db)).length;
    const json = await exportProgram(db, (await getActiveProgram(db))!.id);
    json.program.name = 'Importé';
    json.program.templates[0]!.slots[0]!.options.push({ exercise: 'Nouvel exercice' });
    await importProgram(db, json);
    const programs = await listPrograms(db);
    expect(programs.map((p) => [p.name, p.isActive])).toEqual([
      ['Importé', true],
      ['Push / Pull / Legs', false],
    ]);
    expect((await listExercises(db)).length).toBe(before + 1);
  });

  it('rejette un fichier invalide avec un message lisible', async () => {
    const db = await freshDb();
    await expect(importProgram(db, { foo: 1 })).rejects.toThrow(/^Ce fichier n.est pas un programme TrAIning/);
    await expect(
      importProgram(db, { format: 'training-program', version: 1, program: { name: 'X', templates: [{ name: 'A', slots: [{ options: [] }] }] } }),
    ).rejects.toThrow(/au moins un exercice/);
    expect(await listPrograms(db)).toHaveLength(1);
  });
});

describe('restauration du programme initial', () => {
  it('crée une nouvelle copie active et archive la version modifiée', async () => {
    const db = await freshDb();
    const p = (await getActiveProgram(db))!;
    await updateSlot(db, p.templates[0]!.slots[1]!.id, { loadKg: 30 });
    const restoredId = await restoreInitialProgram(db);
    const active = (await getActiveProgram(db))!;
    expect(active.id).toBe(restoredId);
    expect(active.templates[0]!.slots[1]!.loadKg).toBe(22);
    expect((await listPrograms(db)).filter((x) => !x.isActive)).toHaveLength(1);
    await deleteArchivedProgram(db, p.id);
    await expect(deleteArchivedProgram(db, restoredId)).rejects.toThrow(/actif/);
  });
});
