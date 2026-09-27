import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { devDbBridge } from './dev/devDbBridge.ts';

// `vite --mode web` : l'app tourne dans un navigateur, la base est servie par le pont HTTP
// de développement (node:sqlite). En usage normal, l'app tourne dans Tauri.
export default defineConfig(({ mode }) => ({
  plugins: [react(), mode === 'web' ? devDbBridge() : null],
  clearScreen: false,
  server: { port: 5173, strictPort: true },
  envPrefix: ['VITE_', 'TAURI_ENV_'],
  build: { target: 'es2022', sourcemap: true },
}));
