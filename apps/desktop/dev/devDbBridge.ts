import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { IncomingMessage } from 'node:http';
import type { Plugin } from 'vite';

/**
 * Pont HTTP de développement : expose la base (node:sqlite) au navigateur, pour
 * travailler sur l'interface sans Tauri. Uniquement en `vite --mode web`, jamais en build.
 */
export function devDbBridge(): Plugin {
  return {
    name: 'training-dev-db-bridge',
    apply: 'serve',
    configureServer(server) {
      const path = process.env.TRAINING_DB_PATH ?? resolve(server.config.root, '.dev/training.db');
      mkdirSync(dirname(path), { recursive: true });
      let handlePromise: Promise<{ db: any; dataVersion(): number }> | null = null;
      const handle = () =>
        (handlePromise ??= server
          .ssrLoadModule('@training/core/node')
          .then((m) => m.openNodeDb(path)));

      const readBody = (req: IncomingMessage) =>
        new Promise<any>((ok, ko) => {
          let s = '';
          req.on('data', (c) => (s += c));
          req.on('end', () => ok(s ? JSON.parse(s) : {}));
          req.on('error', ko);
        });

      server.middlewares.use('/__db', async (req, res) => {
        res.setHeader('Content-Type', 'application/json');
        try {
          const h = await handle();
          if (req.url?.startsWith('/version')) {
            res.end(JSON.stringify({ version: h.dataVersion() }));
            return;
          }
          if (req.url?.startsWith('/info')) {
            res.end(JSON.stringify({ path, dataDir: dirname(path) }));
            return;
          }
          const { op, sql, params } = await readBody(req);
          // Le client sérialise déjà ses accès (y compris ses transactions).
          const db = h.db as { select: Function; execute: Function; exec: Function };
          let result: unknown = null;
          if (op === 'select') result = await db.select(sql, params);
          else if (op === 'execute') result = await db.execute(sql, params);
          else if (op === 'exec') {
            try {
              await db.exec(sql);
            } catch (err) {
              // Page rechargée au milieu d'une transaction : on abandonne l'ancienne.
              if (sql !== 'BEGIN IMMEDIATE' || !String(err).includes('within a transaction')) throw err;
              await db.exec('ROLLBACK');
              await db.exec(sql);
            }
          } else throw new Error(`Opération inconnue : ${op}`);
          res.end(JSON.stringify({ result }));
        } catch (err) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
        }
      });
    },
  };
}
