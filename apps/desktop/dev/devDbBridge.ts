import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, normalize, resolve } from 'node:path';
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

      const mediaDir = join(dirname(path), 'media');
      const safe = (rel: string) => {
        const p = normalize(join(mediaDir, rel));
        if (!p.startsWith(mediaDir)) throw new Error('Chemin invalide');
        return p;
      };
      server.middlewares.use('/__resource', (req, res) => {
        try {
          const name = decodeURIComponent((req.url ?? '').slice(1));
          if (!/^[\w.-]+$/.test(name)) throw new Error('Nom invalide');
          res.end(readFileSync(join(server.config.root, 'src-tauri/resources', name)));
        } catch {
          res.statusCode = 404;
          res.end();
        }
      });

      server.middlewares.use('/__media', async (req, res) => {
        try {
          if (req.url?.startsWith('/file/')) {
            const p = safe(decodeURIComponent(req.url.slice(6)));
            const ext = p.split('.').pop()?.toLowerCase();
            res.setHeader('Content-Type', ext === 'png' ? 'image/png' : ext === 'gif' ? 'image/gif' : ext === 'webp' ? 'image/webp' : 'image/jpeg');
            res.end(readFileSync(p));
            return;
          }
          const body = await readBody(req);
          res.setHeader('Content-Type', 'application/json');
          if (req.url?.startsWith('/save')) {
            const rel = `${body.subdir}/${Date.now().toString(16)}${Math.random().toString(16).slice(2, 6)}.${String(body.ext).toLowerCase()}`;
            mkdirSync(dirname(safe(rel)), { recursive: true });
            writeFileSync(safe(rel), Buffer.from(body.base64, 'base64'));
            res.end(JSON.stringify({ result: rel }));
          } else if (req.url?.startsWith('/delete')) {
            rmSync(safe(body.rel), { force: true });
            res.end(JSON.stringify({ result: null }));
          } else throw new Error('Route inconnue');
        } catch (err) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
        }
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
            res.end(JSON.stringify({ path, dataDir: dirname(path), mediaDir: join(dirname(path), 'media') }));
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
