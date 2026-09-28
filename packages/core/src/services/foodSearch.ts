import type { Db } from '../db/driver.ts';
import { normalizeText } from '../db/util.ts';
import { loadPortions, mapFood } from '../repos/foods.ts';
import { expandQuery } from './foodSynonyms.ts';
import type { Food, FoodSource } from '../types.ts';

type R = Record<string, any>;

/** Distance de Damerau-Levenshtein (transpositions adjacentes comprises). */
export function editDistance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0]![j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i]![j] = Math.min(d[i]![j]!, d[i - 2]![j - 2]! + 1);
    }
  }
  return d[a.length]![b.length]!;
}

/** Similarité 0-1 entre un mot saisi et un mot du nom (préfixe, inclusion ou faute de frappe). */
function tokenSimilarity(token: string, word: string): number {
  if (word.startsWith(token)) return 1;
  if (word.includes(token)) return 0.9;
  if (token.length < 3) return 0;
  const prefix = word.slice(0, token.length);
  const best = Math.min(editDistance(token, prefix), editDistance(token, word));
  const sim = 1 - best / Math.max(token.length, 1);
  return sim >= 0.6 ? sim * 0.85 : 0;
}

/** Mots de liaison ignorés (« poitrine de poulet » ≈ « poulet, poitrine »). */
const STOP_WORDS = new Set(['de', 'du', 'des', 'd', 'la', 'le', 'les', 'l', 'a', 'au', 'aux', 'et', 'en', 'un', 'une']);

/** Score textuel 0-1 d'un nom pour une requête (chaque mot saisi doit trouver un écho). */
export function textScore(query: string, name: string): number {
  const all = normalizeText(query).split(/[\s']+/).filter(Boolean);
  const meaningful = all.filter((t) => !STOP_WORDS.has(t));
  const tokens = meaningful.length ? meaningful : all;
  const words = normalizeText(name).split(/[\s,;()'/-]+/).filter(Boolean);
  if (!tokens.length || !words.length) return 0;
  let sum = 0;
  for (const t of tokens) {
    let best = 0;
    for (const w of words) best = Math.max(best, tokenSimilarity(t, w));
    if (best === 0) return 0;
    sum += best;
  }
  let score = sum / tokens.length;
  if (normalizeText(name).startsWith(tokens.join(' '))) score += 0.08;
  return score - Math.min(words.length, 20) * 0.004;
}

export type SearchBadge = 'recent' | 'favorite' | FoodSource;

export interface FoodSearchResult {
  food: Food;
  score: number;
  badge: SearchBadge;
}

const RECENT_DAYS = 60;

/** Priorité : récents > favoris > base perso / recettes > Ciqual > FCÉN > Open Food Facts. */
function boost(r: R): { boost: number; badge: SearchBadge } {
  const recent = r.last_used_at && Date.now() - Date.parse(r.last_used_at) < RECENT_DAYS * 86_400_000;
  if (recent) return { boost: 0.3, badge: 'recent' };
  if (r.is_favorite) return { boost: 0.25, badge: 'favorite' };
  if (r.source === 'custom' || r.source === 'recipe') return { boost: 0.15, badge: r.source };
  if (r.source === 'ciqual') return { boost: 0.05, badge: 'ciqual' };
  if (r.source === 'cnf') return { boost: 0.04, badge: 'cnf' };
  return { boost: 0, badge: r.source };
}

function trigramQuery(query: string): string | null {
  const grams = new Set<string>();
  for (const t of normalizeText(query).split(' ')) {
    for (let i = 0; i + 3 <= t.length; i++) grams.add(t.slice(i, i + 3));
  }
  if (!grams.size) return null;
  return [...grams].map((g) => `"${g.replaceAll('"', '""')}"`).join(' OR ');
}

/** Recherche locale floue (toutes sources déjà en base). */
export async function searchFoods(
  db: Db,
  query: string,
  opts: { limit?: number; sources?: FoodSource[] } = {},
): Promise<FoodSearchResult[]> {
  const q = normalizeText(query);
  if (!q) return [];
  const sourceFilter = opts.sources?.length ? `AND f.source IN (${opts.sources.map(() => '?').join(',')})` : '';
  // La requête et ses synonymes (« yaourt grec » → « yogourt grecque »…).
  const variants = expandQuery(q);
  const byId = new Map<string, R>();
  for (const v of variants) {
    const fts = trigramQuery(v);
    const rows = fts
      ? await db.select<R>(
          `SELECT f.* FROM food_fts JOIN food f ON f.num = food_fts.rowid
            WHERE food_fts MATCH ? AND f.is_archived = 0 ${sourceFilter}
            ORDER BY bm25(food_fts) LIMIT 600`,
          [fts, ...(opts.sources ?? [])],
        )
      : await db.select<R>(
          `SELECT f.* FROM food f WHERE f.name_norm LIKE ? AND f.is_archived = 0 ${sourceFilter} LIMIT 300`,
          [`%${v}%`, ...(opts.sources ?? [])],
        );
    for (const r of rows) byId.set(r.id, r);
  }
  const scored = [...byId.values()]
    .map((r) => {
      // Nom (et marque), sinon mots-clés de la source (un peu moins bien classés).
      const text = Math.max(
        ...variants.map((v) => Math.max(textScore(v, `${r.name} ${r.brand ?? ''}`), r.aliases ? textScore(v, r.aliases) * 0.9 : 0)),
      );
      const b = boost(r);
      // Un aliment sans énergie connue est relégué (il reste trouvable).
      const penalty = r.kcal == null ? 0.2 : 0;
      return { r, text, score: text + b.boost - penalty, badge: b.badge };
    })
    .filter((x) => x.text >= 0.5)
    .sort((a, b) => b.score - a.score || a.r.name.length - b.r.name.length)
    .slice(0, opts.limit ?? 20);
  const portions = await loadPortions(db, scored.map((x) => x.r.id));
  return scored.map((x) => ({ food: mapFood(x.r, portions.get(x.r.id) ?? []), score: Math.round(x.score * 100) / 100, badge: x.badge }));
}

/** Aliments récemment utilisés (liste de départ quand la recherche est vide). */
export async function recentFoods(db: Db, limit = 12): Promise<Food[]> {
  const rows = await db.select<R>('SELECT * FROM food WHERE last_used_at IS NOT NULL AND is_archived = 0 ORDER BY last_used_at DESC LIMIT ?', [limit]);
  const portions = await loadPortions(db, rows.map((r) => r.id));
  return rows.map((r) => mapFood(r, portions.get(r.id) ?? []));
}
