import type { WeightState } from '../types.ts';

/** Aliment d'une table de référence (Ciqual, FCÉN), valeurs pour 100 g. */
export interface ExternalFood {
  sourceRef: string;
  name: string;
  category: string | null;
  state: WeightState;
  kcal: number | null;
  proteinG: number | null;
  carbsG: number | null;
  sugarsG: number | null;
  fatG: number | null;
  satFatG: number | null;
  fiberG: number | null;
  saltG: number | null;
  alcoholG: number | null;
  flags?: Record<string, string>;
  /** Mots-clés de recherche supplémentaires. */
  aliases?: string | null;
  /** Portions fournies par la source. */
  portions?: { label: string; grams: number }[];
}

/** Format compact embarqué dans l'installeur (resources/<source>.json.gz). */
export interface FoodPack {
  source?: 'ciqual' | 'cnf';
  version: string;
  fields: string[];
  rows: unknown[][];
}

const PACK_FIELDS = [
  'sourceRef', 'name', 'category', 'state', 'kcal', 'proteinG', 'carbsG', 'sugarsG', 'fatG', 'satFatG', 'fiberG',
  'saltG', 'alcoholG', 'flags', 'aliases', 'portions',
] as const;

export function packFoods(foods: ExternalFood[], version: string, source: 'ciqual' | 'cnf'): FoodPack {
  return { source, version, fields: [...PACK_FIELDS], rows: foods.map((f) => PACK_FIELDS.map((k) => f[k] ?? null)) };
}

export function unpackFoods(pack: FoodPack): ExternalFood[] {
  return pack.rows.map((row) => {
    const f = Object.fromEntries(pack.fields.map((k, i) => [k, row[i] ?? null])) as Record<string, unknown>;
    for (const k of ['flags', 'aliases', 'portions']) if (f[k] == null) delete f[k];
    return f as unknown as ExternalFood;
  });
}

/**
 * Énergie calculée à partir des macronutriments avec les coefficients du règlement UE 1169/2011
 * (protéines et glucides 4, lipides 9, fibres 2, alcool 7 kcal/g). Null si protéines ou lipides inconnus.
 */
export function energyFromMacros(f: { proteinG: number | null; carbsG: number | null; fatG: number | null; fiberG?: number | null; alcoholG?: number | null }): number | null {
  if (f.proteinG == null || f.fatG == null) return null;
  return Math.round(f.proteinG * 4 + (f.carbsG ?? 0) * 4 + f.fatG * 9 + (f.fiberG ?? 0) * 2 + (f.alcoholG ?? 0) * 7);
}

export const ENERGY_COMPUTED_FLAG = 'calculée à partir des macronutriments';
