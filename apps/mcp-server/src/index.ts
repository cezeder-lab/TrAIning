import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { LATEST_SCHEMA_VERSION, getActiveProgram, getSchemaVersion } from '@training/core';
import { openNodeDb } from '@training/core/node';
import { OFF_USER_AGENT } from '@training/core';
import { VERSION, createServer } from './server.ts';

/**
 * Serveur MCP de TrAIning (transport stdio), lancé par Claude Desktop.
 *   training-mcp --db <chemin de training.db>   (sinon TRAINING_DB_PATH, sinon emplacement par défaut)
 *   training-mcp --self-test                      vérifie l'accès à la base et quitte
 */

function defaultDbPath(): string {
  const id = 'fr.training.journal';
  if (process.platform === 'win32') return join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), id, 'training.db');
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Application Support', id, 'training.db');
  return join(process.env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share'), id, 'training.db');
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const dbPath = arg('--db') ?? process.env.TRAINING_DB_PATH ?? defaultDbPath();
  if (process.argv.includes('--version')) {
    console.log(VERSION);
    return;
  }
  if (!existsSync(dbPath)) {
    throw new Error(`Base introuvable : ${dbPath}. Lancez l'application TrAIning une première fois, ou corrigez le chemin --db.`);
  }
  const handle = openNodeDb(dbPath);
  const version = await getSchemaVersion(handle.db);
  if (version < LATEST_SCHEMA_VERSION) {
    throw new Error(`La base est en version ${version} : ouvrez l'application TrAIning pour la mettre à jour (version ${LATEST_SCHEMA_VERSION} attendue).`);
  }
  if (version > LATEST_SCHEMA_VERSION) {
    throw new Error(`La base (version ${version}) est plus récente que ce serveur (${LATEST_SCHEMA_VERSION}) : mettez à jour TrAIning.`);
  }

  if (process.argv.includes('--self-test')) {
    const program = await getActiveProgram(handle.db);
    const foods = (await handle.db.select<{ n: number }>('SELECT count(*) AS n FROM food'))[0]!.n;
    const sessions = (await handle.db.select<{ n: number }>('SELECT count(*) AS n FROM workout_session'))[0]!.n;
    console.log(JSON.stringify({ ok: true, version: VERSION, db: dbPath, schema: version, program: program?.name ?? null, sessions, foods }));
    handle.close();
    return;
  }

  const fetchWithUa = (url: string, init?: RequestInit) =>
    fetch(url, { ...init, headers: { 'User-Agent': OFF_USER_AGENT, ...(init?.headers as Record<string, string>) }, signal: AbortSignal.timeout(15000) });
  const server = createServer({ db: handle.db, fetch: fetchWithUa });
  await server.connect(new StdioServerTransport());
  console.error(`[training-mcp ${VERSION}] prêt — base : ${dbPath}`);
  const shutdown = () => {
    handle.close();
    process.exit(0);
  };
  process.stdin.on('close', shutdown);
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  // stdout est réservé au protocole : les erreurs vont sur stderr.
  console.error(`[training-mcp] ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
