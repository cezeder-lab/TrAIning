// Construit training-mcp(.exe) : un seul exécutable autonome (Node SEA), sans installation de Node.
//   1. esbuild : un seul fichier dist/server.cjs
//   2. Node SEA : blob + copie de l'exécutable Node + injection (postject)
//   3. copie en « sidecar » Tauri : apps/desktop/src-tauri/binaries/training-mcp-<cible>(.exe)
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const isWin = process.platform === 'win32';
const exe = join(dist, isWin ? 'training-mcp.exe' : 'training-mcp');
mkdirSync(dist, { recursive: true });

await build({
  entryPoints: [join(root, 'src/index.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  outfile: join(dist, 'server.cjs'),
  legalComments: 'none',
  logLevel: 'warning',
});
console.log('✓ bundle dist/server.cjs');

const seaConfig = join(dist, 'sea-config.json');
writeFileSync(seaConfig, JSON.stringify({ main: join(dist, 'server.cjs'), output: join(dist, 'sea-prep.blob'), disableExperimentalSEAWarning: true }));
execFileSync(process.execPath, ['--experimental-sea-config', seaConfig], { stdio: 'inherit' });

copyFileSync(process.execPath, exe);
if (!isWin) chmodSync(exe, 0o755);
if (process.platform === 'darwin') execFileSync('codesign', ['--remove-signature', exe]);
const postject = createRequire(import.meta.url).resolve('postject/dist/cli.js');
execFileSync(
  process.execPath,
  [
    postject, exe, 'NODE_SEA_BLOB', join(dist, 'sea-prep.blob'),
    '--sentinel-fuse', 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
    ...(process.platform === 'darwin' ? ['--macho-segment-name', 'NODE_SEA'] : []),
  ],
  { stdio: ['ignore', 'ignore', 'inherit'] },
);
if (process.platform === 'darwin') execFileSync('codesign', ['--sign', '-', exe]);
console.log(`✓ exécutable ${exe}`);

let triple = process.env.TAURI_TARGET_TRIPLE;
if (!triple) {
  try {
    triple = /host: (\S+)/.exec(execFileSync('rustc', ['-vV']).toString())?.[1];
  } catch {
    /* Rust absent : pas de copie sidecar */
  }
}
if (triple) {
  const binDir = join(root, '../desktop/src-tauri/binaries');
  mkdirSync(binDir, { recursive: true });
  const target = join(binDir, `training-mcp-${triple}${isWin ? '.exe' : ''}`);
  copyFileSync(exe, target);
  console.log(`✓ sidecar Tauri ${target}`);
} else {
  console.warn('⚠ rustc introuvable : sidecar Tauri non copié (définir TAURI_TARGET_TRIPLE).');
}
