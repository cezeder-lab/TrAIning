/**
 * Interface minimale d'accès à SQLite, implémentée par un driver par environnement :
 * Tauri (app), node:sqlite (serveur MCP, tests), HTTP (mode navigateur de développement).
 * Toute la logique métier de @training/core est écrite contre cette interface.
 */

export type SqlValue = string | number | null;
export type SqlParam = SqlValue | boolean | undefined;
export type Row = Record<string, SqlValue>;

export interface ExecuteResult {
  changes: number;
  lastInsertRowid: number;
}

export interface Db {
  select<T = Row>(sql: string, params?: SqlParam[]): Promise<T[]>;
  execute(sql: string, params?: SqlParam[]): Promise<ExecuteResult>;
  /** Script multi-instructions sans paramètres (migrations). */
  exec(sql: string): Promise<void>;
  /** Transaction BEGIN IMMEDIATE ; les appels imbriqués réutilisent la transaction en cours. */
  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T>;
}

/** Opérations brutes fournies par un driver (une seule connexion derrière). */
export interface RawDriver {
  select(sql: string, params: SqlValue[]): Promise<Row[]>;
  execute(sql: string, params: SqlValue[]): Promise<ExecuteResult>;
  exec(sql: string): Promise<void>;
}

export function toSqlValue(v: SqlParam): SqlValue {
  if (v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  return v;
}

const normalize = (params?: SqlParam[]): SqlValue[] => (params ?? []).map(toSqlValue);

/**
 * Sérialise les accès à une connexion unique : une transaction en cours bloque
 * les autres appels jusqu'à COMMIT/ROLLBACK, pour qu'aucune requête ne s'y glisse.
 */
export function createSerializedDb(raw: RawDriver): Db {
  let queue: Promise<unknown> = Promise.resolve();

  const lock = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = queue.then(fn, fn);
    queue = run.catch(() => undefined);
    return run;
  };

  const txDb: Db = {
    select: <T>(sql: string, params?: SqlParam[]) =>
      raw.select(sql, normalize(params)) as Promise<T[]>,
    execute: (sql, params) => raw.execute(sql, normalize(params)),
    exec: (sql) => raw.exec(sql),
    transaction: (fn) => fn(txDb),
  };

  return {
    select: <T>(sql: string, params?: SqlParam[]) =>
      lock(() => raw.select(sql, normalize(params)) as Promise<T[]>),
    execute: (sql, params) => lock(() => raw.execute(sql, normalize(params))),
    exec: (sql) => lock(() => raw.exec(sql)),
    transaction: (fn) =>
      lock(async () => {
        await raw.exec('BEGIN IMMEDIATE');
        try {
          const result = await fn(txDb);
          await raw.exec('COMMIT');
          return result;
        } catch (err) {
          await raw.exec('ROLLBACK').catch(() => undefined);
          throw err;
        }
      }),
  };
}

/** PRAGMA appliqués à l'ouverture de chaque connexion (app, MCP, tests). */
export const CONNECTION_PRAGMAS = `
PRAGMA journal_mode = WAL;
PRAGMA synchronous = FULL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
`;
