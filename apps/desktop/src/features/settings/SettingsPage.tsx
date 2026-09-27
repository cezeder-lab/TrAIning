import {
  activateProgram,
  createMealCategory,
  reorderMealCategories,
  updateMealCategory,
  deleteArchivedProgram,
  restoreInitialProgram,
  setSetting,
  updateUserProfile,
  type AppSettings,
} from '@training/core';
import { useState } from 'react';
import { TextArea, TextField, Toggle } from '../../components/fields.tsx';
import { useAction, useApp } from '../../lib/app.tsx';
import { useDbInfo, useMealCategories, usePrograms, useProfile, useSettings } from '../../lib/queries.ts';
import { applyTheme } from '../../lib/theme.ts';

const THEMES: { value: AppSettings['theme']; label: string }[] = [
  { value: 'system', label: 'Système' },
  { value: 'light', label: 'Clair' },
  { value: 'dark', label: 'Sombre' },
];

export function SettingsPage() {
  return (
    <div className="page settings-page">
      <header className="page-header">
        <div className="page-title">
          <span className="eyebrow">Réglages</span>
          <h1>Paramètres</h1>
        </div>
      </header>
      <AppearanceSection />
      <ProgramsSection />
      <ProfileSection />
      <MealCategoriesSection />
      <DataSection />
    </div>
  );
}

function AppearanceSection() {
  const { data: settings } = useSettings();
  const run = useAction();
  return (
    <section className="card">
      <h2>Apparence</h2>
      <div className="segmented" role="radiogroup" aria-label="Thème">
        {THEMES.map((t) => (
          <button
            key={t.value}
            type="button"
            role="radio"
            aria-checked={settings?.theme === t.value}
            className={settings?.theme === t.value ? 'is-selected' : ''}
            onClick={() => {
              applyTheme(t.value);
              void run((db) => setSetting(db, 'theme', t.value));
            }}
          >
            {t.label}
          </button>
        ))}
      </div>
    </section>
  );
}

