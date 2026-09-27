import type { Db } from '../db/driver.ts';
import { listFoodEntries } from '../repos/foodLog.ts';
import { getDayType, getGoalForDay } from '../repos/goals.ts';
import type { DayType, MacroTotals, NutritionGoal } from '../types.ts';
import { sumTotals } from './nutritionCalc.ts';

export interface DaySummary {
  date: string;
  logged: boolean;
  entryCount: number;
  estimatedCount: number;
  totals: MacroTotals;
  dayType: DayType;
  goal: NutritionGoal | null;
}

export interface NutritionSummary {
  from: string;
  to: string;
  days: DaySummary[];
  loggedDays: number;
  /** Moyenne sur les jours renseignés uniquement (un jour vide n'est pas un jour à 0 kcal). */
  averageLogged: MacroTotals | null;
  estimatedShare: number;
}

function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = Date.parse(`${from}T12:00:00Z`); d <= Date.parse(`${to}T12:00:00Z`); d += 86_400_000) out.push(new Date(d).toISOString().slice(0, 10));
  return out;
}

export async function getNutritionSummary(db: Db, from: string, to: string): Promise<NutritionSummary> {
  const entries = await listFoodEntries(db, from, to);
  const days: DaySummary[] = [];
  for (const date of eachDay(from, to)) {
    const list = entries.filter((e) => e.date === date);
    const { dayType } = await getDayType(db, date);
    days.push({
      date,
      logged: list.length > 0,
      entryCount: list.length,
      estimatedCount: list.filter((e) => e.isEstimated).length,
      totals: sumTotals(list),
      dayType,
      goal: await getGoalForDay(db, date, dayType),
    });
  }
  const logged = days.filter((d) => d.logged);
  const avg = logged.length
    ? (() => {
        const s = sumTotals(logged.map((d) => d.totals));
        const n = logged.length;
        return { kcal: Math.round(s.kcal / n), proteinG: Math.round((s.proteinG / n) * 10) / 10, carbsG: Math.round((s.carbsG / n) * 10) / 10, fatG: Math.round((s.fatG / n) * 10) / 10, fiberG: Math.round((s.fiberG / n) * 10) / 10 };
      })()
    : null;
  return {
    from,
    to,
    days,
    loggedDays: logged.length,
    averageLogged: avg,
    estimatedShare: entries.length ? Math.round((entries.filter((e) => e.isEstimated).length / entries.length) * 100) / 100 : 0,
  };
}
