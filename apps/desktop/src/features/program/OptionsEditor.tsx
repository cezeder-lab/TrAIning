import {
  addSlotOption,
  formatNumber,
  removeSlotOption,
  reorderSlotOptions,
  replaceOptionExercise,
  updateSlotOption,
  type OptionPatch,
  type SlotOption,
  type TemplateSlot,
} from '@training/core';
import { useState } from 'react';
import { ExercisePicker } from '../../components/ExercisePicker.tsx';
import { NumberField, TextField } from '../../components/fields.tsx';
import { useAction } from '../../lib/app.tsx';
import { moveItem } from './programCache.ts';

type PickerMode = { kind: 'add' } | { kind: 'replace'; option: SlotOption };

/** Alternatives d'un slot : la première est le choix par défaut. */
export function OptionsEditor({ slot }: { slot: TemplateSlot }) {
  const run = useAction();
  const [picker, setPicker] = useState<PickerMode | null>(null);
  const options = slot.options;

  const move = (from: number, to: number) =>
    run((db) => reorderSlotOptions(db, slot.id, moveItem(options, from, to).map((o) => o.id)));

  const inherit = (v: number | null, suffix = '') => (v == null ? '—' : `${formatNumber(v)}${suffix}`);

  return (
    <div className="options-editor">
      <div className="options-header">
        <h4>Exercices {options.length > 1 ? `(${options.length} alternatives au choix)` : ''}</h4>
        <span className="muted">Surcharges vides = valeurs du slot</span>
      </div>
      <ul className="options-list">
        {options.map((o, i) => (
          <OptionRow
            key={o.id}
            option={o}
            isDefault={i === 0}
            placeholders={{
              sets: inherit(slot.sets),
              targetMin: inherit(slot.targetMin),
              targetMax: inherit(slot.targetMax),
              loadKg: inherit(slot.loadKg),
              loadNextKg: inherit(slot.loadNextKg),
            }}
            canRemove={options.length > 1}
            onSave={(patch) => run((db) => updateSlotOption(db, o.id, patch))}
            onMakeDefault={() => void move(i, 0)}
            onUp={i > 0 ? () => void move(i, i - 1) : undefined}
            onDown={i < options.length - 1 ? () => void move(i, i + 1) : undefined}
            onReplace={() => setPicker({ kind: 'replace', option: o })}
            onRemove={() => void run((db) => removeSlotOption(db, o.id))}
          />
        ))}
      </ul>
      <button type="button" className="btn btn-ghost" onClick={() => setPicker({ kind: 'add' })}>
        + Ajouter une alternative
      </button>
      {picker && (
        <ExercisePicker
          title={picker.kind === 'add' ? 'Ajouter une alternative' : `Remplacer « ${picker.option.exerciseName} »`}
          excludeIds={options.map((o) => o.exerciseId)}
          onPick={(exerciseId) =>
            run(async (db) => {
              if (picker.kind === 'add') await addSlotOption(db, slot.id, exerciseId);
              else await replaceOptionExercise(db, picker.option.id, exerciseId);
            })
          }
          onClose={() => setPicker(null)}
        />
      )}
    </div>
  );
}

function OptionRow(props: {
  option: SlotOption;
  isDefault: boolean;
  placeholders: Record<'sets' | 'targetMin' | 'targetMax' | 'loadKg' | 'loadNextKg', string>;
  canRemove: boolean;
  onSave: (patch: OptionPatch) => unknown;
  onMakeDefault: () => void;
  onUp?: () => void;
  onDown?: () => void;
  onReplace: () => void;
  onRemove: () => void;
}) {
  const { option: o, placeholders: ph } = props;
  return (
    <li className="option-row">
      <div className="option-head">
        {props.isDefault ? (
          <span className="badge badge-default">Par défaut</span>
        ) : (
          <button type="button" className="btn-link" onClick={props.onMakeDefault}>
            Mettre par défaut
          </button>
        )}
        <button type="button" className="option-name" onClick={props.onReplace} title="Changer d'exercice">
          {o.exerciseName}
        </button>
        <div className="spacer" />
        <button type="button" className="btn-icon" aria-label="Monter" disabled={!props.onUp} onClick={props.onUp}>
          ↑
        </button>
        <button type="button" className="btn-icon" aria-label="Descendre" disabled={!props.onDown} onClick={props.onDown}>
          ↓
        </button>
        <button
          type="button"
          className="btn-icon btn-danger-text"
          aria-label={`Retirer ${o.exerciseName}`}
          disabled={!props.canRemove}
          title={props.canRemove ? 'Retirer cette alternative' : 'Un slot garde au moins un exercice'}
          onClick={props.onRemove}
        >
          ✕
        </button>
      </div>
      <div className="grid grid-6 option-overrides">
        <NumberField label="Séries" integer min={0} max={50} placeholder={ph.sets} value={o.sets} onSave={(sets) => props.onSave({ sets })} />
        <NumberField label="Cible min" min={0} placeholder={ph.targetMin} value={o.targetMin} onSave={(targetMin) => props.onSave({ targetMin })} />
        <NumberField label="Cible max" min={0} placeholder={ph.targetMax} value={o.targetMax} onSave={(targetMax) => props.onSave({ targetMax })} />
        <NumberField label="Charge" min={0} suffix="kg" placeholder={ph.loadKg} value={o.loadKg} onSave={(loadKg) => props.onSave({ loadKg })} />
        <NumberField label="Palier visé" min={0} suffix="kg" placeholder={ph.loadNextKg} value={o.loadNextKg} onSave={(loadNextKg) => props.onSave({ loadNextKg })} />
        <TextField label="Note" value={o.note} placeholder="ex. 1RM ~120 kg" onSave={(note) => props.onSave({ note })} />
      </div>
    </li>
  );
}
