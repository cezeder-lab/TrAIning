import {
  addSet,
  completeAllSets,
  formatLoad,
  formatNumber,
  formatRir,
  formatTarget,
  removeSessionExercise,
  removeSet,
  switchSessionAlternative,
  updateSession,
  updateSessionExercise,
  updateSet,
  type SessionExercise,
  type SetEntry,
  type WorkoutSession,
} from '@training/core';
import { useEffect, useState } from 'react';
import { NumberField, TextField } from '../../components/fields.tsx';
import { useAction, useApp } from '../../lib/app.tsx';
import { formatShortDate } from '../../lib/dates.ts';
import { useLastPerformance } from '../../lib/queries.ts';
import { ExerciseDetailModal } from '../exercises/ExerciseDetail.tsx';

const VALUE_LABEL: Record<string, string> = { reps: 'Reps', s: 'Secondes', m: 'Mètres', min: 'Minutes' };
const UNIT: Record<string, string> = { reps: '', s: ' s', m: ' m', min: ' min' };

export function SessionExerciseCard({ session, se }: { session: WorkoutSession; se: SessionExercise }) {
  const run = useAction();
  const { confirm } = useApp();
  const [detail, setDetail] = useState(false);
  const { data: last } = useLastPerformance(se.exerciseId, session.date, session.id);

  const title = se.label ?? se.exerciseName;
  const plan = [
    formatTarget(se, se.targetUnit, se.perSide),
    formatLoad(se.loadKg, null),
    se.loadNote,
    formatRir(se.rirMin, se.rirMax),
  ]
    .filter(Boolean)
    .join(' · ');

  if (se.isOptional && !se.isEnabled) {
    return (
      <li className="session-card is-disabled">
        <div className="session-card-head">
          <div>
            <span className="session-card-title">{title}</span> <span className="badge badge-optional">Optionnel · non prévu</span>
            <div className="muted small">{plan}</div>
          </div>
          <button type="button" className="btn" onClick={() => void run((db) => updateSessionExercise(db, se.id, { isEnabled: true }))}>
            Je l'ai fait
          </button>
        </div>
      </li>
    );
  }

  /** Cocher une série : la séance passe automatiquement à « Faite ». */
  const toggleDone = async (s: SetEntry, isDone: boolean) => {
    await run(async (db) => {
      await updateSet(db, s.id, { isDone });
      if (isDone && session.status === 'planned') await updateSession(db, session.id, { status: 'done', startedAt: session.startedAt ?? new Date().toISOString() });
    });
  };

  const allDone = se.setEntries.length > 0 && se.setEntries.every((s) => s.isDone);
  const loadLabel = se.exerciseKind === 'bodyweight' ? 'Lest (kg)' : 'Charge (kg)';

  return (
    <li className={`session-card ${se.isOptional ? 'is-optional' : ''} ${allDone ? 'is-complete' : ''}`}>
      <div className="session-card-head">
        <div className="session-card-titles">
          <div className="row">
            <span className="session-card-title">{title}</span>
            {se.isOptional && <span className="badge badge-optional">Optionnel</span>}
          </div>
          {se.alternatives.length > 1 ? (
            <select
              className="alt-select"
              aria-label="Alternative réalisée"
              value={se.exerciseId}
              onChange={(e) => void run((db) => switchSessionAlternative(db, se.id, e.target.value))}
            >
              {se.alternatives.map((a) => (
                <option key={a.exerciseId} value={a.exerciseId}>
                  {a.name}
                </option>
              ))}
            </select>
          ) : (
            se.label && <div className="muted small">{se.exerciseName}</div>
          )}
          <div className="plan-line">
            <span className="muted">Prévu :</span> {plan || '—'}
          </div>
          {last && (
            <div className="plan-line">
              <span className="muted">Dernière fois ({formatShortDate(last.date)}) :</span>{' '}
              {last.sets.map((s) => `${s.loadKg != null ? `${formatNumber(s.loadKg)}×` : ''}${s.value != null ? formatNumber(s.value) : '?'}`).join(' · ')}
              {UNIT[se.targetUnit]}
            </div>
          )}
          {se.plannedComment && <div className="slot-comment">{se.plannedComment}</div>}
        </div>
        <div className="session-card-actions">
          <button type="button" className="btn btn-ghost" onClick={() => setDetail(true)} title="Médias, notes techniques, historique">
            Fiche
          </button>
          <button type="button" className="btn" onClick={() => void run((db) => completeAllSets(db, se.id, !allDone))}>
            {allDone ? 'Tout décocher' : 'Tout cocher'}
          </button>
        </div>
      </div>

      <table className="sets-table">
        <thead>
          <tr>
            <th>Série</th>
            <th>{loadLabel}</th>
            <th>{VALUE_LABEL[se.targetUnit]}</th>
            <th>RIR</th>
            <th>Fait</th>
            <th aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {se.setEntries.map((s) => (
            <tr key={s.id} className={s.isDone ? 'is-done' : ''}>
              <td className="set-index">{s.setIndex + 1}</td>
              <td>
                <NumberField label={`${loadLabel} série ${s.setIndex + 1}`} className="label-hidden compact" min={0} max={1000} value={s.loadKg} onSave={(loadKg) => run((db) => updateSet(db, s.id, { loadKg }))} />
              </td>
              <td>
                <NumberField label={`${VALUE_LABEL[se.targetUnit]} série ${s.setIndex + 1}`} className="label-hidden compact" min={0} value={s.value} onSave={(value) => run((db) => updateSet(db, s.id, { value }))} />
              </td>
              <td>
                <NumberField label={`RIR série ${s.setIndex + 1}`} className="label-hidden compact" min={0} max={10} value={s.rir} onSave={(rir) => run((db) => updateSet(db, s.id, { rir }))} />
              </td>
              <td>
                <SetCheck label={`Série ${s.setIndex + 1} faite`} checked={s.isDone} onChange={(v) => toggleDone(s, v)} />
              </td>
              <td>
                <button type="button" className="btn-icon" aria-label={`Supprimer la série ${s.setIndex + 1}`} onClick={() => void run((db) => removeSet(db, s.id))}>
                  ✕
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="session-card-foot">
        <button type="button" className="btn-link" onClick={() => void run((db) => addSet(db, se.id))}>
          + Série
        </button>
        <TextField label="Note" className="label-hidden session-note" value={se.note} placeholder="Note sur cet exercice…" onSave={(note) => run((db) => updateSessionExercise(db, se.id, { note }))} />
        {se.isOptional ? (
          <button type="button" className="btn-link" onClick={() => void run((db) => updateSessionExercise(db, se.id, { isEnabled: false }))}>
            Pas fait
          </button>
        ) : (
          <button
            type="button"
            className="btn-link btn-danger-text"
            onClick={async () => {
              if (await confirm({ title: 'Retirer l’exercice', message: `Retirer « ${title} » de cette séance ?`, confirmLabel: 'Retirer', danger: true }))
                await run((db) => removeSessionExercise(db, se.id));
            }}
          >
            Retirer
          </button>
        )}
      </div>
      {detail && <ExerciseDetailModal exerciseId={se.exerciseId} onClose={() => setDetail(false)} />}
    </li>
  );
}

/** Case « fait » : réagit immédiatement, puis se resynchronise avec la base. */
function SetCheck(props: { label: string; checked: boolean; onChange: (v: boolean) => Promise<unknown> }) {
  const [checked, setChecked] = useState(props.checked);
  useEffect(() => setChecked(props.checked), [props.checked]);
  return (
    <input
      type="checkbox"
      className="set-check"
      aria-label={props.label}
      checked={checked}
      onChange={(e) => {
        setChecked(e.target.checked);
        void props.onChange(e.target.checked);
      }}
    />
  );
}
