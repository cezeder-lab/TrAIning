import { ciqualStatus, downloadAndImportCiqual, importCiqual, parseCiqualZip, unpackCiqual, type CiqualPack } from '@training/core';
import type { Platform } from './platform.ts';

async function gunzip(bytes: Uint8Array): Promise<string> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}

/** Importe la table Ciqual embarquée dans l'installeur ; false si la ressource est absente. */
export async function importBundledCiqual(platform: Platform): Promise<{ version: string; count: number } | false> {
  const bytes = await platform.readResource('ciqual.json.gz');
  if (!bytes) return false;
  const pack = JSON.parse(await gunzip(bytes)) as CiqualPack;
  const foods = unpackCiqual(pack);
  await importCiqual(platform.db, foods, pack.version);
  return { version: pack.version, count: foods.length };
}

let ensuring: Promise<string | null> | null = null;
let announced = false;

/** Message à afficher une seule fois (le composant peut être monté deux fois en développement). */
export function takeAnnouncement(msg: string | null): string | null {
  if (!msg || announced) return null;
  announced = true;
  return msg;
}

/** Premier lancement : installe Ciqual depuis l'installeur si la base n'en contient pas encore. */
export function ensureCiqual(platform: Platform): Promise<string | null> {
  ensuring ??= doEnsure(platform).finally(() => (ensuring = null));
  return ensuring;
}

async function doEnsure(platform: Platform): Promise<string | null> {
  const status = await ciqualStatus(platform.db);
  if (status.count > 0) return null;
  const r = await importBundledCiqual(platform);
  return r ? `Base Ciqual installée (${r.count} aliments, ${r.version}).` : null;
}

export async function updateCiqualOnline(platform: Platform, onProgress: (m: string) => void) {
  return downloadAndImportCiqual(platform.db, (url, init) => platform.httpFetch(url, init), onProgress);
}

export async function importCiqualZipFile(platform: Platform, path: string) {
  const { foods, version } = parseCiqualZip(await platform.readBinaryFile(path));
  return { version, ...(await importCiqual(platform.db, foods, version)) };
}
