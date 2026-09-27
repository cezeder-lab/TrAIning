import type { Block, SlotOption, TargetUnit, TemplateSlot } from '../types.ts';

/** Nombre au format français (virgule décimale, sans zéros inutiles). */
export function formatNumber(n: number, maxDecimals = 2): string {
  return n.toLocaleString('fr-FR', { maximumFractionDigits: maxDecimals, useGrouping: false });
}

export const BLOCK_LABELS: Record<Block, string> = {
  warmup: 'Échauffement',
  work: 'Travail',
  finisher: 'Finisher',
  cooldown: 'Retour au calme',
};

export const UNIT_SUFFIX: Record<TargetUnit, string> = { reps: '', s: ' s', m: ' m', min: ' min' };

/** Cibles effectives d'une alternative : ses surcharges, sinon les valeurs du slot. */
export function effectiveTargets(slot: TemplateSlot, option?: SlotOption) {
  return {
    sets: option?.sets ?? slot.sets,
    targetMin: option?.targetMin ?? slot.targetMin,
    targetMax: option?.targetMax ?? slot.targetMax,
    loadKg: option?.loadKg ?? slot.loadKg,
    loadNextKg: option?.loadKg != null ? option.loadNextKg : (option?.loadNextKg ?? slot.loadNextKg),
  };
}

/** « 4 × 6-8 », « 3 × 30-45 s », « 3 × 8-10 / côté », « — ». */
export function formatTarget(
  t: { sets: number | null; targetMin: number | null; targetMax: number | null },
  unit: TargetUnit,
  perSide: boolean,
): string {
  let range = '';
  if (t.targetMin != null && t.targetMax != null && t.targetMax !== t.targetMin) {
    range = `${formatNumber(t.targetMin)}-${formatNumber(t.targetMax)}`;
  } else if (t.targetMin != null || t.targetMax != null) {
    range = formatNumber((t.targetMin ?? t.targetMax)!);
  }
  if (range) range += UNIT_SUFFIX[unit];
  if (range && perSide) range += ' / côté';
  if (t.sets != null && range) return `${t.sets} × ${range}`;
  if (t.sets != null) return `${t.sets} séries`;
  return range || '—';
}

/** « 22 → 24 kg », « 90 kg », « » si aucune charge. */
export function formatLoad(loadKg: number | null, loadNextKg: number | null): string {
  if (loadKg == null) return '';
  if (loadNextKg != null && loadNextKg !== loadKg) return `${formatNumber(loadKg)} → ${formatNumber(loadNextKg)} kg`;
  return `${formatNumber(loadKg)} kg`;
}

/** « 2-3 RIR », « 1 RIR ». */
export function formatRir(min: number | null, max: number | null): string {
  if (min == null && max == null) return '';
  if (min != null && max != null && min !== max) return `${min}-${max} RIR`;
  return `${min ?? max} RIR`;
}

/** Nom affiché d'un slot : son libellé s'il y a des alternatives, sinon l'exercice. */
export function slotTitle(slot: TemplateSlot): string {
  if (slot.label) return slot.label;
  return slot.options[0]?.exerciseName ?? 'Slot vide';
}

/** Durée de repos : « 90 s », « 2 min », « 2 min 30 ». */
export function formatRest(seconds: number | null): string {
  if (seconds == null) return '';
  if (seconds < 60) return `${seconds} s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s ? `${m} min ${String(s).padStart(2, '0')}` : `${m} min`;
}
