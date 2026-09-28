import { unzipSync } from 'fflate';
import type { Db } from '../db/driver.ts';
import { DomainError } from '../db/util.ts';
import { countFoodsBySource, upsertExternalFoods } from '../repos/foods.ts';
import { ENERGY_COMPUTED_FLAG, energyFromMacros, packFoods, unpackFoods, type ExternalFood, type FoodPack } from './foodPack.ts';

/**
 * Table Ciqual (ANSES, Licence Ouverte Etalab) : lecture des fichiers XML officiels
 * (alim_*.xml, compo_*.xml, alim_grp_*.xml), fournis en ZIP.
 */

export type CiqualFood = ExternalFood;

/** Codes des constituants Ciqual utilisés. */
export const CIQUAL_CONSTITUENTS: Record<string, keyof CiqualFood> = {
  '328': 'kcal', // Énergie, Règlement UE 1169/2011 (kcal/100 g)
  '25000': 'proteinG', // Protéines, N x facteur de Jones
  '31000': 'carbsG', // Glucides
  '32000': 'sugarsG', // Sucres
  '40000': 'fatG', // Lipides
  '40302': 'satFatG', // AG saturés
  '34100': 'fiberG', // Fibres alimentaires
  '10004': 'saltG', // Sel chlorure de sodium
  '60000': 'alcoholG', // Alcool
};
const KJ_CODE = '327';
/** Énergie « N x facteur de Jones, avec fibres » : repli si l'énergie réglementaire manque. */
const KCAL_JONES_CODE = '333';
const KJ_JONES_CODE = '332';
const PROTEIN_625_CODE = '25003';


export const CIQUAL_FALLBACK_URLS = [
  'https://ciqual.anses.fr/cms/sites/default/files/inline-files/XML_2020_07_07.zip',
];
export const CIQUAL_DATASET_API = 'https://www.data.gouv.fr/api/1/datasets/table-de-composition-nutritionnelle-des-aliments-ciqual/';

