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
for (const a of alims.filter((x) => /grec|skyr/i.test(x.alim_nom_fr)).slice(0, 12)) {
  const v = by.get(a.alim_code) ?? {};
  log(' ', a.alim_code, a.alim_nom_fr, '|', E.map((k) => `${k}=${v[k]}`).join(' '), '| P', v['25000'], 'G', v['31000'], 'L', v['40000'], 'fib', v['34100']);
}
log('===== FCÉN 2026 =====');
const base = 'https://open.canada.ca';
const pkg = (await (await fetch(`${base}/data/api/action/package_show?id=1b6139bd-ed7e-4043-bc28-ff00e10f3109`)).json()).result;
log('licence', pkg.license_id, pkg.license_title, '| modifié', pkg.metadata_modified);
const all = pkg.resources.find((r) => /all-files/i.test(r.url));
const zurl = all.url.startsWith('http') ? all.url : base + all.url;
log('zip', zurl);
const z2 = unzipSync(new Uint8Array(await (await fetch(zurl)).arrayBuffer()));
for (const [name, bytes] of Object.entries(z2)) {
  const head = bytes.subarray(0, 700);
  let enc = 'utf-8';
  try { new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { enc = 'latin1'; }
  log('--', name, bytes.length, 'octets', enc, bytes[0] === 0xef ? 'BOM' : '');
  log(new TextDecoder(enc).decode(head).split(/\r?\n/).slice(0, 3).join('\n'));
}
const find = (re) => Object.keys(z2).find((n) => re.test(n));
const txt = (re) => { const b = z2[find(re)]; try { return new TextDecoder('utf-8', { fatal: true }).decode(b); } catch { return new TextDecoder('latin1').decode(b); } };
const nn = txt(/nutrient_name/i).split(/\r?\n/);
log('nutriments clés :');
for (const l of nn) if (/^(203|204|205|208|268|269|291|606|307|221|\w*),/.test(l) && /(PROT|FAT|CARB|KCAL|KJ|SUG|FIB|FASAT|NA|ALC|ENERG)/i.test(l)) log('  ', l);
const foods = txt(/food_name/i).split(/\r?\n/);
const greek = foods.filter((l) => /greek/i.test(l)).slice(0, 4);
log('yogourts grecs :', greek);
const ids = greek.map((l) => l.split(',')[0]);
const amounts = txt(/nutrient_amount/i).split(/\r?\n/);
log('entête montants :', amounts[0]);
for (const id of ids.slice(0, 2)) log('  valeurs', id, amounts.filter((l) => l.startsWith(id + ',')).filter((l) => /,(203|204|205|208|291|269),/.test(l)).join(' | '));
const conv = txt(/measure_weight|conversion/i).split(/\r?\n/);
log('entête mesures :', conv[0]);
log('  mesures', ids[0], conv.filter((l) => l.startsWith(ids[0] + ',')).slice(0, 6).join(' | '));
const mn = txt(/measure_name/i).split(/\r?\n/);
log('  noms de mesures (extrait) :', mn.slice(0, 6).join(' | '));
log('nb aliments', foods.length - 1);
