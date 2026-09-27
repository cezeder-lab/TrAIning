import type { Db } from '../db/driver.ts';
import { DomainError } from '../db/util.ts';
import { getThumbnails } from '../repos/media.ts';
import { getProgram } from '../repos/program.ts';
import { getLastPerformance, getSession, type LastPerformance } from '../repos/sessions.ts';
import type { Block } from '../types.ts';
import { effectiveTargets, formatLoad, formatNumber, formatRir, formatTarget } from './format.ts';

/** Contenu d'une fiche de séance à imprimer en image (téléphone, à la salle). */
export interface SheetExercise {
  title: string;
  /** Exercice prévu quand le titre est un libellé de slot. */
  exerciseName: string | null;
  alternatives: string[];
  block: Block;
  blockLabel: string | null;
  target: string;
  load: string;
  rir: string;
  last: string | null;
  comment: string | null;
  isOptional: boolean;
  checkboxes: number;
  thumbnail: string | null;
}

export interface SheetData {
  title: string;
  date: string | null;
  comment: string | null;
  exercises: SheetExercise[];
}

function formatLast(last: LastPerformance | null): string | null {
  if (!last || last.sets.length === 0) return null;
  const [, m, d] = last.date.split('-');
  const loads = new Set(last.sets.map((s) => s.loadKg));
  const values = last.sets.map((s) => (s.value != null ? formatNumber(s.value) : '?'));
  const body =
    loads.size === 1 && last.sets[0]!.loadKg != null
      ? `${formatNumber(last.sets[0]!.loadKg)} kg × ${values.join('/')}`
      : last.sets.map((s) => `${s.loadKg != null ? `${formatNumber(s.loadKg)}×` : ''}${s.value != null ? formatNumber(s.value) : '?'}`).join(' · ');
  return `Dernière (${d}/${m}) : ${body}`;
}

/** Fiche d'un template du programme (séance type), pour une date éventuelle. */
export async function buildTemplateSheet(db: Db, templateId: string, date: string | null = null): Promise<SheetData> {
  const t = (await db.select<{ program_id: string }>('SELECT program_id FROM workout_template WHERE id = ?', [templateId]))[0];
  if (!t) throw new DomainError('Séance type introuvable.');
  const template = (await getProgram(db, t.program_id))!.templates.find((x) => x.id === templateId)!;
  const slots = template.slots.filter((s) => !s.isOptional || s.enabledByDefault);
  const thumbs = await getThumbnails(db, slots.map((s) => s.options[0]!.exerciseId));
  const exercises: SheetExercise[] = [];
  for (const s of slots) {
    const o = s.options[0]!;
    const tg = effectiveTargets(s, o);
    const last = await getLastPerformance(db, o.exerciseId, { beforeDate: date ?? '9999-12-31' });
    exercises.push({
      title: s.label ?? o.exerciseName,
      exerciseName: s.label ? o.exerciseName : null,
      alternatives: s.options.slice(1).map((x) => x.exerciseName),
      block: s.block,
      blockLabel: s.blockLabel,
      target: formatTarget(tg, s.targetUnit, s.perSide),
      load: [formatLoad(tg.loadKg, tg.loadNextKg), s.loadNote, o.note].filter(Boolean).join(' · '),
      rir: formatRir(s.rirMin, s.rirMax),
      last: formatLast(last),
      comment: s.comment,
      isOptional: s.isOptional,
      checkboxes: tg.sets ?? 1,
      thumbnail: thumbs.get(o.exerciseId) ?? null,
    });
  }
  return { title: template.name, date, comment: template.comment, exercises };
}

/** Fiche d'une séance planifiée (ses propres valeurs, éventuellement modifiées). */
export async function buildSessionSheet(db: Db, sessionId: string): Promise<SheetData> {
  const s = await getSession(db, sessionId);
  if (!s) throw new DomainError('Séance introuvable.');
  const list = s.exercises.filter((e) => e.isEnabled);
  const thumbs = await getThumbnails(db, list.map((e) => e.exerciseId));
  const exercises: SheetExercise[] = [];
  for (const e of list) {
    const last = await getLastPerformance(db, e.exerciseId, { beforeDate: s.date, excludeSessionId: s.id });
    const loads = new Set(e.setEntries.map((x) => x.loadKg));
    const load = loads.size === 1 ? formatLoad(e.setEntries[0]?.loadKg ?? null, null) : formatLoad(e.loadKg, null);
    exercises.push({
      title: e.label ?? e.exerciseName,
      exerciseName: e.label ? e.exerciseName : null,
      alternatives: e.alternatives.filter((a) => a.exerciseId !== e.exerciseId).map((a) => a.name),
      block: e.block,
      blockLabel: e.blockLabel,
      target: formatTarget({ sets: e.setEntries.length || e.sets, targetMin: e.targetMin, targetMax: e.targetMax }, e.targetUnit, e.perSide),
      load: [load, e.loadNote].filter(Boolean).join(' · '),
      rir: formatRir(e.rirMin, e.rirMax),
      last: formatLast(last),
      comment: e.plannedComment,
      isOptional: e.isOptional,
      checkboxes: Math.max(1, e.setEntries.length),
      thumbnail: thumbs.get(e.exerciseId) ?? null,
    });
  }
  return { title: s.name, date: s.date, comment: s.comment, exercises };
}
