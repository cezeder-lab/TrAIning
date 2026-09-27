import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable';
import {
  BLOCK_LABELS,
  createSlot,
  deleteTemplate,
  duplicateTemplate,
  reorderSlots,
  updateTemplate,
  type TemplateSlot,
  type WorkoutTemplate,
} from '@training/core';
import { useQueryClient } from '@tanstack/react-query';
import { Fragment, useEffect, useState } from 'react';
import { ExercisePicker } from '../../components/ExercisePicker.tsx';
import { InlineTitle } from '../../components/InlineTitle.tsx';
import { TextArea } from '../../components/fields.tsx';
import { useAction, useApp } from '../../lib/app.tsx';
import { moveItem, patchProgramCache } from './programCache.ts';
import { SlotItem } from './SlotItem.tsx';

const groupKey = (s: TemplateSlot) => `${s.block}|${s.blockLabel ?? ''}`;

export function TemplateEditor({ template }: { template: WorkoutTemplate }) {
  const run = useAction();
  const qc = useQueryClient();
  const { confirm } = useApp();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const slots = template.slots;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const reorder = (from: number, to: number) => {
    if (to < 0 || to >= slots.length || from === to) return;
    const ordered = moveItem(slots, from, to);
    patchProgramCache(qc, (p) => ({
      ...p,
      templates: p.templates.map((t) => (t.id === template.id ? { ...t, slots: ordered } : t)),
    }));
    void run((db) => reorderSlots(db, template.id, ordered.map((s) => s.id)));
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    reorder(
      slots.findIndex((s) => s.id === active.id),
      slots.findIndex((s) => s.id === over.id),
    );
  };

  // Ctrl+N : ajouter un exercice à la séance affichée.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        setPicking(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const addSlot = async (exerciseId: string) => {
    const afterSlotId = expandedId ?? slots.at(-1)?.id ?? null;
    const lastBlock = slots.at(-1)?.block;
    const id = await run((db) =>
      createSlot(db, template.id, {
        exerciseId,
        afterSlotId,
        // En fin de séance après un retour au calme / finisher, on repasse en « travail ».
        block: !expandedId && (lastBlock === 'cooldown' || lastBlock === 'finisher') ? 'work' : undefined,
      }),
    );
    if (id) setExpandedId(id);
  };

  const remove = async () => {
    const ok = await confirm({
      title: 'Supprimer la séance',
      message: `Supprimer « ${template.name} » et ses ${slots.length} exercice(s) du programme ?\n\nLes séances déjà enregistrées dans le journal ne sont pas modifiées.`,
      confirmLabel: 'Supprimer',
      danger: true,
    });
    if (ok) await run((db) => deleteTemplate(db, template.id), 'Séance supprimée.');
  };

  const optionalCount = slots.filter((s) => s.isOptional).length;

  return (
    <section className="template-editor" aria-label={`Séance ${template.name}`}>
      <div className="template-header">
        <InlineTitle
          level={2}
          ariaLabel="Nom de la séance"
          value={template.name}
          onSave={(name) => run((db) => updateTemplate(db, template.id, { name }))}
        />
        <span className="muted">
          {slots.length} exercice{slots.length > 1 ? 's' : ''}
          {optionalCount > 0 && ` · ${optionalCount} optionnel${optionalCount > 1 ? 's' : ''}`}
        </span>
        <div className="spacer" />
        <button type="button" className="btn btn-ghost" onClick={() => void run((db) => duplicateTemplate(db, template.id), 'Séance dupliquée.')}>
          Dupliquer
        </button>
        <button type="button" className="btn btn-ghost btn-danger-text" onClick={() => void remove()}>
          Supprimer
        </button>
      </div>

      <TextArea
        label="Commentaire de la séance"
        className="template-comment"
        rows={2}
        value={template.comment}
        placeholder="Consignes propres à cette séance…"
        onSave={(comment) => run((db) => updateTemplate(db, template.id, { comment }))}
      />

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={slots.map((s) => s.id)} strategy={verticalListSortingStrategy}>
          <ol className="slot-list">
            {slots.map((slot, i) => {
              const showHeader = i === 0 || groupKey(slots[i - 1]!) !== groupKey(slot);
              return (
                <Fragment key={slot.id}>
                  {showHeader && (
                    <li className={`block-header block-${slot.block}`} aria-hidden>
                      {BLOCK_LABELS[slot.block]}
                      {slot.blockLabel && <span> — {slot.blockLabel}</span>}
                    </li>
                  )}
                  <SlotItem
                    slot={slot}
                    index={i}
                    expanded={expandedId === slot.id}
                    onToggle={() => setExpandedId((id) => (id === slot.id ? null : slot.id))}
                    onMove={(delta) => reorder(i, i + delta)}
                  />
                </Fragment>
              );
            })}
          </ol>
        </SortableContext>
      </DndContext>

      {slots.length === 0 && <p className="empty-state">Aucun exercice pour l'instant.</p>}

      <button type="button" className="btn btn-add" onClick={() => setPicking(true)}>
        + Ajouter un exercice <kbd>Ctrl+N</kbd>
      </button>

      {picking && (
        <ExercisePicker
          title={expandedId ? 'Ajouter un exercice après le slot ouvert' : 'Ajouter un exercice'}
          onPick={addSlot}
          onClose={() => setPicking(false)}
        />
      )}
    </section>
  );
}
