// Diagnostic temporaire : inspecte les fichiers réels de Ciqual et du Fichier canadien (FCÉN).
import { createRequire } from 'node:module';
const { unzipSync } = createRequire(new URL('../packages/core/package.json', import.meta.url))('fflate');
import { decodeXml, findCiqualZipUrls } from '../packages/core/src/services/ciqual.ts';

const log = (...a) => console.log(...a);
const recs = (xml, tag) => [...xml.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'gi'))].map((m) => Object.fromEntries([...m[1].matchAll(/<([A-Za-z_]\w*)>([\s\S]*?)<\/\1>/g)].map((f) => [f[1].toLowerCase(), f[2].trim()])));

log('===== CIQUAL =====');
for (const url of await findCiqualZipUrls(fetch)) log('url candidate', url);
const url = (await findCiqualZipUrls(fetch))[0];
const zip = unzipSync(new Uint8Array(await (await fetch(url)).arrayBuffer()));
log('fichiers', Object.keys(zip));
const pick = (re) => decodeXml(zip[Object.keys(zip).find((n) => re.test(n.split('/').pop()))]);
const consts = recs(pick(/^const_/i), 'CONST');
log('constituants énergie/macros :');
for (const c of consts) if (/energ|prot|gluc|lipid|sucre|fibre|sel|alcool/i.test(c.const_nom_fr ?? '')) log(' ', c.const_code, '|', c.const_nom_fr);
const alims = recs(pick(/^alim_(?!grp)/i), 'ALIM');
const compo = recs(pick(/^compo_/i), 'COMPO');
const by = new Map();
for (const c of compo) {
  if (!by.has(c.alim_code)) by.set(c.alim_code, {});
  by.get(c.alim_code)[c.const_code] = c.teneur;
}
const E = ['327', '328', '332', '333'];
let miss328 = 0, fromOther = 0, fromNothing = 0;
for (const a of alims) {
  const v = by.get(a.alim_code) ?? {};
  const has = (k) => v[k] && v[k] !== '-';
  if (!has('328')) {
    miss328++;
    if (E.some(has)) fromOther++;
    else fromNothing++;
  }
}
log(`aliments ${alims.length} ; 328 manquant ${miss328} ; dont autre code énergie dispo ${fromOther} ; aucun code énergie ${fromNothing}`);
for (const a of alims.filter((x) => /grec|skyr|fromage blanc/i.test(x.alim_nom_fr)).slice(0, 25)) {
  const v = by.get(a.alim_code) ?? {};
  log(' ', a.alim_code, a.alim_nom_fr, '|', E.map((k) => `${k}=${v[k]}`).join(' '), '| P', v['25000'], 'G', v['31000'], 'L', v['40000'], 'fib', v['34100']);
}
log('exemples sans 328 :');
for (const a of alims.filter((x) => { const v = by.get(x.alim_code) ?? {}; return !v['328'] || v['328'] === '-'; }).slice(0, 15)) {
  const v = by.get(a.alim_code) ?? {};
  log(' ', a.alim_code, a.alim_nom_fr, '|', E.map((k) => `${k}=${v[k]}`).join(' '), '| P', v['25000'], 'G', v['31000'], 'L', v['40000']);
}

log('===== FCÉN (Canada) =====');
try {
  const r = await fetch('https://open.canada.ca/data/api/action/package_search?q=%22Canadian%20Nutrient%20File%22&rows=10');
  const d = await r.json();
  for (const p of d.result.results) {
    log('paquet', p.name, '|', p.title?.en ?? p.title);
    for (const res of p.resources ?? []) log('   ', res.format, '|', res.name?.en ?? res.name, '|', res.url);
  }
} catch (e) {
  log('CKAN erreur', e.message);
}
for (const u of [
  'https://www.canada.ca/content/dam/hc-sc/migration/hc-sc/fn-an/alt_formats/zip/nutrition/fiche-nutri-data/cnf-fcen-csv.zip',
  'https://www.canada.ca/content/dam/hc-sc/migration/hc-sc/fn-an/alt_formats/zip/nutrition/fiche-nutri-data/cnf-fcen-csv-eng.zip',
]) {
  try {
    const r = await fetch(u);
    log('essai', u, r.status, r.headers.get('content-type'));
    if (!r.ok) continue;
    const z = unzipSync(new Uint8Array(await r.arrayBuffer()));
    for (const [name, bytes] of Object.entries(z)) {
      const t = new TextDecoder('latin1').decode(bytes.subarray(0, 600));
      log('--', name, bytes.length, 'octets\n', t.split(/\r?\n/).slice(0, 3).join('\n'));
    }
    const food = Object.keys(z).find((n) => /food name/i.test(n));
    if (food) {
      const txt = new TextDecoder('latin1').decode(z[food]);
      for (const l of txt.split(/\r?\n/).filter((l) => /grec|greek/i.test(l)).slice(0, 10)) log('  >', l);
    }
    break;
  } catch (e) {
    log('erreur', u, e.message);
  }
}
