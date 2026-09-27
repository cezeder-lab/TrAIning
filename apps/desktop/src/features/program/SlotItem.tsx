import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  deleteSlot,
  duplicateSlot,
  effectiveTargets,
  formatLoad,
  formatRest,
  formatRir,
  formatTarget,
  slotTitle,
  updateSlot,
  type SlotPatch,
  type TemplateSlot,
} from '@training/core';
import type { KeyboardEvent } from 'react';
import { NumberField, SelectField, TextArea, TextField, Toggle } from '../../components/fields.tsx';
import { useAction, useApp } from '../../lib/app.tsx';
import { BLOCK_OPTIONS, UNIT_OPTIONS } from '../../lib/labels.ts';
import { OptionsEditor } from './OptionsEditor.tsx';

export function SlotItem(props: {
  slot: TemplateSlot;
  index: number;
  expanded: boolean;
  onToggle: () => void;
  onMove: (delta: number) => void;
}) {
  const { slot } = props;
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: slot.id,
  });

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      props.onToggle();
    } else if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      props.onMove(e.key === 'ArrowUp' ? -1 : 1);
      // Le focus suit la ligne déplacée après le rendu.
      const id = slot.id;
      requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-slot-row="${id}"]`)?.focus());
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const rows = Array.from(document.querySelectorAll<HTMLElement>('[data-slot-row]'));
      const i = rows.indexOf(e.currentTarget);
      rows[i + (e.key === 'ArrowUp' ? -1 : 1)]?.focus();
    }
  };

  const classes = [
    'slot',
    slot.isOptional && 'is-optional',
    slot.isOptional && !slot.enabledByDefault && 'is-disabled',
    props.expanded && 'is-expanded',
    isDragging && 'is-dragging',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <li ref={setNodeRef} className={classes} style={{ transform: CSS.Translate.toString(transform), transition }}>
      <div
        className="slot-row"
        role="button"
        tabIndex={0}
        aria-expanded={props.expanded}
        data-slot-row={slot.id}
        onClick={props.onToggle}
        onKeyDown={onKeyDown}
      >
        <button
          type="button"
          ref={setActivatorNodeRef}
          className="drag-handle"
          aria-label={`Déplacer ${slotTitle(slot)} (Espace puis flèches)`}
          onClick={(e) => e.stopPropagation()}
          {...attributes}
          {...listeners}
        >
          ⋮⋮
        </button>
        <span className="slot-index">{props.index + 1}</span>
        <SlotSummary slot={slot} />
        <span className="slot-chevron" aria-hidden>
          {props.expanded ? '▾' : '▸'}
        </span>
      </div>
      {props.expanded && <SlotEditor slot={slot} />}
    </li>
  );
}

function SlotSummary({ slot }: { slot: TemplateSlot }) {
  const main = slot.options[0];
  const t = effectiveTargets(slot, main);
  const load = formatLoad(t.loadKg, t.loadNextKg);
  const names = slot.options.map((o) => o.exerciseName);
  const alternatives = slot.label ? names : names.slice(1);
  const loadNote = [slot.loadNote, main?.note].filter(Boolean).join(' · ');
  return (
    <div className="slot-summary">
      <div className="slot-line">
        <span className="slot-title">{slotTitle(slot)}</span>
        {slot.isOptional && (
          <span className="badge badge-optional">{slot.enabledByDefault ? 'Optionnel' : 'Optionnel · désactivé'}</span>
        )}
      </div>
      {alternatives.length > 0 && (
        <div className="slot-alternatives">
          {alternatives.map((n, i) => (
            <span key={n}>
              {(i > 0 || !slot.label) && <em> ou </em>}
              {n}
            </span>
          ))}
        </div>
      )}
      {slot.comment && <div className="slot-comment">{slot.comment}</div>}
      <div className="slot-metrics">
        <span className="metric-target">{formatTarget(t, slot.targetUnit, slot.perSide)}</span>
        {load && <span className="metric-load">{load}</span>}
        {loadNote && <span className="metric-note">{loadNote}</span>}
        {formatRir(slot.rirMin, slot.rirMax) && <span className="metric-note">{formatRir(slot.rirMin, slot.rirMax)}</span>}
        {slot.restS != null && <span className="metric-note">repos {formatRest(slot.restS)}</span>}
      </div>
    </div>
  );
}

function SlotEditor({ slot }: { slot: TemplateSlot }) {
  const run = useAction();
  const { confirm } = useApp();
  const save = (patch: SlotPatch) => run((db) => updateSlot(db, slot.id, patch));

  const remove = async () => {
    const ok = await confirm({
      title: 'Supprimer le slot',
      message: `Retirer « ${slotTitle(slot)} » de cette séance ?`,
      confirmLabel: 'Supprimer',
      danger: true,
    });
    if (ok) await run((db) => deleteSlot(db, slot.id));
  };

  return (
    <div className="slot-editor">
      <div className="grid grid-3">
        <TextField
          label="Libellé du slot"
          value={slot.label}
          placeholder={slot.options[0]?.exerciseName}
          hint="Utile avec des alternatives (ex. « Tirage horizontal »)."
          onSave={(label) => save({ label })}
        />
        <SelectField label="Bloc" value={slot.block} options={BLOCK_OPTIONS} onSave={(block) => save({ block })} />
        <TextField
          label="Sous-titre du bloc"
          value={slot.blockLabel}
          placeholder="ex. Gainage / posture"
          onSave={(blockLabel) => save({ blockLabel })}
        />
      </div>

      <div className="grid grid-6">
        <NumberField label="Séries" integer min={0} max={50} value={slot.sets} onSave={(sets) => save({ sets })} />
        <NumberField label="Cible min" min={0} value={slot.targetMin} onSave={(targetMin) => save({ targetMin })} />
        <NumberField label="Cible max" min={0} value={slot.targetMax} onSave={(targetMax) => save({ targetMax })} />
        <SelectField label="Unité" value={slot.targetUnit} options={UNIT_OPTIONS} onSave={(targetUnit) => save({ targetUnit })} />
        <NumberField label="Repos" integer min={0} max={3600} suffix="s" value={slot.restS} onSave={(restS) => save({ restS })} />
        <div className="field field-toggle">
          <Toggle label="Par côté" checked={slot.perSide} onChange={(perSide) => save({ perSide })} />
        </div>
      </div>

      <div className="grid grid-6">
        <NumberField label="Charge" min={0} max={1000} suffix="kg" value={slot.loadKg} onSave={(loadKg) => save({ loadKg })} />
        <NumberField label="Palier visé" min={0} max={1000} suffix="kg" value={slot.loadNextKg} onSave={(loadNextKg) => save({ loadNextKg })} />
        <TextField label="Note de charge" className="span-2" value={slot.loadNote} placeholder="ex. poids du corps" onSave={(loadNote) => save({ loadNote })} />
        <NumberField label="RIR min" integer min={0} max={10} value={slot.rirMin} onSave={(rirMin) => save({ rirMin })} />
        <NumberField label="RIR max" integer min={0} max={10} value={slot.rirMax} onSave={(rirMax) => save({ rirMax })} />
      </div>

      <TextArea label="Commentaire" rows={2} value={slot.comment} onSave={(comment) => save({ comment })} />

      <div className="slot-toggles">
        <Toggle
          label="Optionnel"
          hint="Affiché grisé, non compté dans les statistiques s'il n'est pas fait."
          checked={slot.isOptional}
          onChange={(isOptional) => save(isOptional ? { isOptional } : { isOptional, enabledByDefault: true })}
        />
        <Toggle
          label="Activé par défaut"
          hint="Désactivé : proposé dans la séance, mais décoché d'office."
          checked={slot.enabledByDefault}
          disabled={!slot.isOptional}
          onChange={(enabledByDefault) => save({ enabledByDefault })}
        />
      </div>

      <OptionsEditor slot={slot} />

      <div className="slot-editor-footer">
        <button type="button" className="btn btn-ghost" onClick={() => void run((db) => duplicateSlot(db, slot.id))}>
          Dupliquer le slot
        </button>
        <button type="button" className="btn btn-ghost btn-danger-text" onClick={() => void remove()}>
          Supprimer le slot
        </button>
      </div>
    </div>
  );
}
