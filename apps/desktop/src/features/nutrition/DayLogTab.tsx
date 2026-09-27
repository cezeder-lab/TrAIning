import {
  DAY_TYPE_LABELS,
  copyDay,
  createSavedMealFromEntries,
  deleteFoodEntry,
  formatNumber,
  logSavedMeal,
  setDayType,
  updateFoodEntry,
  type DayLog,
  type DayType,
  type FoodEntry,
  type MacroTotals,
} from '@training/core';
import { useState } from 'react';
import { Modal } from '../../components/Modal.tsx';
import { PromptDialog } from '../../components/PromptDialog.tsx';
import { NumberField } from '../../components/fields.tsx';
import { useAction } from '../../lib/app.tsx';
import { addDays, formatLongDate, today } from '../../lib/dates.ts';
import { useDayLog, useSavedMeals } from '../../lib/queries.ts';
import { AddFoodDialog } from './AddFoodDialog.tsx';
import { SOURCE_LABELS } from './labels.ts';

const METERS: { key: keyof MacroTotals; label: string; unit: string }[] = [
  { key: 'kcal', label: 'Énergie', unit: 'kcal' },
  { key: 'proteinG', label: 'Protéines', unit: 'g' },
  { key: 'carbsG', label: 'Glucides', unit: 'g' },
  { key: 'fatG', label: 'Lipides', unit: 'g' },
  { key: 'fiberG', label: 'Fibres', unit: 'g' },
];

export function DayLogTab() {
  const [date, setDate] = useState(today());
  const { data: log } = useDayLog(date);
  const run = useAction();
  const [adding, setAdding] = useState<{ id: string; name: string } | null>(null);
  const [savedFor, setSavedFor] = useState<{ id: string; name: string } | null>(null);
  const [saveMeal, setSaveMeal] = useState<{ id: string; entries: FoodEntry[] } | null>(null);

  return (
    <div className="daylog">
      <div className="date-nav">
        <button type="button" className="btn-icon" aria-label="Jour précédent" onClick={() => setDate(addDays(date, -1))}>
          ‹
        </button>
        <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="Date" />
        <button type="button" className="btn-icon" aria-label="Jour suivant" onClick={() => setDate(addDays(date, 1))}>
          ›
        </button>
        <strong className="date-label">{formatLongDate(date)}</strong>
        {date !== today() && (
          <button type="button" className="btn btn-ghost" onClick={() => setDate(today())}>
            Aujourd'hui
          </button>
        )}
        <div className="spacer" />
        <button type="button" className="btn" onClick={() => void run((db) => copyDay(db, addDays(date, -1), date), 'Journée de la veille recopiée.')}>
          Copier la veille
        </button>
      </div>

      {log && <DayHeader log={log} onDayType={(t) => run((db) => setDayType(db, date, t))} />}

      {log?.meals.map((m) => (
        <section key={m.category.id} className="card meal">
          <div className="meal-head">
            <h2>{m.category.name}</h2>
            <span className="muted">
              {formatNumber(m.totals.kcal, 0)} kcal · P {formatNumber(m.totals.proteinG, 0)} g
            </span>
            <div className="spacer" />
            {m.entries.length > 0 && (
              <button type="button" className="btn-link" onClick={() => setSaveMeal({ id: m.category.id, entries: m.entries })}>
                Enregistrer ce repas
              </button>
            )}
            <button type="button" className="btn btn-ghost" onClick={() => setSavedFor({ id: m.category.id, name: m.category.name })}>
              Repas enregistrés
            </button>
            <button type="button" className="btn btn-primary" onClick={() => setAdding({ id: m.category.id, name: m.category.name })}>
              + Ajouter
            </button>
          </div>
          {m.entries.length > 0 && (
            <table className="data-table entries">
              <tbody>
                {m.entries.map((e) => (
                  <EntryRow key={e.id} e={e} />
                ))}
              </tbody>
            </table>
          )}
        </section>
      ))}

      {adding && <AddFoodDialog date={date} mealId={adding.id} mealName={adding.name} onClose={() => setAdding(null)} />}
      {savedFor && <SavedMealsDialog date={date} meal={savedFor} onClose={() => setSavedFor(null)} />}
      {saveMeal && (
        <PromptDialog
          title="Enregistrer ce repas"
          label="Nom du repas (ex. Petit-déj habituel)"
          confirmLabel="Enregistrer"
          onClose={() => setSaveMeal(null)}
          onSubmit={(name) => run((db) => createSavedMealFromEntries(db, name, saveMeal.entries.map((e) => e.id), saveMeal.id), 'Repas enregistré.')}
        />
      )}
    </div>
  );
}

