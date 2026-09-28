import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { Modal } from './components/Modal.tsx';
import { ExercisesPage } from './features/exercises/ExercisesPage.tsx';
import { BodyPage } from './features/body/BodyPage.tsx';
import { ClaudePage } from './features/claude/ClaudePage.tsx';
import { JournalPage } from './features/journal/JournalPage.tsx';
import { NutritionPage } from './features/nutrition/NutritionPage.tsx';
import { SessionPage } from './features/journal/SessionPage.tsx';
import { ProgramPage } from './features/program/ProgramPage.tsx';
import { SettingsPage } from './features/settings/SettingsPage.tsx';
import { useApp } from './lib/app.tsx';
import { ensureBundledFoodData, takeAnnouncement } from './lib/foodData.ts';
import { useSettings } from './lib/queries.ts';
import { navigate, useLocation, type Route } from './lib/router.ts';
import { applyTheme } from './lib/theme.ts';

const NAV: { route: Route; label: string; icon: ReactNode; shortcut: string }[] = [
  { route: 'programme', label: 'Programme', icon: <IconList />, shortcut: '1' },
  { route: 'journal', label: 'Journal', icon: <IconCalendar />, shortcut: '2' },
  { route: 'exercices', label: 'Exercices', icon: <IconDumbbell />, shortcut: '3' },
  { route: 'nutrition', label: 'Nutrition', icon: <IconLeaf />, shortcut: '4' },
  { route: 'corps', label: 'Corps', icon: <IconScale />, shortcut: '5' },
  { route: 'claude', label: 'Claude Desktop', icon: <IconSpark />, shortcut: '6' },
  { route: 'parametres', label: 'Paramètres', icon: <IconGear />, shortcut: '7' },
];

export function App() {
  const { route, param } = useLocation();
  const { data: settings } = useSettings();
  const [help, setHelp] = useState(false);

  useEffect(() => {
    if (settings) applyTheme(settings.theme);
  }, [settings]);

  // Tables alimentaires embarquées dans l'installeur (premier lancement, mises à jour).
  const { platform, toast } = useApp();
  const qc = useQueryClient();
  useEffect(() => {
    ensureBundledFoodData(platform).then(
      (messages) => {
        const m = takeAnnouncement(messages);
        if (m) {
          toast(m);
          void qc.invalidateQueries();
        }
      },
      (err) => console.warn('Tables alimentaires', err),
    );
  }, [platform, toast, qc]);

  // Ctrl+1…7 : navigation ; « ? » : aide des raccourcis.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const inField = (e.target as HTMLElement).closest('input, textarea, select, [contenteditable]');
      if ((e.ctrlKey || e.metaKey) && /^[1-7]$/.test(e.key)) {
        e.preventDefault();
        navigate(NAV[Number(e.key) - 1]!.route);
      } else if (e.key === '?' && !inField) {
        setHelp(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark" aria-hidden />
          TrAIning
        </div>
        <nav aria-label="Navigation principale">
          {NAV.map((n) => (
            <a key={n.route} href={`#/${n.route}`} title={`Ctrl+${n.shortcut}`} className={`nav-item ${route === n.route ? 'is-active' : ''}`} aria-current={route === n.route ? 'page' : undefined}>
              {n.icon}
              <span>{n.label}</span>
            </a>
          ))}
        </nav>
        <button type="button" className="nav-help" onClick={() => setHelp(true)}>
          Raccourcis clavier <kbd>?</kbd>
        </button>
      </aside>
      <main className="main">
        {route === 'programme' && <ProgramPage />}
        {route === 'journal' && (param ? <SessionPage key={param} id={param} /> : <JournalPage />)}
        {route === 'exercices' && <ExercisesPage />}
        {route === 'nutrition' && <NutritionPage />}
        {route === 'claude' && <ClaudePage />}
        {route === 'corps' && <BodyPage />}
        {route === 'parametres' && <SettingsPage />}
      </main>
      {help && <ShortcutsHelp onClose={() => setHelp(false)} />}
    </div>
  );
}

function ShortcutsHelp({ onClose }: { onClose: () => void }) {
  const rows: [string, string][] = [
    ['Ctrl + 1…7', 'Changer de section'],
    ['Alt + ← / →', 'Séance précédente / suivante'],
    ['Alt + Maj + ← / →', 'Déplacer la séance affichée'],
    ['Ctrl + N', 'Ajouter un exercice à la séance'],
    ['↑ / ↓', 'Passer d’un exercice à l’autre'],
    ['Entrée', 'Ouvrir / fermer le détail d’un exercice'],
    ['Alt + ↑ / ↓', 'Déplacer l’exercice sélectionné'],
    ['Espace sur ⋮⋮', 'Saisir / déposer (glisser-déposer au clavier)'],
    ['Échap', 'Fermer une fenêtre'],
  ];
  return (
    <Modal title="Raccourcis clavier" onClose={onClose} width={480}>
      <table className="shortcuts">
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k}>
              <td>
                <kbd>{k}</kbd>
              </td>
              <td>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Modal>
  );
}

function Svg({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {children}
    </svg>
  );
}
function IconList() {
  return <Svg><path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01" /></Svg>;
}
function IconCalendar() {
  return <Svg><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18" /></Svg>;
}
function IconDumbbell() {
  return <Svg><path d="M6 7v10M3 9v6M18 7v10M21 9v6M6 12h12" /></Svg>;
}
function IconLeaf() {
  return <Svg><path d="M5 19c8 0 14-6 14-14-8 0-14 6-14 14zM5 19l7-7" /></Svg>;
}
function IconScale() {
  return <Svg><rect x="3" y="3" width="18" height="18" rx="4" /><path d="M8 9a5 5 0 0 1 8 0l-3 3" /></Svg>;
}
function IconSpark() {
  return <Svg><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6" /></Svg>;
}
function IconGear() {
  return <Svg><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></Svg>;
}
