import { createSerializedDb, type Db, type ExecuteResult, type Row, type SqlValue } from '@training/core';

/**
 * Abstraction de l'environnement d'exécution : Tauri (usage normal) ou navigateur
 * (développement, via le pont HTTP de vite.config.ts).
 */
export interface Platform {
  kind: 'tauri' | 'web';
  db: Db;
  /** Appelé quand une autre connexion (serveur MCP) a écrit dans la base. */
  onExternalChange(cb: () => void): () => void;
  dbInfo(): Promise<{ path: string; dataDir: string }>;
  saveTextFile(defaultName: string, contents: string): Promise<string | null>;
  openTextFile(): Promise<string | null>;
}

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

async function createTauriPlatform(): Promise<Platform> {
  const { invoke } = await import('@tauri-apps/api/core');
  const { listen } = await import('@tauri-apps/api/event');
  const dialog = await import('@tauri-apps/plugin-dialog');
  const db = createSerializedDb({
    select: (sql, params) => invoke<Row[]>('db_select', { sql, params }),
    execute: (sql, params) => invoke<ExecuteResult>('db_execute', { sql, params }),
    exec: (sql) => invoke<void>('db_exec', { sql }),
  });
  const jsonFilter = [{ name: 'Programme JSON', extensions: ['json'] }];
  return {
    kind: 'tauri',
    db,
    onExternalChange(cb) {
      const p = listen('db-changed', () => cb());
      return () => void p.then((un) => un());
    },
    dbInfo: () => invoke('db_info'),
    async saveTextFile(defaultName, contents) {
      const path = await dialog.save({ defaultPath: defaultName, filters: jsonFilter });
      if (!path) return null;
      await invoke('write_text_file', { path, contents });
      return path;
    },
    async openTextFile() {
      const path = await dialog.open({ multiple: false, directory: false, filters: jsonFilter });
      if (!path || Array.isArray(path)) return null;
      return invoke<string>('read_text_file', { path });
    },
  };
}

function createWebPlatform(): Platform {
  const call = async (op: string, sql: string, params: SqlValue[] = []) => {
    const res = await fetch('/__db', { method: 'POST', body: JSON.stringify({ op, sql, params }) });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error);
    return body.result;
  };
  const db = createSerializedDb({
    select: (sql, params) => call('select', sql, params),
    execute: (sql, params) => call('execute', sql, params),
    exec: (sql) => call('exec', sql),
  });
  return {
    kind: 'web',
    db,
    onExternalChange(cb) {
      let last: number | null = null;
      const timer = setInterval(async () => {
        try {
          const { version } = await (await fetch('/__db/version')).json();
          if (last !== null && version !== last) cb();
          last = version;
        } catch {
          /* serveur de dev arrêté */
        }
      }, 1000);
      return () => clearInterval(timer);
    },
    dbInfo: async () => (await fetch('/__db/info')).json(),
    async saveTextFile(defaultName, contents) {
      const url = URL.createObjectURL(new Blob([contents], { type: 'application/json' }));
      const a = Object.assign(document.createElement('a'), { href: url, download: defaultName });
      a.click();
      URL.revokeObjectURL(url);
      return defaultName;
    },
    openTextFile() {
      return new Promise((resolve) => {
        const input = Object.assign(document.createElement('input'), { type: 'file', accept: '.json,application/json' });
        input.onchange = () => {
          const file = input.files?.[0];
          if (!file) return resolve(null);
          file.text().then(resolve, () => resolve(null));
        };
        input.click();
      });
    },
  };
}

let platformPromise: Promise<Platform> | null = null;

export function getPlatform(): Promise<Platform> {
  platformPromise ??= isTauri ? createTauriPlatform() : Promise.resolve(createWebPlatform());
  return platformPromise;
}
