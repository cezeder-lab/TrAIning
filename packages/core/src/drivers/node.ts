import { DatabaseSync } from 'node:sqlite';
import { CONNECTION_PRAGMAS, createSerializedDb, type Db, type Row } from '../db/driver.ts';

export interface NodeDbHandle {
  db: Db;
  /** PRAGMA data_version : change quand une autre connexion a validé une écriture. */
  dataVersion(): number;
  close(): void;
}

/** Ouvre la base avec node:sqlite (serveur MCP, tests, mode navigateur de dev). */
export function openNodeDb(path: string): NodeDbHandle {
  const conn = new DatabaseSync(path);
  conn.exec(CONNECTION_PRAGMAS);
  const db = createSerializedDb({
    async select(sql, params) {
      return conn.prepare(sql).all(...params) as Row[];
    },
    async execute(sql, params) {
      const r = conn.prepare(sql).run(...params);
      return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
    },
    async exec(sql) {
      conn.exec(sql);
    },
  });
  return {
    db,
    dataVersion: () => Number((conn.prepare('PRAGMA data_version').get() as Row).data_version),
    close: () => conn.close(),
  };
}
