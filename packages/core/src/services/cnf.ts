import { unzipSync } from 'fflate';
import type { Db } from '../db/driver.ts';
import { DomainError } from '../db/util.ts';
import { countFoodsBySource, upsertExternalFoods } from '../repos/foods.ts';
import { guessState } from './ciqual.ts';
import { ENERGY_COMPUTED_FLAG, energyFromMacros, type ExternalFood } from './foodPack.ts';

/**
 * Fichier canadien sur les éléments nutritifs (FCÉN, Santé Canada) — format CSV 2026.
 * Contient des informations visées par la Licence du gouvernement ouvert – Canada.
 */

export const CNF_ATTRIBUTION = 'Contient des informations visées par la Licence du gouvernement ouvert – Canada (Fichier canadien sur les éléments nutritifs, Santé Canada).';
export const CNF_CKAN_SEARCH = 'https://open.canada.ca/data/api/action/package_search?q=%22Canadian%20Nutrient%20File%22&rows=20';
export const CNF_FALLBACK_URLS = [
  'https://open.canada.ca/data/dataset/1b6139bd-ed7e-4043-bc28-ff00e10f3109/resource/019f2a90-e3a9-489d-b6e1-f74f4ba1d006/download/cnf_fcen_all-files-data_2026.zip',
];

/** Lecture CSV (guillemets, "" échappés, retours à la ligne dans les champs, BOM). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  for (; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** Tableau d'objets indexés par les noms de colonnes de l'en-tête. */
function table(text: string): Record<string, string>[] {
  const [head, ...rows] = parseCsv(text);
  if (!head) return [];
  const cols = head.map((h) => h.trim());
  return rows.map((r) => Object.fromEntries(cols.map((c, i) => [c, (r[i] ?? '').trim()])));
}

