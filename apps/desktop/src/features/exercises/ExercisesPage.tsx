import { createExercise, listExercises } from '@training/core';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { filterExercises } from '../../components/ExercisePicker.tsx';
import { PromptDialog } from '../../components/PromptDialog.tsx';
import { useAction, useApp } from '../../lib/app.tsx';
import { ExerciseDetail } from './ExerciseDetail.tsx';
import { KIND_LABELS } from '../../lib/labels.ts';

export function ExercisesPage() {
  const { platform } = useApp();
  const [showArchived, setShowArchived] = useState(false);
  const { data: exercises = [] } = useQuery({
    queryKey: ['exercises', { archived: showArchived }],
    queryFn: () => listExercises(platform.db, { includeArchived: showArchived }),
  });
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const run = useAction();

  const filtered = useMemo(() => filterExercises(exercises, query), [exercises, query]);
  const selected = exercises.find((e) => e.id === selectedId) ?? null;

  return (
    <div className="page exercises-page">
      <header className="page-header">
        <div className="page-title">
          <span className="eyebrow">Catalogue</span>
          <h1>Exercices</h1>
        </div>
        <div className="page-actions">
          <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
            + Nouvel exercice
          </button>
        </div>
      </header>

      <div className="split">
        <aside className="split-list">
          <input
            className="search"
            placeholder="Rechercher…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Rechercher un exercice"
          />
          <label className="checkbox-inline">
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
            Afficher les archivés
          </label>
          <ul className="list" aria-label="Exercices">
            {filtered.map((e) => (
              <li key={e.id}>
                <button
                  type="button"
                  className={`list-item ${e.id === selectedId ? 'is-selected' : ''} ${e.isArchived ? 'is-archived' : ''}`}
                  onClick={() => setSelectedId(e.id)}
                >
                  <span>{e.name}</span>
                  <small>{[KIND_LABELS[e.kind], e.equipment].filter(Boolean).join(' · ')}</small>
                </button>
              </li>
            ))}
          </ul>
          <p className="muted small">{filtered.length} exercice(s)</p>
        </aside>
        <section className="split-detail">
          {selected ? (
            <ExerciseDetail key={selected.id} exercise={selected} />
          ) : (
            <p className="empty-state">Sélectionnez un exercice : fiche (nom, muscles, notes techniques), médias et historique.</p>
          )}
        </section>
      </div>

      {creating && (
        <PromptDialog
          title="Nouvel exercice"
          label="Nom de l'exercice"
          confirmLabel="Créer"
          onClose={() => setCreating(false)}
          onSubmit={async (name) => {
            const ex = await run((db) => createExercise(db, { name, kind: 'weight' }));
            if (ex) setSelectedId(ex.id);
          }}
        />
      )}
    </div>
  );
}

