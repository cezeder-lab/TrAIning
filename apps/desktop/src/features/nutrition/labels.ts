import { formatNumber, type Food, type SearchBadge } from '@training/core';

export const BADGE_LABELS: Record<SearchBadge, string> = {
  recent: 'Récent',
  favorite: 'Favori',
  custom: 'Perso',
  recipe: 'Recette',
  ciqual: 'Ciqual',
  cnf: 'FCÉN',
  off: 'Open Food Facts',
};

export const SOURCE_LABELS: Record<string, string> = {
  ciqual: 'Ciqual',
  cnf: 'FCÉN (Canada)',
  off: 'Open Food Facts',
  custom: 'Perso',
  recipe: 'Recette',
  estimate: 'Estimation',
};

const n = (v: number | null, unit = 'g') => (v == null ? '?' : `${formatNumber(v, 1)}${unit ? ` ${unit}` : ''}`);

/** « 157 kcal · P 5,5 g · G 30,6 g · L 0,9 g » pour 100 g. */
export function per100(f: Food): string {
  return `${n(f.kcal, 'kcal')} · P ${n(f.proteinG)} · G ${n(f.carbsG)} · L ${n(f.fatG)} / ${f.basis === '100ml' ? '100 ml' : '100 g'}`;
}

export function macros(e: { kcal: number | null; proteinG: number | null; carbsG: number | null; fatG: number | null }): string {
  return `${n(e.kcal, 'kcal')} · P ${n(e.proteinG)} · G ${n(e.carbsG)} · L ${n(e.fatG)}`;
}
