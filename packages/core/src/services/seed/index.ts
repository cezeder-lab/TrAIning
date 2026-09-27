import type { Db } from '../../db/driver.ts';
import { migrate } from '../../db/migrate.ts';
import { nowIso } from '../../db/util.ts';
import { importProgram } from '../programJson.ts';
import { INITIAL_PROGRAM } from './initialProgram.ts';
import { MUSCLE_GROUPS } from './referenceData.ts';

/** Données de référence (idempotent). */
export async function seedReferenceData(db: Db): Promise<void> {
  await db.transaction(async (tx) => {
    for (const g of MUSCLE_GROUPS) {
      await tx.execute(
        `INSERT INTO muscle_group (id, name, region, sort) VALUES (?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET name = excluded.name, region = excluded.region, sort = excluded.sort`,
        [g.id, g.name, g.region, g.sort],
      );
    }
    await tx.execute('INSERT OR IGNORE INTO user_profile (id, updated_at) VALUES (1, ?)', [nowIso()]);
  });
}

/**
 * Initialisation complète à l'ouverture par l'application : migrations, référentiels,
 * puis programme initial si aucun programme n'existe encore (premier lancement).
 */
export async function initDatabase(db: Db): Promise<{ seededProgram: boolean }> {
  await migrate(db);
  await seedReferenceData(db);
  const n = (await db.select<{ n: number }>('SELECT count(*) AS n FROM program'))[0]!.n;
  if (n > 0) return { seededProgram: false };
  await importProgram(db, INITIAL_PROGRAM, { origin: 'seed', activate: true });
  return { seededProgram: true };
}

/**
 * « Restaurer le programme initial » : crée une nouvelle copie du programme initial et
 * l'active. Le programme courant est archivé (pas supprimé) et l'historique n'est pas touché.
 */
export async function restoreInitialProgram(db: Db): Promise<string> {
  return importProgram(db, INITIAL_PROGRAM, { origin: 'seed', activate: true });
}
