import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, horizontalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { WorkoutTemplate } from '@training/core';

export function TemplateTabs(props: {
  templates: WorkoutTemplate[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onReorder: (from: number, to: number) => void;
  onAdd: () => void;
}) {
  // Souris uniquement : au clavier, Alt+Maj+← / → déplace la séance (voir ProgramPage).
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = props.templates.findIndex((t) => t.id === active.id);
    const to = props.templates.findIndex((t) => t.id === over.id);
    if (from >= 0 && to >= 0) props.onReorder(from, to);
  };
  return (
    <nav className="template-tabs" aria-label="Séances du programme">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={props.templates.map((t) => t.id)} strategy={horizontalListSortingStrategy}>
          <div className="tabs" role="tablist">
            {props.templates.map((t) => (
              <Tab key={t.id} template={t} selected={t.id === props.selectedId} onSelect={props.onSelect} />
            ))}
          </div>
        </SortableContext>
      </DndContext>
      <button type="button" className="btn btn-ghost" onClick={props.onAdd} title="Ajouter une séance au programme">
        + Séance
      </button>
    </nav>
  );
}

function Tab({ template, selected, onSelect }: { template: WorkoutTemplate; selected: boolean; onSelect: (id: string) => void }) {
  const { listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: template.id });
  const count = template.slots.length;
  return (
    <button
      ref={setNodeRef}
      type="button"
      role="tab"
      aria-selected={selected}
      className={`tab ${selected ? 'is-selected' : ''} ${isDragging ? 'is-dragging' : ''}`}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      {...listeners}
      onClick={() => onSelect(template.id)}
      title="Cliquer pour ouvrir · glisser pour réordonner (clavier : Alt+Maj+← / →)"
    >
      {template.name}
      <span className="tab-count">{count}</span>
    </button>
  );
}
