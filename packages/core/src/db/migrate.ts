import type { Db } from './driver.ts';
import { nowIso } from './util.ts';
import m0001 from './migrations/0001_init.ts';
import m0002 from './migrations/0002_nutrition.ts';

interface Migration {
  version: number;
  name: string;
  sql: string;
}

/** Liste ordonnée des migrations. Ne jamais modifier une migration publiée : en ajouter une. */
export const MIGRATIONS: Migration[] = [
  { version: 1, name: 'init', sql: m0001 },
  { version: 2, name: 'nutrition', sql: m0002 },
];

export const LATEST_SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1]!.version;

export async function getSchemaVersion(db: Db): Promise<number> {
  const t = await db.select<{ n: number }>(
    "SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'schema_migration'",
  );
  if (!t[0]?.n) return 0;
  const r = await db.select<{ v: number | null }>('SELECT max(version) AS v FROM schema_migration');
  return r[0]?.v ?? 0;
}

/** Applique les migrations manquantes, chacune dans sa transaction. */
export async function migrate(db: Db): Promise<{ from: number; to: number }> {
  await db.exec(`CREATE TABLE IF NOT EXISTS schema_migration (
    version     INTEGER PRIMARY KEY,
    name        TEXT NOT NULL,
    applied_at  TEXT NOT NULL
  ) STRICT;`);
  const from = await getSchemaVersion(db);
  if (from > LATEST_SCHEMA_VERSION) {
    throw new Error(
      `La base est en version ${from}, plus récente que cette application (${LATEST_SCHEMA_VERSION}). Mettez l'application à jour.`,
    );
  }
  for (const m of MIGRATIONS) {
    if (m.version <= from) continue;
    await db.transaction(async (tx) => {
      // Relecture dans la transaction : une autre connexion a pu migrer entre-temps.
      if ((await getSchemaVersion(tx)) >= m.version) return;
      await tx.exec(m.sql);
      await tx.execute('INSERT INTO schema_migration (version, name, applied_at) VALUES (?, ?, ?)', [
        m.version,
        m.name,
        nowIso(),
      ]);
    });
  }
  return { from, to: LATEST_SCHEMA_VERSION };
}
