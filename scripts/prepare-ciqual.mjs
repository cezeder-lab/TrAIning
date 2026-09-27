// Télécharge la table Ciqual (ANSES) et produit la ressource compacte embarquée dans l'installeur :
//   apps/desktop/src-tauri/resources/ciqual.json.gz
// Usage : node scripts/prepare-ciqual.mjs [--zip chemin.zip] [--strict]
// Sans --strict, un échec de téléchargement n'interrompt pas la compilation : l'application
// proposera alors de télécharger Ciqual au premier lancement.
import { readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { findCiqualZipUrls, packCiqual, parseCiqualZip } from '../packages/core/src/services/ciqual.ts';

const args = process.argv.slice(2);
const strict = args.includes('--strict');
const zipArg = args.includes('--zip') ? args[args.indexOf('--zip') + 1] : null;
const out = new URL('../apps/desktop/src-tauri/resources/ciqual.json.gz', import.meta.url);

async function getZip() {
  if (zipArg) return new Uint8Array(readFileSync(zipArg));
  const errors = [];
  for (const url of await findCiqualZipUrls(fetch)) {
    try {
      console.log(`Téléchargement : ${url}`);
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return new Uint8Array(await res.arrayBuffer());
    } catch (err) {
      errors.push(`${url} : ${err.message}`);
    }
  }
  throw new Error(errors.join(' | '));
}

try {
  const { foods, version } = parseCiqualZip(await getZip());
  if (foods.length < 1000) throw new Error(`seulement ${foods.length} aliments lus`);
  const json = JSON.stringify(packCiqual(foods, version));
  writeFileSync(out, gzipSync(json, { level: 9 }));
  console.log(`${version} : ${foods.length} aliments → ${out.pathname} (${Math.round(json.length / 1024)} Ko avant compression)`);
} catch (err) {
  console.warn(`⚠ Ciqual non préparé : ${err.message}`);
  if (strict) process.exit(1);
}
