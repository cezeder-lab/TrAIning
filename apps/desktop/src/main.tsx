import { initDatabase } from '@training/core';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { AppProvider, errorMessage } from './lib/app.tsx';
import { getPlatform } from './lib/platform.ts';
import { applyStoredTheme } from './lib/theme.ts';
import './styles/app.css';

applyStoredTheme();
const root = createRoot(document.getElementById('root')!);

async function boot() {
  try {
    const platform = await getPlatform();
    // Migrations + programme initial au premier lancement.
    await initDatabase(platform.db);
    root.render(
      <StrictMode>
        <AppProvider platform={platform}>
          <App />
        </AppProvider>
      </StrictMode>,
    );
  } catch (err) {
    console.error(err);
    root.render(
      <div className="boot-error">
        <h1>Impossible d'ouvrir la base de données</h1>
        <p>{errorMessage(err)}</p>
      </div>,
    );
  }
}

void boot();
