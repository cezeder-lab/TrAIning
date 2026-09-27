import { localDate } from '@training/core';

export const today = (): string => localDate();

export function parseDate(d: string): Date {
  const [y, m, day] = d.split('-').map(Number);
  return new Date(y!, m! - 1, day!);
}

export function addDays(d: string, n: number): string {
  const x = parseDate(d);
  x.setDate(x.getDate() + n);
  return localDate(x);
}

/** « lundi 28 septembre » (+ année si différente de l'année en cours). */
export function formatLongDate(d: string): string {
  const x = parseDate(d);
  const sameYear = x.getFullYear() === new Date().getFullYear();
  return x.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', ...(sameYear ? {} : { year: 'numeric' }) });
}

/** « 28/09 » ou « 28/09/25 ». */
export function formatShortDate(d: string): string {
  const x = parseDate(d);
  const sameYear = x.getFullYear() === new Date().getFullYear();
  return x.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', ...(sameYear ? {} : { year: '2-digit' }) });
}

/** Semaines (lundi → dimanche) couvrant le mois, pour un calendrier. */
export function monthGrid(year: number, month: number): string[][] {
  const first = new Date(year, month, 1);
  const offset = (first.getDay() + 6) % 7;
  const start = new Date(year, month, 1 - offset);
  const weeks: string[][] = [];
  for (let w = 0; w < 6; w++) {
    const week: string[] = [];
    for (let d = 0; d < 7; d++) {
      week.push(localDate(new Date(start.getFullYear(), start.getMonth(), start.getDate() + w * 7 + d)));
    }
    weeks.push(week);
    const next = new Date(start.getFullYear(), start.getMonth(), start.getDate() + (w + 1) * 7);
    if (next.getMonth() !== month && w >= 3) break;
  }
  return weeks;
}

export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h ? `${h} h ${String(m).padStart(2, '0')}` : `${m} min`;
}
