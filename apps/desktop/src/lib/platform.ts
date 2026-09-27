import { createSerializedDb, type Db, type ExecuteResult, type Row, type SqlValue } from '@training/core';

export interface DbInfo {
  path: string;
  dataDir: string;
  mediaDir: string;
}

/**
 * Abstraction de l'environnement d'exécution : Tauri (usage normal) ou navigateur
 * (développement, via le pont HTTP de vite.config.ts).
 */
export interface Platform {
  kind: 'tauri' | 'web';
  db: Db;
  /** Appelé quand une autre connexion (serveur MCP) a écrit dans la base. */
  onExternalChange(cb: () => void): () => void;
  dbInfo(): Promise<DbInfo>;
  saveTextFile(defaultName: string, contents: string): Promise<string | null>;
  openTextFile(): Promise<string | null>;
  /** URL affichable d'un média (chemin relatif au dossier des médias). */
  mediaUrl(relPath: string): string;
  /** Choisit une image sur le disque et la copie dans les médias ; retourne son chemin relatif. */
  pickImage(subdir: string): Promise<string | null>;
  saveMediaBytes(bytes: Uint8Array, ext: string, subdir: string): Promise<string>;
  /** Contenu d'un média (pour le dessiner sur un canvas sans le « contaminer »). */
  mediaBytes(relPath: string): Promise<Uint8Array>;
  deleteMediaFile(relPath: string): Promise<void>;
  openExternal(url: string): Promise<void>;
  /** fetch sans restriction CORS (Tauri) ; fetch standard en mode navigateur. */
  httpFetch(url: string, init?: RequestInit): Promise<Response>;
  pickDirectory(title: string): Promise<string | null>;
  pickFile(title: string, extensions: string[]): Promise<string | null>;
  readBinaryFile(path: string): Promise<Uint8Array>;
  /** Écrit un fichier dans `dir` ; retourne le chemin complet. */
  writeBinaryFile(dir: string, name: string, bytes: Uint8Array): Promise<string>;
  copyImageToClipboard(png: Uint8Array): Promise<void>;
  /** Ressource embarquée dans l'installeur ; null si absente. */
  readResource(name: string): Promise<Uint8Array | null>;
  /** Appel d'une commande spécifique à l'application de bureau (sauvegardes, Claude Desktop…). */
  invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
}

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

const IMAGE_FILTER = [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp'] }];

async function createTauriPlatform(): Promise<Platform> {
  const { invoke, convertFileSrc } = await import('@tauri-apps/api/core');
  const { listen } = await import('@tauri-apps/api/event');
  const dialog = await import('@tauri-apps/plugin-dialog');
  const db = createSerializedDb({
    select: (sql, params) => invoke<Row[]>('db_select', { sql, params }),
    execute: (sql, params) => invoke<ExecuteResult>('db_execute', { sql, params }),
    exec: (sql) => invoke<void>('db_exec', { sql }),
  });
  const info = await invoke<DbInfo>('db_info');
  const sep = info.mediaDir.includes('\\') ? '\\' : '/';
  const jsonFilter = [{ name: 'Programme JSON', extensions: ['json'] }];
  return {
    kind: 'tauri',
    db,
    onExternalChange(cb) {
      const p = listen('db-changed', () => cb());
      return () => void p.then((un) => un());
    },
    dbInfo: async () => info,
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
    mediaUrl: (rel) => convertFileSrc(`${info.mediaDir}${sep}${rel.replaceAll('/', sep)}`),
    async pickImage(subdir) {
      const src = await dialog.open({ multiple: false, directory: false, filters: IMAGE_FILTER });
      if (!src || Array.isArray(src)) return null;
      return invoke<string>('import_media_file', { src, subdir });
    },
    saveMediaBytes: (bytes, ext, subdir) => invoke<string>('save_media_bytes', { base64: toBase64(bytes), ext, subdir }),
    deleteMediaFile: (rel) => invoke('delete_media_file', { rel }),
    mediaBytes: async (rel) =>
      fromBase64(await invoke<string>('read_binary_file', { path: `${info.mediaDir}${sep}${rel.replaceAll('/', sep)}` })),
    async openExternal(url) {
      const { openUrl } = await import('@tauri-apps/plugin-opener');
      await openUrl(url);
    },
    async httpFetch(url, init) {
      const { fetch } = await import('@tauri-apps/plugin-http');
      return fetch(url, init);
    },
    async pickDirectory(title) {
      const dir = await dialog.open({ directory: true, multiple: false, title });
      return typeof dir === 'string' ? dir : null;
    },
    async pickFile(title, extensions) {
      const f = await dialog.open({ multiple: false, directory: false, title, filters: [{ name: title, extensions }] });
      return typeof f === 'string' ? f : null;
    },
    readBinaryFile: async (path) => fromBase64(await invoke<string>('read_binary_file', { path })),
    writeBinaryFile: (dir, name, bytes) => invoke<string>('write_binary_file', { dir, name, base64: toBase64(bytes) }),
    async copyImageToClipboard(png) {
      const { writeImage } = await import('@tauri-apps/plugin-clipboard-manager');
      await writeImage(png);
    },
    async readResource(name) {
      const b64 = await invoke<string | null>('read_resource', { name });
      return b64 ? fromBase64(b64) : null;
    },
    invoke: (command, args) => invoke(command, args),
  };
}

function pickBrowserFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = Object.assign(document.createElement('input'), { type: 'file', accept });
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.click();
  });
}