function ProgramsSection() {
  const { data: programs = [] } = usePrograms();
  const { confirm } = useApp();
  const run = useAction();

  const restore = async () => {
    const ok = await confirm({
      title: 'Restaurer le programme initial',
      message:
        'Une copie neuve du programme initial (Push / Pull / Legs / Abdos) va devenir le programme actif.\n\n' +
        'Le programme actuel est archivé, pas supprimé : vous pourrez le réactiver ici. ' +
        "L'historique des séances n'est pas modifié.",
      confirmLabel: 'Restaurer',
    });
    if (ok) await run((db) => restoreInitialProgram(db), 'Programme initial restauré.');
  };

  const remove = async (id: string, name: string) => {
    const ok = await confirm({
      title: 'Supprimer le programme archivé',
      message: `Supprimer définitivement « ${name} » ? Les séances déjà enregistrées restent dans le journal.`,
      confirmLabel: 'Supprimer',
      danger: true,
    });
    if (ok) await run((db) => deleteArchivedProgram(db, id), 'Programme supprimé.');
  };

  return (
    <section className="card">
      <h2>Programmes</h2>
      <ul className="program-list">
        {programs.map((p) => (
          <li key={p.id}>
            <div>
              <strong>{p.name}</strong>
              {p.isActive && <span className="badge badge-default">Actif</span>}
              <div className="muted small">
                {p.templateCount} séance(s) · modifié le {new Date(p.updatedAt).toLocaleDateString('fr-FR')}
              </div>
            </div>
            {!p.isActive && (
              <div className="row">
                <button type="button" className="btn" onClick={() => void run((db) => activateProgram(db, p.id), 'Programme activé.')}>
                  Activer
                </button>
                <button type="button" className="btn btn-ghost btn-danger-text" onClick={() => void remove(p.id, p.name)}>
                  Supprimer
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
      <button type="button" className="btn" onClick={() => void restore()}>
        Restaurer le programme initial…
      </button>
    </section>
  );
}

function ProfileSection() {
  const { data: profile } = useProfile();
  const run = useAction();
  if (!profile) return null;
  return (
    <section className="card">
      <h2>Profil</h2>
      <p className="muted">Lu par Claude Desktop (phase 5) pour adapter ses analyses et ses réponses.</p>
      <div className="grid grid-3">
        <TextField label="Prénom / pseudo" value={profile.displayName} onSave={(displayName) => run((db) => updateUserProfile(db, { displayName }))} />
        <TextField
          label="Priorités musculaires"
          className="span-2"
          value={profile.musclePriorities.join(', ')}
          placeholder="ex. haut des pectoraux, deltoïde latéral"
          hint="Séparées par des virgules."
          onSave={(v) =>
            run((db) =>
              updateUserProfile(db, {
                musclePriorities: (v ?? '').split(',').map((s) => s.trim()).filter(Boolean),
              }),
            )
          }
        />
      </div>
      <TextArea label="Objectifs" rows={3} value={profile.goals} onSave={(goals) => run((db) => updateUserProfile(db, { goals }))} />
      <TextArea
        label="Contraintes physiques"
        rows={3}
        value={profile.physicalConstraints}
        placeholder="ex. épaule gauche sensible au développé"
        onSave={(physicalConstraints) => run((db) => updateUserProfile(db, { physicalConstraints }))}
      />
      <TextArea
        label="Préférences de réponse"
        rows={2}
        value={profile.responsePreferences}
        placeholder="ex. réponses concises, tableaux"
        onSave={(responsePreferences) => run((db) => updateUserProfile(db, { responsePreferences }))}
      />
    </section>
  );
}

function MealCategoriesSection() {
  const { data: cats = [] } = useMealCategories(true);
  const run = useAction();
  const [name, setName] = useState('');
  const move = (i: number, d: number) => {
    const ids = cats.map((c) => c.id);
    const [x] = ids.splice(i, 1);
    ids.splice(i + d, 0, x!);
    void run((db) => reorderMealCategories(db, ids));
  };
  return (
    <section className="card">
      <h2>Repas</h2>
      <p className="muted">Catégories du journal alimentaire. Une catégorie désactivée reste visible les jours où elle contient des aliments.</p>
      <ul className="meal-cats">
        {cats.map((c, i) => (
          <li key={c.id}>
            <TextField label={`Nom du repas ${i + 1}`} className="label-hidden" required value={c.name} onSave={(n) => n && run((db) => updateMealCategory(db, c.id, { name: n }))} />
            <Toggle label="Actif" checked={c.isActive} onChange={(isActive) => run((db) => updateMealCategory(db, c.id, { isActive }))} />
            <button type="button" className="btn-icon" aria-label="Monter" disabled={i === 0} onClick={() => move(i, -1)}>
              ↑
            </button>
            <button type="button" className="btn-icon" aria-label="Descendre" disabled={i === cats.length - 1} onClick={() => move(i, 1)}>
              ↓
            </button>
          </li>
        ))}
      </ul>
      <form
        className="row"
        onSubmit={async (e) => {
          e.preventDefault();
          if ((await run((db) => createMealCategory(db, name))) !== undefined) setName('');
        }}
      >
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nouveau repas (ex. Collation pré-séance)" aria-label="Nouveau repas" style={{ maxWidth: 320 }} />
        <button type="submit" className="btn" disabled={!name.trim()}>
          Ajouter
        </button>
      </form>
    </section>
  );
}

function DataSection() {
  const { data: info } = useDbInfo();
  const { platform } = useApp();
  return (
    <section className="card">
      <h2>Données</h2>
      <dl className="kv">
        <dt>Base de données</dt>
        <dd>
          <code>{info?.path ?? '…'}</code>
        </dd>
        <dt>Environnement</dt>
        <dd>{platform.kind === 'tauri' ? 'Application' : 'Navigateur (développement)'}</dd>
      </dl>
      <p className="muted">Sauvegardes automatiques, export et restauration de la base : phase 6.</p>
    </section>
  );
}