function decode(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

const num = (s: string | undefined): number | null => {
  if (s == null || s.trim() === '') return null;
  const n = Number(s.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};
const round = (n: number | null, d = 2) => (n == null ? null : Math.round(n * 10 ** d) / 10 ** d);

/** Codes des éléments nutritifs du FCÉN utilisés. */
const N = { protein: '203', fat: '204', carbTotal: '205', kcal: '208', kj: '268', sugars: '269', fiber: '291', satFat: '606', sodiumMg: '307', alcohol: '221' };

export function parseCnfFiles(files: {
  foodName: string;
  nutrientAmount: string;
  measureName?: string;
  measureConversion?: string;
  foodGroup?: string;
}): ExternalFood[] {
  const groups = new Map(table(files.foodGroup ?? '').map((g) => [g.CNF_Food_Group_Code, g.CNF_Food_Group_Description_FR || g.CNF_Food_Group_Description_EN]));
  const values = new Map<string, Record<string, number>>();
  for (const a of table(files.nutrientAmount)) {
    const v = num(a.Nutrient_Amount);
    if (v == null) continue;
    const code = a.Nutrient_Code!;
    if (!Object.values(N).includes(code)) continue;
    const m = values.get(a.Food_Code!) ?? {};
    m[code] = v;
    values.set(a.Food_Code!, m);
  }
  const measureNames = new Map(table(files.measureName ?? '').map((m) => [m.Measure_Code, m.Measure_Description_and_Unit_FR || m.Measure_Description_and_Unit_EN]));
  const portions = new Map<string, { label: string; grams: number }[]>();
  for (const c of table(files.measureConversion ?? '')) {
    if (c.Measure_Type_Code !== '6') continue; // 3 = portion non comestible
    const grams = num(c.Measure_Weight_Conversion);
    const label = measureNames.get(c.Measure_Code);
    if (!grams || grams <= 0 || !label || /^\d+([.,]\d+)?\s*(g|ml)$/i.test(label.trim())) continue;
    const list = portions.get(c.Food_Code!) ?? [];
    if (list.length < 6 && !list.some((p) => p.label === label)) list.push({ label: label.trim(), grams: Math.round(grams * 10) / 10 });
    portions.set(c.Food_Code!, list);
  }
  const out: ExternalFood[] = [];
  for (const f of table(files.foodName)) {
    const code = f.Food_Code;
    const name = f.Food_Description_FR || f.Food_Description_EN;
    if (!code || !name) continue;
    const v = values.get(code) ?? {};
    const fiber = v[N.fiber] ?? null;
    // Le FCÉN donne les glucides totaux (fibres comprises) ; en Europe on compte les glucides disponibles.
    const carbTotal = v[N.carbTotal] ?? null;
    const carbs = carbTotal == null ? null : Math.max(0, carbTotal - (fiber ?? 0));
    const food: ExternalFood = {
      sourceRef: code,
      name,
      category: groups.get(f.CNF_Food_Group_Code) ?? null,
      state: guessState(name),
      kcal: v[N.kcal] ?? (v[N.kj] != null ? Math.round(v[N.kj]! / 4.184) : null),
      proteinG: round(v[N.protein] ?? null),
      carbsG: round(carbs),
      sugarsG: round(v[N.sugars] ?? null),
      fatG: round(v[N.fat] ?? null),
      satFatG: round(v[N.satFat] ?? null),
      fiberG: round(fiber),
      saltG: v[N.sodiumMg] != null ? round((v[N.sodiumMg]! * 2.5) / 1000) : null,
      alcoholG: round(v[N.alcohol] ?? null),
      // Mots-clés français + nom anglais (Claude peut chercher en anglais).
      aliases: [f.Alternate_Description_FR, f.Food_Description_EN].filter(Boolean).join(' | ') || null,
      portions: portions.get(code),
    };
    if (food.kcal == null) {
      food.kcal = energyFromMacros(food);
      if (food.kcal != null) food.flags = { kcal: ENERGY_COMPUTED_FLAG };
    }
    if (food.kcal != null) food.kcal = Math.round(food.kcal);
    out.push(food);
  }
  return out;
}

export function parseCnfZip(zip: Uint8Array, versionHint?: string): { foods: ExternalFood[]; version: string } {
  const files = unzipSync(zip, { filter: (f) => /\.csv$/i.test(f.name) });
  const find = (re: RegExp) => {
    const k = Object.keys(files).find((n) => re.test(n.split('/').pop()!));
    return k ? decode(files[k]!) : undefined;
  };
  const foodName = find(/^food_name\.csv$/i);
  const nutrientAmount = find(/^nutrient_amount\.csv$/i);
  if (!foodName || !nutrientAmount || !/Food_Code/.test(foodName.slice(0, 200))) {
    throw new DomainError('Archive du Fichier canadien non reconnue (format CSV 2026 attendu : Food_Name.csv, Nutrient_Amount.csv).');
  }
  const foods = parseCnfFiles({
    foodName,
    nutrientAmount,
    measureName: find(/^measure_name\.csv$/i),
    measureConversion: find(/^measure_weight_conversion\.csv$/i),
    foodGroup: find(/^cnf_food_group\.csv$/i),
  });
  const year = versionHint ?? /(20\d{2})/.exec(Object.keys(files).join(' '))?.[1];
  return { foods, version: `FCÉN ${year ?? ''}`.trim() };
}

export async function importCnf(db: Db, foods: ExternalFood[], version: string) {
  if (foods.length < 100) throw new DomainError(`Import du Fichier canadien interrompu : seulement ${foods.length} aliments lus.`);
  return upsertExternalFoods(db, 'cnf', foods as unknown as Parameters<typeof upsertExternalFoods>[2], version);
}

export async function cnfStatus(db: Db): Promise<{ count: number; version: string | null }> {
  const count = (await countFoodsBySource(db)).cnf ?? 0;
  const v = (await db.select<{ v: string | null }>("SELECT max(source_version) AS v FROM food WHERE source = 'cnf'"))[0]?.v ?? null;
  return { count, version: v };
}

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

/** Archive « toutes les données » la plus récente sur le portail du gouvernement ouvert du Canada. */
export async function findCnfZipUrls(fetchFn: FetchFn): Promise<{ url: string; year: string | null }[]> {
  const out: { url: string; year: string | null }[] = [];
  try {
    const res = await fetchFn(CNF_CKAN_SEARCH);
    if (res.ok) {
      const data = (await res.json()) as { result?: { results?: { title?: string | Record<string, string>; resources?: { url: string }[] }[] } };
      const pkgs = (data.result?.results ?? [])
        .map((p) => {
          const title = typeof p.title === 'string' ? p.title : (p.title?.en ?? '');
          const year = /Canadian Nutrient File,\s*(20\d{2})/i.exec(title)?.[1] ?? null;
          const res2 = (p.resources ?? []).find((r) => /all-files.*\.zip$/i.test(r.url));
          return year && res2 ? { url: res2.url.startsWith('http') ? res2.url : `https://open.canada.ca${res2.url}`, year } : null;
        })
        .filter((x): x is { url: string; year: string } => x !== null)
        .sort((a, b) => b.year.localeCompare(a.year));
      out.push(...pkgs);
    }
  } catch {
    /* portail indisponible : adresse connue */
  }
  for (const url of CNF_FALLBACK_URLS) if (!out.some((o) => o.url === url)) out.push({ url, year: /(20\d{2})\.zip$/.exec(url)?.[1] ?? null });
  return out;
}

export async function downloadAndImportCnf(db: Db, fetchFn: FetchFn, onProgress?: (msg: string) => void) {
  const errors: string[] = [];
  for (const { url, year } of await findCnfZipUrls(fetchFn)) {
    try {
      onProgress?.(`Téléchargement du Fichier canadien ${year ?? ''}…`);
      const res = await fetchFn(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { foods, version } = parseCnfZip(new Uint8Array(await res.arrayBuffer()), year ?? undefined);
      onProgress?.(`Import de ${foods.length} aliments…`);
      return { version, ...(await importCnf(db, foods, version)) };
    } catch (err) {
      errors.push(`${url} : ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  throw new DomainError(`Téléchargement du Fichier canadien impossible. ${errors.join(' | ')}`);
}
