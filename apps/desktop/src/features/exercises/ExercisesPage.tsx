import {
  createExercise,
  listExercises,
  setExerciseArchived,
  updateExercise,
  type Exercise,
  type ExerciseMuscle,
  type MuscleGroup,
} from '@training/core';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { filterExercises } from '../../components/ExercisePicker.tsx';
import { PromptDialog } from '../../components/PromptDialog.tsx';
import { SelectField, TextArea, TextField } from '../../components/fields.tsx';
import { useAction, useApp } from '../../lib/app.tsx';
import { KIND_LABELS, KIND_OPTIONS } from '../../lib/labels.ts';
import { useActiveProgram, useMuscleGroups } from '../../lib/queries.ts';

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
            <ExerciseEditor key={selected.id} exercise={selected} />
          ) : (
            <p className="empty-state">Sélectionnez un exercice pour modifier son nom, son type, ses muscles et ses notes techniques.</p>
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

function ExerciseEditor({ exercise }: { exercise: Exercise }) {
  const run = useAction();
  const { data: groups = [] } = useMuscleGroups();
  const { data: program } = useActiveProgram();

  const usages = useMemo(() => {
    const out: string[] = [];
    for (const t of program?.templates ?? []) {
      if (t.slots.some((s) => s.options.some((o) => o.exerciseId === exercise.id))) out.push(t.name);
    }
    return out;
  }, [program, exercise.id]);

  return (
    <div className="exercise-editor">
      <div className="grid grid-3">
        <TextField
          label="Nom"
          className="span-2"
          required
          value={exercise.name}
          onSave={(name) => name && run((db) => updateExercise(db, exercise.id, { name }))}
        />
        <SelectField label="Type" value={exercise.kind} options={KIND_OPTIONS} onSave={(kind) => run((db) => updateExercise(db, exercise.id, { kind }))} />
      </div>
      <TextField
        label="Matériel"
        value={exercise.equipment}
        placeholder="ex. Haltères, Poulie, Machine"
        onSave={(equipment) => run((db) => updateExercise(db, exercise.id, { equipment }))}
      />
      <MusclePicker
        groups={groups}
        value={exercise.muscles}
        onChange={(muscles) => run((db) => updateExercise(db, exercise.id, { muscles }))}
      />
      <TextArea
        label="Notes techniques"
        rows={6}
        value={exercise.techniqueNotes}
        placeholder="Placement, amplitude, points de vigilance…"
        onSave={(techniqueNotes) => run((db) => updateExercise(db, exercise.id, { techniqueNotes }))}
      />
      <p className="muted">
        {usages.length > 0 ? `Utilisé dans : ${usages.join(', ')}.` : "Pas utilisé dans le programme actif."}{' '}
        Médias et historique : phase 2.
      </p>
      <div className="row">
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() =>
            void run(
              (db) => setExerciseArchived(db, exercise.id, !exercise.isArchived),
              exercise.isArchived ? 'Exercice restauré.' : 'Exercice archivé.',
            )
          }
        >
          {exercise.isArchived ? 'Restaurer' : 'Archiver'}
        </button>
      </div>
    </div>
  );
}

/** Clic sur un muscle : aucun → principal → secondaire → aucun. */
function MusclePicker(props: { groups: MuscleGroup[]; value: ExerciseMuscle[]; onChange: (v: ExerciseMuscle[]) => unknown }) {
  const roleOf = (id: string) => props.value.find((m) => m.muscleGroupId === id)?.role;
  const cycle = (id: string) => {
    const role = roleOf(id);
    const rest = props.value.filter((m) => m.muscleGroupId !== id);
    if (!role) return props.onChange([...rest, { muscleGroupId: id, role: 'primary' }]);
    if (role === 'primary') return props.onChange([...rest, { muscleGroupId: id, role: 'secondary' }]);
    return props.onChange(rest);
  };
  return (
    <fieldset className="field muscle-picker">
      <legend>Muscles <small>(clic : principal → secondaire → aucun)</small></legend>
      <div className="chips">
        {props.groups.map((g) => {
          const role = roleOf(g.id);
          return (
            <button
              key={g.id}
              type="button"
              className={`chip ${role ? `chip-${role}` : ''}`}
              aria-pressed={!!role}
              onClick={() => void cycle(g.id)}
            >
              {g.name}
              {role === 'secondary' && <small> (2ᵉ)</small>}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
