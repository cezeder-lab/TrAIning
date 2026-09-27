import type { AppSettings } from '@training/core';

const KEY = 'training.theme';

/** Applique le thème ; mémorisé localement pour éviter un flash au démarrage. */
export function applyTheme(theme: AppSettings['theme']): void {
  const root = document.documentElement;
  if (theme === 'system') delete root.dataset.theme;
  else root.dataset.theme = theme;
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* stockage indisponible */
  }
}

export function applyStoredTheme(): void {
  try {
    const t = localStorage.getItem(KEY);
    if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  } catch {
    /* stockage indisponible */
  }
}