/** Décode un fichier XML selon l'encodage de sa déclaration (Ciqual : windows-1252). */
export function decodeXml(bytes: Uint8Array): string {
  const head = new TextDecoder('ascii').decode(bytes.subarray(0, 200));
  const enc = /encoding=["']([\w-]+)["']/i.exec(head)?.[1] ?? 'utf-8';
  try {
    return new TextDecoder(enc.toLowerCase()).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

function* records(xml: string, tag: string): Generator<Record<string, string>> {
  const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'gi');
  const field = /<([A-Za-z_]\w*)>([\s\S]*?)<\/\1>/g;
  for (let m = re.exec(xml); m; m = re.exec(xml)) {
    const rec: Record<string, string> = {};
    for (let f = field.exec(m[1]!); f; f = field.exec(m[1]!)) rec[f[1]!.toLowerCase()] = f[2]!.trim();
    field.lastIndex = 0;
    yield rec;
  }
}

/** « 12,5 » → 12.5 ; « traces » → 0 (drapeau) ; « < 0,5 » → 0 (drapeau) ; « - » → inconnu. */
export function parseTeneur(raw: string | undefined): { value: number | null; flag?: string } {
  const s = (raw ?? '').trim();
  if (!s || s === '-') return { value: null };
  if (/^traces?$/i.test(s)) return { value: 0, flag: 'traces' };
  if (s.startsWith('<')) return { value: 0, flag: s.replace(/\s+/g, ' ') };
  const n = Number(s.replace(',', '.').replace(/\s/g, ''));
  return Number.isFinite(n) ? { value: n } : { value: null };
}

export function guessState(name: string): ExternalFood['state'] {
  const n = name.toLowerCase();
  if (/\b(cru|crue|crus|crues)\b/.test(n)) return 'raw';
  if (/\b(cuit|cuite|cuits|cuites|bouilli|bouillie|frit|frite|rôti|rôtie|grillé|grillée|poêlé|poêlée|à la vapeur|braisé|braisée)\b/.test(n)) return 'cooked';
  return 'na';
}

export function parseCiqualXml(files: { alim: string; compo: string; groups?: string }): CiqualFood[] {
  const groups = new Map<string, string>();
  if (files.groups) {
    for (const g of records(files.groups, 'ALIM_GRP')) {
      if (g.alim_ssgrp_code && g.alim_ssgrp_nom_fr) groups.set(g.alim_ssgrp_code, g.alim_ssgrp_nom_fr);
      if (g.alim_grp_code && g.alim_grp_nom_fr && !groups.has(`g${g.alim_grp_code}`)) groups.set(`g${g.alim_grp_code}`, g.alim_grp_nom_fr);
    }
  }
  const foods = new Map<string, CiqualFood>();
  for (const a of records(files.alim, 'ALIM')) {
    const code = a.alim_code;
    const name = a.alim_nom_fr;
    if (!code || !name) continue;
    foods.set(code, {
      sourceRef: code,
      name,
      category: groups.get(a.alim_ssgrp_code ?? '') ?? groups.get(`g${a.alim_grp_code ?? ''}`) ?? null,
      state: guessState(name),
      kcal: null,
      proteinG: null,
      carbsG: null,
      sugarsG: null,
      fatG: null,
      satFatG: null,
      fiberG: null,
      saltG: null,
      alcoholG: null,
    });
  }
  const kj = new Map<string, number>();
  const kcalJones = new Map<string, number>();
  const kjJones = new Map<string, number>();
  const protein625 = new Map<string, number>();
  for (const c of records(files.compo, 'COMPO')) {
    const food = foods.get(c.alim_code ?? '');
    if (!food) continue;
    const code = c.const_code ?? '';
    const { value, flag } = parseTeneur(c.teneur);
    if (code === KJ_CODE && value != null) kj.set(food.sourceRef, value);
    if (code === KCAL_JONES_CODE && value != null) kcalJones.set(food.sourceRef, value);
    if (code === KJ_JONES_CODE && value != null) kjJones.set(food.sourceRef, value);
    if (code === PROTEIN_625_CODE && value != null) protein625.set(food.sourceRef, value);
    const key = CIQUAL_CONSTITUENTS[code];
    if (!key) continue;
    (food as unknown as Record<string, unknown>)[key] = value;
    if (flag) food.flags = { ...food.flags, [key]: flag };
  }
  for (const f of foods.values()) {
    const ref = f.sourceRef;
    if (f.proteinG == null && protein625.has(ref)) f.proteinG = protein625.get(ref)!;
    if (f.kcal != null) continue;
    // Énergie absente de la table : autre code d'énergie, sinon calcul par les macros.
    const fallback = kj.has(ref) ? Math.round(kj.get(ref)! / 4.184) : kcalJones.get(ref) ?? (kjJones.has(ref) ? Math.round(kjJones.get(ref)! / 4.184) : null);
    if (fallback != null) {
      f.kcal = fallback;
    } else {
      f.kcal = energyFromMacros(f);
      if (f.kcal != null) f.flags = { ...f.flags, kcal: ENERGY_COMPUTED_FLAG };
    }
  }
  return [...foods.values()];
}

/** Extrait et lit les XML d'une archive Ciqual. */
export function parseCiqualZip(zip: Uint8Array): { foods: CiqualFood[]; version: string } {
  const files = unzipSync(zip, { filter: (f) => /\.xml$/i.test(f.name) });
  const find = (re: RegExp) => Object.keys(files).find((n) => re.test(n.split('/').pop()!));
  const alim = find(/^alim_(?!grp)[^/]*\.xml$/i);
  const compo = find(/^compo_[^/]*\.xml$/i);
  const grp = find(/^alim_grp_[^/]*\.xml$/i);
  if (!alim || !compo) throw new DomainError("Archive Ciqual non reconnue : fichiers alim_*.xml et compo_*.xml introuvables.");
  const version = /(\d{4}_\d{2}_\d{2})/.exec(alim)?.[1]?.replaceAll('_', '-') ?? 'inconnue';
  return {
    version: `Ciqual ${version}`,
    foods: parseCiqualXml({ alim: decodeXml(files[alim]!), compo: decodeXml(files[compo]!), groups: grp ? decodeXml(files[grp]!) : undefined }),
  };
}

/** Rétrocompatibilité : ancien nom du format compact. */
export type CiqualPack = FoodPack;
export const packCiqual = (foods: CiqualFood[], version: string) => packFoods(foods, version, 'ciqual');
export const unpackCiqual = unpackFoods;

export async function importCiqual(db: Db, foods: CiqualFood[], version: string) {
  if (foods.length < 100) throw new DomainError(`Import Ciqual interrompu : seulement ${foods.length} aliments lus.`);
  return upsertExternalFoods(db, 'ciqual', foods as unknown as Parameters<typeof upsertExternalFoods>[2], version);
}

export async function ciqualStatus(db: Db): Promise<{ count: number; version: string | null }> {
  const count = (await countFoodsBySource(db)).ciqual ?? 0;
  const v = (await db.select<{ v: string | null }>("SELECT max(source_version) AS v FROM food WHERE source = 'ciqual'"))[0]?.v ?? null;
  return { count, version: v };
}

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

/** URL de l'archive XML la plus récente (API data.gouv.fr), puis adresses connues en secours. */
export async function findCiqualZipUrls(fetchFn: FetchFn): Promise<string[]> {
  const urls: string[] = [];
  try {
    const res = await fetchFn(CIQUAL_DATASET_API);
    if (res.ok) {
      const data = (await res.json()) as { resources?: { url: string; title?: string; format?: string; last_modified?: string }[] };
      const xml = (data.resources ?? [])
        .filter((r) => /xml/i.test(`${r.title} ${r.format} ${r.url}`) && /\.zip($|\?)/i.test(r.url))
        .sort((a, b) => (b.last_modified ?? '').localeCompare(a.last_modified ?? ''));
      urls.push(...xml.map((r) => r.url));
    }
  } catch {
    /* API indisponible : adresses connues */
  }
  return [...new Set([...urls, ...CIQUAL_FALLBACK_URLS])];
}

/** Télécharge la dernière version de Ciqual et l'importe. */
export async function downloadAndImportCiqual(db: Db, fetchFn: FetchFn, onProgress?: (msg: string) => void) {
  const errors: string[] = [];
  for (const url of await findCiqualZipUrls(fetchFn)) {
    try {
      onProgress?.(`Téléchargement de ${url}…`);
      const res = await fetchFn(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const zip = new Uint8Array(await res.arrayBuffer());
      onProgress?.('Lecture des fichiers…');
      const { foods, version } = parseCiqualZip(zip);
      onProgress?.(`Import de ${foods.length} aliments…`);
      return { version, ...(await importCiqual(db, foods, version)) };
    } catch (err) {
      errors.push(`${url} : ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  throw new DomainError(`Téléchargement de Ciqual impossible. ${errors.join(' | ')}`);
}
