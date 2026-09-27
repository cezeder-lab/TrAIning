import { DAY_TYPE_LABELS, setGoal, type GoalDayType } from '@training/core';
import { NumberField } from '../../components/fields.tsx';
import { useAction } from '../../lib/app.tsx';
import { today } from '../../lib/dates.ts';
import { useGoalsAt } from '../../lib/queries.ts';

const TYPES: GoalDayType[] = ['default', 'rest', 'training', 'cardio'];
const FIELDS = [
  { key: 'kcal', label: 'kcal', max: 10000 },
  { key: 'proteinG', label: 'Protéines (g)', max: 1000 },
  { key: 'carbsG', label: 'Glucides (g)', max: 2000 },
  { key: 'fatG', label: 'Lipides (g)', max: 1000 },
  { key: 'fiberG', label: 'Fibres (g)', max: 200 },
] as const;

export function GoalsTab() {
  const { data: goals = {} } = useGoalsAt(today());
  const run = useAction();
  return (
    <section className="card">
      <h2>Objectifs quotidiens</h2>
      <p className="muted">
        « Par défaut » s'applique quand un type de jour n'a pas d'objectif propre. Le type de jour est déduit du journal d'entraînement (séance → musculation,
        cardio seul → cardio, sinon repos) et peut être forcé dans le journal. Une modification s'applique à partir d'aujourd'hui : les jours passés gardent
        leurs objectifs.
      </p>
      <table className="data-table goals-table">
        <thead>
          <tr>
            <th>Type de jour</th>
            {FIELDS.map((f) => (
              <th key={f.key}>{f.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {TYPES.map((t) => (
            <tr key={t}>
              <td>
                <strong>{DAY_TYPE_LABELS[t]}</strong>
              </td>
              {FIELDS.map((f) => (
                <td key={f.key}>
                  <NumberField
                    label={`${f.label} ${DAY_TYPE_LABELS[t]}`}
                    className="label-hidden compact"
                    min={0}
                    max={f.max}
                    placeholder={t === 'default' ? '—' : 'défaut'}
                    value={goals[t]?.[f.key] ?? null}
                    onSave={(v) => run((db) => setGoal(db, t, { [f.key]: v }, today()))}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
