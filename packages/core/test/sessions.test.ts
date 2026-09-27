import { describe, expect, it } from 'vitest';
import {
  addMediaFile,
  addMediaLink,
  addPain,
  addSessionExercise,
  addSet,
  completeAllSets,
  createCardio,
  createSessionFromTemplate,
  deleteMedia,
  estimateOneRepMax,
  getActiveProgram,
  getExerciseHistory,
  getLastPerformance,
  getSession,
  getThumbnails,
  listCardio,
  listSessions,
  removeSet,
  setMediaThumbnail,
  switchSessionAlternative,
  updateSessionExercise,
  updateSet,
} from '../src/index.ts';
import { freshDb } from './helpers.ts';

async function templateId(db: Awaited<ReturnType<typeof freshDb>>, name: string) {
  return (await getActiveProgram(db))!.templates.find((t) => t.name === name)!.id;
}

describe('séances', () => {
  it('crée une séance pré-remplie à partir du template', async () => {
    const db = await freshDb();
    const id = await createSessionFromTemplate(db, await templateId(db, 'Push'), '2026-09-28');
    const s = (await getSession(db, id))!;
    expect(s.name).toBe('Push');
    expect(s.status).toBe('planned');
    expect(s.exercises).toHaveLength(9);
    const incline = s.exercises[1]!;
    expect(incline.setEntries).toHaveLength(4);
    expect(incline.setEntries[0]).toMatchObject({ plannedLoadKg: 22, plannedValue: 8, loadKg: 22, value: 8, isDone: false });
    const lateral = s.exercises[3]!;
    expect(lateral.alternatives.map((a) => a.name)).toEqual(['Élévations latérales (haltères)', 'Élévations latérales (poulie)']);
    expect(lateral.loadKg).toBe(8);
    const dips = s.exercises.at(-1)!;
    expect([dips.isOptional, dips.isEnabled, dips.setEntries.length]).toEqual([true, false, 1]);
  });

  it('reprend la dernière performance et calcule l’historique', async () => {
    const db = await freshDb();
    const legs = await templateId(db, 'Legs');
    const s1 = (await getSession(db, await createSessionFromTemplate(db, legs, '2026-09-01')))!;
    const curl = s1.exercises.find((e) => e.exerciseName === 'Leg curl')!;
    expect(curl.loadKg).toBeNull();
    for (const [i, set] of curl.setEntries.entries()) await updateSet(db, set.id, { loadKg: 40 + i * 5, value: 12, isDone: true });

    const last = await getLastPerformance(db, curl.exerciseId, { beforeDate: '2026-09-05' });
    expect(last?.sets.map((x) => x.loadKg)).toEqual([40, 45, 50]);

    const s2 = (await getSession(db, await createSessionFromTemplate(db, legs, '2026-09-05')))!;
    const curl2 = s2.exercises.find((e) => e.exerciseName === 'Leg curl')!;
    expect(curl2.setEntries.map((x) => x.loadKg)).toEqual([40, 45, 50]);
    expect(curl2.setEntries.map((x) => x.value)).toEqual([15, 15, 15]);
    await completeAllSets(db, curl2.id);

    const history = await getExerciseHistory(db, curl.exerciseId);
    expect(history.map((h) => h.date)).toEqual(['2026-09-01', '2026-09-05']);
    expect(history[0]).toMatchObject({ maxLoadKg: 50, volumeKg: 40 * 12 + 45 * 12 + 50 * 12 });
    expect(history[0]!.e1rmKg).toBe(estimateOneRepMax(50, 12));
    expect(history[1]!.bestSet).toEqual({ loadKg: 50, value: 15, rir: null });
  });

  it("n'intègre pas un exercice optionnel non fait dans les stats", async () => {
    const db = await freshDb();
    const s = (await getSession(db, await createSessionFromTemplate(db, await templateId(db, 'Push'), '2026-09-28')))!;
    const dips = s.exercises.at(-1)!;
    expect(await getExerciseHistory(db, dips.exerciseId)).toEqual([]);
    const summary = (await listSessions(db, '2026-09-01', '2026-09-30'))[0]!;
    expect(summary.exerciseCount).toBe(8);
    await updateSessionExercise(db, dips.id, { isEnabled: true });
    expect((await listSessions(db, '2026-09-01', '2026-09-30'))[0]!.exerciseCount).toBe(9);
  });

  it('change d’alternative et ajuste la charge prévue', async () => {
    const db = await freshDb();
    const s = (await getSession(db, await createSessionFromTemplate(db, await templateId(db, 'Pull'), '2026-09-28')))!;
    const row = s.exercises.find((e) => e.label === 'Tirage horizontal')!;
    expect(row.setEntries[0]!.loadKg).toBe(26);
    await switchSessionAlternative(db, row.id, row.alternatives[1]!.exerciseId);
    const after = (await getSession(db, s.id))!.exercises.find((e) => e.id === row.id)!;
    expect(after.exerciseName).toBe('Tirage horizontal poulie basse (prise V)');
    expect(after.setEntries[0]!.loadKg).toBeNull();
    await expect(switchSessionAlternative(db, row.id, s.exercises[0]!.exerciseId)).rejects.toThrow(/alternative/);
  });

  it('ajoute et retire des séries, ajoute un exercice libre', async () => {
    const db = await freshDb();
    const s = (await getSession(db, await createSessionFromTemplate(db, await templateId(db, 'Push'), '2026-09-28')))!;
    const ex = s.exercises[1]!;
    await addSet(db, ex.id);
    let sets = (await getSession(db, s.id))!.exercises[1]!.setEntries;
    expect(sets.map((x) => x.setIndex)).toEqual([0, 1, 2, 3, 4]);
    await removeSet(db, sets[1]!.id);
    sets = (await getSession(db, s.id))!.exercises[1]!.setEntries;
    expect(sets.map((x) => x.setIndex)).toEqual([0, 1, 2, 3]);
    await addSessionExercise(db, s.id, ex.exerciseId);
    expect((await getSession(db, s.id))!.exercises).toHaveLength(10);
  });

  it('enregistre douleurs et cardio', async () => {
    const db = await freshDb();
    const id = await createSessionFromTemplate(db, await templateId(db, 'Push'), '2026-09-28');
    await addPain(db, { date: '2026-09-28', sessionId: id, zone: 'Épaule', side: 'left', intensity: 3 });
    await createCardio(db, { date: '2026-09-28', sessionId: id, activity: 'Marche inclinée', durationS: 1200, inclineOrLevel: '12 %', caloriesWatchEst: 180 });
    const s = (await getSession(db, id))!;
    expect(s.pains[0]).toMatchObject({ zone: 'Épaule', intensity: 3 });
    expect(s.cardio[0]).toMatchObject({ activity: 'Marche inclinée', durationS: 1200 });
    expect((await listSessions(db, '2026-09-28', '2026-09-28'))[0]!.maxPain).toBe(3);
    expect(await listCardio(db, { from: '2026-09-01', to: '2026-09-30' })).toHaveLength(1);
    await expect(addPain(db, { date: '2026-09-28', zone: 'Genou', intensity: 11 })).rejects.toThrow();
  });
});

describe('médias', () => {
  it('gère images, liens et miniature', async () => {
    const db = await freshDb();
    const ex = (await getActiveProgram(db))!.templates[0]!.slots[1]!.options[0]!.exerciseId;
    const link = await addMediaLink(db, ex, 'https://www.youtube.com/watch?v=abc');
    const img1 = await addMediaFile(db, ex, 'exercises/a.jpg');
    const img2 = await addMediaFile(db, ex, 'exercises/b.gif');
    expect((await getThumbnails(db, [ex])).get(ex)).toBe('exercises/a.jpg');
    await setMediaThumbnail(db, img2);
    expect((await getThumbnails(db, [ex])).get(ex)).toBe('exercises/b.gif');
    await expect(setMediaThumbnail(db, link)).rejects.toThrow(/image/);
    await expect(addMediaLink(db, ex, 'pas un lien')).rejects.toThrow(/invalide/);
    expect(await deleteMedia(db, img1)).toBe('exercises/a.jpg');
  });
});
