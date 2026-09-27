import type { Program } from '@training/core';
import type { QueryClient } from '@tanstack/react-query';
import { keys } from '../../lib/queries.ts';

/** Mise à jour optimiste du programme en cache (glisser-déposer sans latence). */
export function patchProgramCache(qc: QueryClient, fn: (p: Program) => Program): void {
  qc.setQueryData<Program | null>(keys.activeProgram, (p) => (p ? fn(p) : p));
}

export function moveItem<T>(list: T[], from: number, to: number): T[] {
  const copy = list.slice();
  const [item] = copy.splice(from, 1);
  copy.splice(to, 0, item!);
  return copy;
}