function downloadBlob(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function createWebPlatform(): Promise<Platform> {
  const post = async (path: string, body: unknown) => {
    const res = await fetch(path, { method: 'POST', body: JSON.stringify(body) });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error);
    return json.result;
  };
  const call = (op: string, sql: string, params: SqlValue[] = []) => post('/__db', { op, sql, params });
  const db = createSerializedDb({
    select: (sql, params) => call('select', sql, params),
    execute: (sql, params) => call('execute', sql, params),
    exec: (sql) => call('exec', sql),
  });
  const info: DbInfo = await (await fetch('/__db/info')).json();
  const saveMediaBytes = (bytes: Uint8Array, ext: string, subdir: string) =>
    post('/__media/save', { base64: toBase64(bytes), ext, subdir }) as Promise<string>;
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
    dbInfo: async () => info,
    async saveTextFile(defaultName, contents) {
      downloadBlob(defaultName, new Blob([contents], { type: 'application/json' }));
      return defaultName;
    },
    async openTextFile() {
      const file = await pickBrowserFile('.json,application/json');
      return file ? file.text() : null;
    },
    mediaUrl: (rel) => `/__media/file/${rel}`,
    async pickImage(subdir) {
      const file = await pickBrowserFile('image/*');
      if (!file) return null;
      const ext = file.name.split('.').pop() ?? 'jpg';
      return saveMediaBytes(new Uint8Array(await file.arrayBuffer()), ext, subdir);
    },
    saveMediaBytes,
    deleteMediaFile: (rel) => post('/__media/delete', { rel }),
    mediaBytes: async (rel) => new Uint8Array(await (await fetch(`/__media/file/${rel}`)).arrayBuffer()),
    async openExternal(url) {
      window.open(url, '_blank', 'noopener');
    },
    httpFetch: (url, init) => fetch(url, init),
    async pickDirectory() {
      return 'Téléchargements';
    },
    async pickFile(_title, extensions) {
      const file = await pickBrowserFile(extensions.map((e) => `.${e}`).join(','));
      if (!file) return null;
      webFiles.set(file.name, file);
      return file.name;
    },
    async readBinaryFile(path) {
      const file = webFiles.get(path);
      if (!file) throw new Error('Fichier introuvable.');
      return new Uint8Array(await file.arrayBuffer());
    },
    async writeBinaryFile(_dir, name, bytes) {
      downloadBlob(name, new Blob([bytes as BlobPart]));
      return name;
    },
    async copyImageToClipboard(png) {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': new Blob([png as BlobPart], { type: 'image/png' }) })]);
    },
    async readResource(name) {
      const res = await fetch(`/__resource/${name}`);
      return res.ok ? new Uint8Array(await res.arrayBuffer()) : null;
    },
    async invoke() {
      throw new Error("Fonction disponible uniquement dans l'application de bureau.");
    },
  };
}

const webFiles = new Map<string, File>();

let platformPromise: Promise<Platform> | null = null;

export function getPlatform(): Promise<Platform> {
  platformPromise ??= isTauri ? createTauriPlatform() : createWebPlatform();
  return platformPromise;
}
