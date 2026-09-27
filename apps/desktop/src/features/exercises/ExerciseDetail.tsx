import {
  setExerciseArchived,
  updateExercise,
  type Exercise,
  type ExerciseMuscle,
  type MuscleGroup,
} from '@training/core';
import { useMemo, useState } from 'react';
import { Modal } from '../../components/Modal.tsx';
import { SelectField, TextArea, TextField } from '../../components/fields.tsx';
import { useAction } from '../../lib/app.tsx';
import { KIND_OPTIONS } from '../../lib/labels.ts';
import { useActiveProgram, useExercises, useMuscleGroups } from '../../lib/queries.ts';
import { ExerciseHistoryTab } from './ExerciseHistoryTab.tsx';
import { ExerciseMediaTab } from './ExerciseMediaTab.tsx';

type Tab = 'fiche' | 'medias' | 'historique';
const TABS: { id: Tab; label: string }[] = [
  { id: 'fiche', label: 'Fiche' },
  { id: 'medias', label: 'Médias' },
  { id: 'historique', label: 'Historique' },
];

/** Sous-menu d'un exercice : fiche, médias d'exemple, historique. */
export function ExerciseDetail({ exercise, initialTab = 'fiche' }: { exercise: Exercise; initialTab?: Tab }) {
  const [tab, setTab] = useState<Tab>(initialTab);
  return (
    <div className="exercise-detail card">
      <div className="subtabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'is-selected' : ''} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'fiche' && <ExerciseFicheTab exercise={exercise} />}
      {tab === 'medias' && <ExerciseMediaTab exercise={exercise} />}
      {tab === 'historique' && <ExerciseHistoryTab exercise={exercise} />}
    </div>
  );
}

export function ExerciseDetailModal(props: { exerciseId: string; initialTab?: Tab; onClose: () => void }) {
  const { data: exercises = [] } = useExercises();
  const exercise = exercises.find((e) => e.id === props.exerciseId);
  return (
    <Modal title={exercise?.name ?? 'Exercice'} onClose={props.onClose} width={860}>
      {exercise ? <ExerciseDetail exercise={exercise} initialTab={props.initialTab} /> : <p className="muted">Chargement…</p>}
    </Modal>
  );
}

function ExerciseFicheTab({ exercise }: { exercise: Exercise }) {
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
    <div className="exercise-fiche">
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
        {usages.length > 0 ? `Utilisé dans : ${usages.join(', ')}.` : 'Pas utilisé dans le programme actif.'}
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
