import { EXERCISE_KINDS, createExercise, normalizeText, type Exercise, type ExerciseKind } from '@training/core';
import { useMemo, useRef, useState } from 'react';
import { useAction } from '../lib/app.tsx';
import { KIND_LABELS } from '../lib/labels.ts';
import { useExercises } from '../lib/queries.ts';
import { Modal } from './Modal.tsx';

/** Filtre tolérant : chaque mot saisi doit apparaître (casse et accents ignorés). */
export function filterExercises(list: Exercise[], query: string): Exercise[] {
  const tokens = normalizeText(query).split(' ').filter(Boolean);
  if (tokens.length === 0) return list;
  const scored = list
    .map((e) => {
      const hay = normalizeText(`${e.name} ${e.equipment ?? ''}`);
      if (!tokens.every((t) => hay.includes(t))) return null;
      const name = normalizeText(e.name);
      return { e, score: name.startsWith(tokens.join(' ')) ? 0 : name.includes(tokens[0]!) ? 1 : 2 };
    })
    .filter((x): x is { e: Exercise; score: number } => x !== null);
  scored.sort((a, b) => a.score - b.score || a.e.name.localeCompare(b.e.name, 'fr'));
  return scored.map((x) => x.e);
}

export function ExercisePicker(props: {
  title: string;
  excludeIds?: string[];
  onPick: (exerciseId: string) => unknown;
  onClose: () => void;
}) {
  const { data: exercises = [] } = useExercises();
  const run = useAction();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [kind, setKind] = useState<ExerciseKind>('weight');
  const listRef = useRef<HTMLUListElement>(null);

  const excluded = useMemo(() => new Set(props.excludeIds ?? []), [props.excludeIds]);
  const results = useMemo(
    () => filterExercises(exercises, query).filter((e) => !excluded.has(e.id)).slice(0, 60),
    [exercises, query, excluded],
  );
  const trimmed = query.trim();
  const canCreate = trimmed.length > 0 && !exercises.some((e) => normalizeText(e.name) === normalizeText(trimmed));
  const count = results.length + (canCreate ? 1 : 0);

  const pick = async (index: number) => {
    const ex = results[index];
    if (ex) {
      await props.onPick(ex.id);
      props.onClose();
      return;
    }
    if (canCreate && index === results.length) {
      const created = await run((db) => createExercise(db, { name: trimmed, kind }));
      if (created) {
        await props.onPick(created.id);
        props.onClose();
      }
    }
  };

  const move = (delta: number) => {
    if (count === 0) return;
    const next = (active + delta + count) % count;
    setActive(next);
    listRef.current?.children[next]?.scrollIntoView({ block: 'nearest' });
  };

  return (
    <Modal title={props.title} onClose={props.onClose} width={560}>
      <input
        className="picker-search"
        autoFocus
        placeholder="Rechercher un exercice (ex. « curl halt »)…"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') (e.preventDefault(), move(1));
          else if (e.key === 'ArrowUp') (e.preventDefault(), move(-1));
          else if (e.key === 'Enter') (e.preventDefault(), void pick(active));
        }}
        aria-controls="picker-list"
        aria-activedescendant={`picker-${active}`}
      />
      <ul id="picker-list" className="picker-list" role="listbox" ref={listRef}>
        {results.map((e, i) => (
          <li
            key={e.id}
            id={`picker-${i}`}
            role="option"
            aria-selected={i === active}
            className={i === active ? 'is-active' : ''}
            onMouseEnter={() => setActive(i)}
            onClick={() => void pick(i)}
          >
            <span>{e.name}</span>
            <small>{[KIND_LABELS[e.kind], e.equipment].filter(Boolean).join(' · ')}</small>
          </li>
        ))}
        {canCreate && (
          <li
            id={`picker-${results.length}`}
            role="option"
            aria-selected={active === results.length}
            className={`picker-create ${active === results.length ? 'is-active' : ''}`}
            onMouseEnter={() => setActive(results.length)}
            onClick={() => void pick(results.length)}
          >
            <span>
              + Créer « <strong>{trimmed}</strong> »
            </span>
            <small>Nouvel exercice</small>
          </li>
        )}
        {count === 0 && <li className="picker-empty">Tapez un nom pour rechercher ou créer un exercice.</li>}
      </ul>
      {canCreate && (
        <div className="picker-kind" role="radiogroup" aria-label="Type du nouvel exercice">
          <span>Type si création :</span>
          {EXERCISE_KINDS.map((k) => (
            <label key={k} className="chip-radio">
              <input type="radio" name="kind" checked={kind === k} onChange={() => setKind(k)} />
              {KIND_LABELS[k]}
            </label>
          ))}
        </div>
      )}
      <p className="picker-help">↑ ↓ pour naviguer · Entrée pour choisir · Échap pour fermer</p>
    </Modal>
  );
}
