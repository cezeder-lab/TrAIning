import type { Db } from '../db/driver.ts';
import { listWaist, listWeights, type WaistEntry, type WeightEntry } from '../repos/body.ts';

const DAY = 86_400_000;
const t = (d: string) => Date.parse(`${d}T12:00:00Z`);
const shift = (d: string, days: number) => new Date(t(d) + days * DAY).toISOString().slice(0, 10);

/** Seuils sous lesquels on refuse d'afficher une tendance (pesées irrégulières). */
export const TREND_MIN_POINTS = 4;
export const TREND_MIN_SPAN_DAYS = 10;
export const TREND_WINDOW_DAYS = 28;

export interface WeightPoint extends WeightEntry {
  /** Moyenne des pesées disponibles sur les 7 derniers jours (jour inclus). */
  avg7: number;
  /** Nombre de pesées ayant servi à la moyenne. */
  avg7Count: number;
}

export function withMovingAverage(weights: WeightEntry[]): WeightPoint[] {
  return weights.map((w) => {
    const window = weights.filter((x) => x.date <= w.date && t(x.date) > t(w.date) - 7 * DAY);
    const avg = window.reduce((s, x) => s + x.weightKg, 0) / window.length;
    return { ...w, avg7: Math.round(avg * 100) / 100, avg7Count: window.length };
  });
}

export type Trend =
  | { status: 'ok'; kgPerWeek: number; points: number; spanDays: number; from: string; to: string }
  | { status: 'insufficient'; points: number; spanDays: number; reason: string };

/** Tendance (régression linéaire) sur les `TREND_WINDOW_DAYS` derniers jours de pesées. */
export function weightTrend(weights: WeightEntry[], endDate: string): Trend {
  const from = shift(endDate, -TREND_WINDOW_DAYS + 1);
  const pts = weights.filter((w) => w.date >= from && w.date <= endDate);
  const span = pts.length ? Math.round((t(pts[pts.length - 1]!.date) - t(pts[0]!.date)) / DAY) : 0;
  if (pts.length < TREND_MIN_POINTS || span < TREND_MIN_SPAN_DAYS) {
    return {
      status: 'insufficient',
      points: pts.length,
      spanDays: span,
      reason: `Pas assez de pesées pour une tendance fiable : ${pts.length} sur ${TREND_WINDOW_DAYS} jours (il en faut au moins ${TREND_MIN_POINTS}, étalées sur ${TREND_MIN_SPAN_DAYS} jours).`,
    };
  }
  const xs = pts.map((p) => (t(p.date) - t(pts[0]!.date)) / DAY);
  const ys = pts.map((p) => p.weightKg);
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let num = 0;
  let den = 0;
  for (let i = 0; i < xs.length; i++) {
    num += (xs[i]! - mx) * (ys[i]! - my);
    den += (xs[i]! - mx) ** 2;
  }
  return { status: 'ok', kgPerWeek: Math.round((num / den) * 7 * 100) / 100, points: pts.length, spanDays: span, from: pts[0]!.date, to: pts[pts.length - 1]!.date };
}

export interface BodyMetrics {
  from: string;
  to: string;
  weights: WeightPoint[];
  latest: WeightPoint | null;
  trend: Trend;
  waist: WaistEntry[];
}

export async function getBodyMetrics(db: Db, from: string, to: string): Promise<BodyMetrics> {
  // On charge 7 jours de plus pour que la moyenne du premier jour soit juste.
  const all = await listWeights(db, shift(from, -6), to);
  const withAvg = withMovingAverage(all).filter((w) => w.date >= from);
  const trendSource = await listWeights(db, shift(to, -TREND_WINDOW_DAYS + 1), to);
  return {
    from,
    to,
    weights: withAvg,
    latest: withAvg.at(-1) ?? null,
    trend: weightTrend(trendSource, to),
    waist: await listWaist(db, from, to),
  };
}
