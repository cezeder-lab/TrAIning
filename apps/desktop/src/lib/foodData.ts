import {
  applyDefaultPortions,
  downloadAndImportCiqual,
  downloadAndImportCnf,
  getSettings,
  importCiqual,
  importCnf,
  parseCiqualZip,
  parseCnfZip,
  recomputeEntriesMissingEnergy,
  setSetting,
  unpackFoods,
  type FoodPack,
} from '@training/core';
import type { Platform } from './platform.ts';

/**
 * Tables de référence embarquées dans l'installeur (Ciqual, FCÉN). Elles sont (ré)importées quand
 * leur version ou la révision d'import change : les identifiants des aliments restent stables.
 */
const IMPORT_REVISION = 2; // 2 : énergie calculée quand Ciqual ne la donne pas, portions usuelles
const SOURCES = [
  { source: 'ciqual', file: 'ciqual.json.gz', label: 'Ciqual', importer: importCiqual },
  { source: 'cnf', file: 'cnf.json.gz', label: 'Fichier canadien', importer: importCnf },
] as const;

async function gunzip(bytes: Uint8Array): Promise<string> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}

/** Après tout import : portions usuelles et correction des entrées enregistrées à 0 kcal. */
async function afterImport(platform: Platform): Promise<number> {
  await applyDefaultPortions(platform.db, ['ciqual', 'cnf']);
  return recomputeEntriesMissingEnergy(platform.db);
}

async function syncBundled(platform: Platform, force = false): Promise<string[]> {
  const settings = await getSettings(platform.db);
  const done: Record<string, string> = { ...settings.foodDataVersions };
  const messages: string[] = [];
  let changed = false;
  for (const s of SOURCES) {
    const bytes = await platform.readResource(s.file);
    if (!bytes) continue;
    const pack = JSON.parse(await gunzip(bytes)) as FoodPack;
    const key = `${pack.version}#r${IMPORT_REVISION}`;
    if (!force && done[s.source] === key) continue;
    const foods = unpackFoods(pack);
    await s.importer(platform.db, foods, pack.version);
    done[s.source] = key;
    changed = true;
    messages.push(`${s.label} : ${foods.length} aliments (${pack.version})`);
  }
  if (!changed) return [];
  const fixed = await afterImport(platform);
  await setSetting(platform.db, 'foodDataVersions', done);
  if (fixed) messages.push(`${fixed} entrée(s) du journal recalculée(s) (énergie manquante)`);
  return messages;
}

let syncing: Promise<string[]> | null = null;
let announced = false;

/** Au lancement : installe ou met à jour les tables embarquées si besoin. */
export function ensureBundledFoodData(platform: Platform): Promise<string[]> {
  syncing ??= syncBundled(platform).finally(() => (syncing = null));
  return syncing;
}

/** Message à afficher une seule fois (le composant peut être monté deux fois en développement). */
export function takeAnnouncement(messages: string[]): string | null {
  if (!messages.length || announced) return null;
  announced = true;
  return `Bases alimentaires mises à jour — ${messages.join(' ; ')}.`;
}

export async function reinstallBundled(platform: Platform) {
  return syncBundled(platform, true);
}

export async function updateOnline(platform: Platform, source: 'ciqual' | 'cnf', onProgress: (m: string) => void) {
  const fetchFn = (url: string, init?: RequestInit) => platform.httpFetch(url, init);
  const r = source === 'ciqual' ? await downloadAndImportCiqual(platform.db, fetchFn, onProgress) : await downloadAndImportCnf(platform.db, fetchFn, onProgress);
  await afterImport(platform);
  return r;
}

/** Archive choisie par l'utilisateur : Ciqual (XML) ou FCÉN (CSV), détectée automatiquement. */
export async function importZipFile(platform: Platform, path: string) {
  const bytes = await platform.readBinaryFile(path);
  let r;
  try {
    const { foods, version } = parseCiqualZip(bytes);
    r = { version, ...(await importCiqual(platform.db, foods, version)) };
  } catch {
    const { foods, version } = parseCnfZip(bytes);
    r = { version, ...(await importCnf(platform.db, foods, version)) };
  }
  await afterImport(platform);
  return r;
}
