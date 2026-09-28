// Télécharge les tables de référence et produit les ressources compactes embarquées dans l'installeur :
//   apps/desktop/src-tauri/resources/ciqual.json.gz  (Ciqual, ANSES — Licence Ouverte Etalab)
//   apps/desktop/src-tauri/resources/cnf.json.gz     (Fichier canadien sur les éléments nutritifs — Licence du gouvernement ouvert – Canada)
// Usage : node scripts/prepare-food-data.mjs [--ciqual-zip f.zip] [--cnf-zip f.zip] [--strict]
// Sans --strict, un échec de téléchargement n'interrompt pas la compilation : l'application
// proposera alors le téléchargement depuis Nutrition → Aliments & recettes.
import { readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { findCiqualZipUrls, parseCiqualZip } from '../packages/core/src/services/ciqual.ts';
import { findCnfZipUrls, parseCnfZip } from '../packages/core/src/services/cnf.ts';
import { packFoods } from '../packages/core/src/services/foodPack.ts';

const args = process.argv.slice(2);
const strict = args.includes('--strict');
const arg = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const out = (name) => new URL(`../apps/desktop/src-tauri/resources/${name}`, import.meta.url);

async function download(candidates) {
  const errors = [];
  for (const { url, hint } of candidates) {
    try {
      console.log(`Téléchargement : ${url}`);
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return { bytes: new Uint8Array(await res.arrayBuffer()), hint };
    } catch (err) {
      errors.push(`${url} : ${err.message}`);
    }
  }
  throw new Error(errors.join(' | '));
}

async function prepare(label, file, source, getZip, parse) {
  try {
    const { bytes, hint } = await getZip();
    const { foods, version } = parse(bytes, hint);
    if (foods.length < 1000) throw new Error(`seulement ${foods.length} aliments lus`);
    const noEnergy = foods.filter((f) => f.kcal == null).length;
    const computed = foods.filter((f) => f.flags?.kcal).length;
    writeFileSync(out(file), gzipSync(JSON.stringify(packFoods(foods, version, source)), { level: 9 }));
    console.log(`✓ ${version} : ${foods.length} aliments (énergie calculée pour ${computed}, inconnue pour ${noEnergy}) → ${file}`);
  } catch (err) {
    console.warn(`⚠ ${label} non préparé : ${err.message}`);
    if (strict) process.exitCode = 1;
  }
}

await prepare(
  'Ciqual',
  'ciqual.json.gz',
  'ciqual',
  async () =>
    arg('--ciqual-zip')
      ? { bytes: new Uint8Array(readFileSync(arg('--ciqual-zip'))) }
      : download((await findCiqualZipUrls(fetch)).map((url) => ({ url }))),
  (bytes) => parseCiqualZip(bytes),
);

await prepare(
  'Fichier canadien (FCÉN)',
  'cnf.json.gz',
  'cnf',
  async () =>
    arg('--cnf-zip')
      ? { bytes: new Uint8Array(readFileSync(arg('--cnf-zip'))) }
      : download((await findCnfZipUrls(fetch)).map((c) => ({ url: c.url, hint: c.year ?? undefined }))),
  (bytes, hint) => parseCnfZip(bytes, hint),
);
