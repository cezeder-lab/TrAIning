import { normalizeText } from '../db/util.ts';

/**
 * Synonymes de recherche : un mot saisi est aussi cherché sous ses variantes
 * (orthographe canadienne du FCÉN, noms courants vs noms de table).
 * Clés et valeurs normalisées (minuscules, sans accents).
 */
const GROUPS: string[][] = [
  ['yaourt', 'yogourt', 'yoghourt', 'yogurt'],
  ['grec', 'grecque'],
  ['oeuf', 'oeufs'],
  ['steak hache', 'boeuf hache'],
  ['cacahuete', 'arachide'],
  ['beurre de cacahuete', 'beurre d arachide'],
  ['haricots verts', 'haricot vert'],
  ['jambon blanc', 'jambon cuit'],
];

/** Noms courants → nom de table (sens unique : « riz » ne doit pas devenir « riz basmati »). */
const ALIASES: [string, string][] = [
  ['pdt', 'pomme de terre'],
  ['patate', 'pomme de terre'],
  ['frites', 'pomme de terre frite'],
  ['blanc de poulet', 'poulet filet'],
  ['escalope de poulet', 'poulet filet'],
  ['escalope de dinde', 'dinde filet'],
  ['fromage blanc', 'fromage frais'],
  ['compote', 'puree de pomme'],
  ['flocons d avoine', 'avoine'],
  ['porridge', 'avoine'],
  ['pates', 'pate alimentaire'],
  ['spaghetti', 'pate alimentaire'],
  ['riz basmati', 'riz'],
  ['thon au naturel', 'thon'],
  ['whey', 'lactoserum'],
];

const MAP = new Map<string, string[]>();
const add = (from: string, to: string) => MAP.set(from, [...new Set([...(MAP.get(from) ?? []), to])]);
for (const g of GROUPS) {
  const n = g.map(normalizeText);
  for (const k of n) for (const x of n) if (x !== k) add(k, x);
}
for (const [from, to] of ALIASES) add(normalizeText(from), normalizeText(to));

/** Variantes de la requête (la requête elle-même en premier), au plus quelques-unes. */
export function expandQuery(query: string): string[] {
  const q = normalizeText(query);
  const out = new Set<string>([q]);
  for (const [k, alts] of MAP) {
    const re = new RegExp(`(^| )${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( |$)`);
    if (!re.test(q)) continue;
    for (const a of alts) out.add(q.replace(re, `$1${a}$2`).trim());
  }
  return [...out].slice(0, 6);
}
