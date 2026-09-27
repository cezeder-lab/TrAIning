import type { Db, SqlParam } from './driver.ts';

export const nowIso = (): string => new Date().toISOString();

/** Date locale au format YYYY-MM-DD. */
export function localDate(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Minuscules, sans accents, espaces normalisés (recherche et dédoublonnage). */
export function normalizeText(s: string): string {
  return s
    .replace(/œ/gi, 'oe')
    .replace(/æ/gi, 'ae')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export const bool = (v: unknown): boolean => v === 1 || v === true;

/**
 * UPDATE partiel : seules les clés présentes dans `patch` et connues de `columns`
 * (camelCase → snake_case) sont écrites. Retourne le nombre de lignes modifiées.
 */
export async function updateColumns(
  db: Db,
  table: string,
  id: string,
  patch: Record<string, unknown>,
  columns: Record<string, string>,
  touchUpdatedAt = true,
): Promise<number> {
  const sets: string[] = [];
  const params: SqlParam[] = [];
  for (const [key, col] of Object.entries(columns)) {
    if (key in patch && patch[key] !== undefined) {
      sets.push(`${col} = ?`);
      params.push(patch[key] as SqlParam);
    }
  }
  if (touchUpdatedAt) {
    sets.push('updated_at = ?');
    params.push(nowIso());
  }
  if (sets.length === 0) return 0;
  params.push(id);
  const r = await db.execute(`UPDATE ${table} SET ${sets.join(', ')} WHERE id = ?`, params);
  return r.changes;
}

/** Réécrit la colonne `sort` (0..n-1) selon l'ordre donné, restreint à un parent. */
export async function rewriteSort(
  db: Db,
  table: string,
  parentColumn: string,
  parentId: string,
  orderedIds: string[],
): Promise<void> {
  await db.transaction(async (tx) => {
    const rows = await tx.select<{ id: string }>(
      `SELECT id FROM ${table} WHERE ${parentColumn} = ?`,
      [parentId],
    );
    const existing = new Set(rows.map((r) => r.id));
    if (existing.size !== orderedIds.length || !orderedIds.every((id) => existing.has(id))) {
      throw new DomainError("L'ordre fourni ne correspond pas aux éléments existants.");
    }
    for (const [i, id] of orderedIds.entries()) {
      await tx.execute(`UPDATE ${table} SET sort = ? WHERE id = ?`, [i, id]);
    }
  });
}

/** Erreur métier avec message en français, affichable tel quel. */
export class DomainError extends Error {
  override name = 'DomainError';
}