function DayHeader({ log, onDayType }: { log: DayLog; onDayType: (t: DayType | null) => unknown }) {
  return (
    <section className="card day-header">
      <div className="row">
        <span className="field-label">Type de jour</span>
        <div className="segmented" role="radiogroup" aria-label="Type de jour">
          {(['rest', 'training', 'cardio'] as const).map((t) => (
            <button
              key={t}
              type="button"
              role="radio"
              aria-checked={log.dayType === t}
              className={log.dayType === t ? 'is-selected' : ''}
              onClick={() => onDayType(t)}
            >
              {DAY_TYPE_LABELS[t]}
            </button>
          ))}
        </div>
        {log.dayTypeManual ? (
          <button type="button" className="btn-link" onClick={() => onDayType(null)}>
            Détection automatique
          </button>
        ) : (
          <span className="muted small">détecté d'après le journal d'entraînement</span>
        )}
        {log.estimatedCount > 0 && <span className="badge badge-estimate">{log.estimatedCount} entrée(s) estimée(s)</span>}
      </div>
      <div className="meters">
        {METERS.map((m) => {
          const goal = log.goal?.[m.key] ?? null;
          const value = log.totals[m.key];
          const ratio = goal ? value / goal : 0;
          return (
            <div key={m.key} className="meter">
              <div className="meter-label">
                <span>{m.label}</span>
                <strong>
                  {formatNumber(value, 0)}
                  {goal != null && <span className="muted"> / {formatNumber(goal, 0)}</span>} {m.unit}
                </strong>
              </div>
              <div className="meter-track">
                <div className={`meter-fill ${ratio > 1.1 ? 'is-over' : ''}`} style={{ width: `${Math.min(ratio, 1) * 100}%` }} />
              </div>
              {goal != null && (
                <span className="muted small">
                  {value <= goal ? `reste ${formatNumber(goal - value, 0)} ${m.unit}` : `+${formatNumber(value - goal, 0)} ${m.unit}`}
                </span>
              )}
            </div>
          );
        })}
      </div>
      {!log.goal && <p className="muted small">Aucun objectif défini : onglet « Objectifs ».</p>}
    </section>
  );
}

function EntryRow({ e }: { e: FoodEntry }) {
  const run = useAction();
  const unit = e.unit === 'portion' ? (e.portionLabel ?? 'portion') : e.unit;
  return (
    <tr>
      <td className="entry-name">
        {e.label}
        <div className="entry-badges">
          <span className={`badge badge-source badge-${e.source}`}>{SOURCE_LABELS[e.source]}</span>
          {e.isEstimated && <span className="badge badge-estimate">estimé</span>}
          {e.createdVia === 'mcp' && <span className="badge badge-optional">via Claude</span>}
          {e.weightState !== 'na' && <span className="muted small">pesé {e.weightState === 'raw' ? 'cru' : 'cuit'}</span>}
        </div>
      </td>
      <td className="entry-qty">
        <NumberField label={`Quantité de ${e.label}`} className="label-hidden compact" min={0.01} value={e.quantity} onSave={(q) => q && run((db) => updateFoodEntry(db, e.id, { quantity: q }))} />
        <span className="muted small">{unit === 'g' || unit === 'ml' ? unit : `× ${unit}`}</span>
      </td>
      <td className="num">
        <strong>{formatNumber(e.kcal, 0)}</strong> kcal
      </td>
      <td className="num muted">
        P {formatNumber(e.proteinG, 1)} · G {formatNumber(e.carbsG, 1)} · L {formatNumber(e.fatG, 1)}
      </td>
      <td>
        <button type="button" className="btn-icon btn-danger-text" aria-label={`Supprimer ${e.label}`} onClick={() => void run((db) => deleteFoodEntry(db, e.id))}>
          ✕
        </button>
      </td>
    </tr>
  );
}

function SavedMealsDialog({ date, meal, onClose }: { date: string; meal: { id: string; name: string }; onClose: () => void }) {
  const { data: meals = [] } = useSavedMeals();
  const run = useAction();
  return (
    <Modal title={`Repas enregistrés → ${meal.name}`} onClose={onClose} width={560}>
      {meals.length === 0 && <p className="muted">Aucun repas enregistré. Utilisez « Enregistrer ce repas » sur un repas du journal.</p>}
      <ul className="day-items">
        {meals.map((m) => (
          <li key={m.id}>
            <button
              type="button"
              className="day-item"
              onClick={async () => {
                if (await run((db) => logSavedMeal(db, m.id, date, meal.id), `${m.name} ajouté.`)) onClose();
              }}
            >
              <strong>{m.name}</strong>
              <small>
                {m.items.map((i) => i.foodName).join(', ')} — {formatNumber(m.totals.kcal, 0)} kcal · P {formatNumber(m.totals.proteinG, 0)} g
              </small>
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
