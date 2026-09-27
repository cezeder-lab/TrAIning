import { DomainError } from '../db/util.ts';
import type { EntryUnit, Food, FoodPortion, MacroTotals, Nutrients, WeightState } from '../types.ts';

export const NUTRIENT_KEYS = ['kcal', 'proteinG', 'carbsG', 'sugarsG', 'fatG', 'satFatG', 'fiberG', 'saltG'] as const;

/** Quantité saisie → grammes (ou ml) tels que saisis. */
export function quantityToGrams(quantity: number, unit: EntryUnit, portion?: Pick<FoodPortion, 'grams'> | null): number {
  if (!(quantity > 0)) throw new DomainError('La quantité doit être positive.');
  if (unit === 'portion') {
    if (!portion) throw new DomainError('Portion introuvable pour cet aliment.');
    return quantity * portion.grams;
  }
  return quantity;
}

/**
 * Convertit un poids pesé (cru ou cuit) vers l'état de référence de l'aliment grâce au
 * rendement de cuisson (poids cuit / poids cru). Sans rendement connu, le poids est gardé
 * tel quel et `converted` vaut false.
 */
export function toFoodState(
  food: Pick<Food, 'state' | 'cookedYield'>,
  grams: number,
  weighed: WeightState,
): { grams: number; converted: boolean; mismatch: boolean } {
  if (weighed === 'na' || food.state === 'na' || weighed === food.state) return { grams, converted: false, mismatch: false };
  if (!food.cookedYield) return { grams, converted: false, mismatch: true };
  return {
    grams: food.state === 'raw' ? grams / food.cookedYield : grams * food.cookedYield,
    converted: true,
    mismatch: false,
  };
}

const round = (v: number, d = 1) => Math.round(v * 10 ** d) / 10 ** d;

/** Valeurs nutritionnelles pour `grams` (dans l'état de référence de l'aliment). */
export function nutrientsFor(food: Nutrients, grams: number): Nutrients {
  const out = {} as Nutrients;
  for (const k of NUTRIENT_KEYS) {
    const v = food[k];
    out[k] = v == null ? null : round((v * grams) / 100, k === 'kcal' ? 0 : 1);
  }
  return out;
}

export function sumTotals(items: { kcal: number | null; proteinG: number | null; carbsG: number | null; fatG: number | null; fiberG: number | null }[]): MacroTotals {
  const t = { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0, fiberG: 0 };
  for (const i of items) {
    t.kcal += i.kcal ?? 0;
    t.proteinG += i.proteinG ?? 0;
    t.carbsG += i.carbsG ?? 0;
    t.fatG += i.fatG ?? 0;
    t.fiberG += i.fiberG ?? 0;
  }
  return { kcal: round(t.kcal, 0), proteinG: round(t.proteinG), carbsG: round(t.carbsG), fatG: round(t.fatG), fiberG: round(t.fiberG) };
}

/** Estimation de l'énergie à partir des macros (4/4/9), pour contrôler une saisie. */
export function kcalFromMacros(p: number, c: number, f: number, alcohol = 0): number {
  return Math.round(p * 4 + c * 4 + f * 9 + alcohol * 7);
}
