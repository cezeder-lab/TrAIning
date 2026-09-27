import type { Db } from '../db/driver.ts';
import { upsertExternalFoods } from '../repos/foods.ts';

/** Open Food Facts (ODbL) : recherche en ligne et cache local des produits consultés. */

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

const BASE = 'https://world.openfoodfacts.org';
const FIELDS = 'code,product_name,product_name_fr,brands,nutriments,serving_quantity,serving_size,quantity';
export const OFF_USER_AGENT = 'TrAIning/0.1 (application personnelle ; journal nutrition)';

export interface OffFood {
  sourceRef: string;
  name: string;
  brand: string | null;
  basis: '100g' | '100ml';
  kcal: number | null;
  proteinG: number | null;
  carbsG: number | null;
  sugarsG: number | null;
  fatG: number | null;
  satFatG: number | null;
  fiberG: number | null;
  saltG: number | null;
  alcoholG: number | null;
  portions: { label: string; grams: number }[];
}

const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
};

/** Convertit un produit OFF ; null s'il manque le nom ou l'énergie. */
export function mapOffProduct(p: Record<string, any>): OffFood | null {
  const n = (p.nutriments ?? {}) as Record<string, unknown>;
  const name = (p.product_name_fr || p.product_name || '').trim();
  if (!p.code || !name) return null;
  const kcal = num(n['energy-kcal_100g']) ?? (num(n.energy_100g) != null ? Math.round(num(n.energy_100g)! / 4.184) : null);
  if (kcal == null) return null;
  const quantity = String(p.quantity ?? '');
  const liquid = /\d\s*(ml|cl|l)\b/i.test(quantity) && !/\d\s*(g|kg)\b/i.test(quantity);
  const portions: { label: string; grams: number }[] = [];
  const serving = num(p.serving_quantity);
  if (serving && serving > 0) portions.push({ label: `1 portion (${p.serving_size || `${serving} ${liquid ? 'ml' : 'g'}`})`, grams: serving });
  const whole = /^(\d+(?:[.,]\d+)?)\s*(g|ml|cl)$/i.exec(quantity.trim());
  if (whole) {
    const v = Number(whole[1]!.replace(',', '.')) * (whole[2]!.toLowerCase() === 'cl' ? 10 : 1);
    if (v > 0 && v <= 1000 && v !== serving) portions.push({ label: `Produit entier (${quantity.trim()})`, grams: v });
  }
  return {
    sourceRef: String(p.code),
    name,
    brand: (String(p.brands ?? '').split(',')[0] ?? '').trim() || null,
    basis: liquid ? '100ml' : '100g',
    kcal,
    proteinG: num(n.proteins_100g),
    carbsG: num(n.carbohydrates_100g),
    sugarsG: num(n.sugars_100g),
    fatG: num(n.fat_100g),
    satFatG: num(n['saturated-fat_100g']),
    fiberG: num(n.fiber_100g),
    saltG: num(n.salt_100g),
    alcoholG: num(n.alcohol_100g),
    portions,
  };
}

const headers = { 'User-Agent': OFF_USER_AGENT, Accept: 'application/json' };

export async function offSearch(fetchFn: FetchFn, query: string, pageSize = 20): Promise<OffFood[]> {
  const url = `${BASE}/cgi/search.pl?search_terms=${encodeURIComponent(query)}&search_simple=1&action=process&json=1&page_size=${pageSize}&fields=${FIELDS}&lc=fr`;
  const res = await fetchFn(url, { headers });
  if (!res.ok) throw new Error(`Open Food Facts indisponible (HTTP ${res.status}).`);
  const data = (await res.json()) as { products?: Record<string, unknown>[] };
  return (data.products ?? []).map(mapOffProduct).filter((p): p is OffFood => p !== null);
}

export async function offByBarcode(fetchFn: FetchFn, barcode: string): Promise<OffFood | null> {
  const code = barcode.replace(/\D/g, '');
  if (code.length < 8) return null;
  const res = await fetchFn(`${BASE}/api/v2/product/${code}.json?fields=${FIELDS}`, { headers });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Open Food Facts indisponible (HTTP ${res.status}).`);
  const data = (await res.json()) as { status?: number; product?: Record<string, unknown> };
  return data.status === 1 && data.product ? mapOffProduct({ code, ...data.product }) : null;
}

/** Enregistre (ou rafraîchit) les produits consultés dans la base locale ; retourne leurs ids. */
export async function cacheOffFoods(db: Db, foods: OffFood[]): Promise<Map<string, string>> {
  await upsertExternalFoods(db, 'off', foods as unknown as Parameters<typeof upsertExternalFoods>[2], `Open Food Facts ${new Date().toISOString().slice(0, 10)}`);
  const ids = new Map<string, string>();
  for (const f of foods) {
    const r = (await db.select<{ id: string }>("SELECT id FROM food WHERE source = 'off' AND source_ref = ?", [f.sourceRef]))[0];
    if (!r) continue;
    ids.set(f.sourceRef, r.id);
    const has = (await db.select<{ n: number }>('SELECT count(*) AS n FROM food_portion WHERE food_id = ?', [r.id]))[0]!.n;
    if (!has) {
      for (const [i, p] of f.portions.entries()) {
        await db.execute('INSERT INTO food_portion (id, food_id, label, grams, is_default, sort) VALUES (?, ?, ?, ?, ?, ?)', [
          crypto.randomUUID(), r.id, p.label, p.grams, i === 0, i,
        ]);
      }
    }
  }
  return ids;
}
