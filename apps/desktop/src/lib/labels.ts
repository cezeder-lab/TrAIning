import { BLOCK_LABELS, type Block, type ExerciseKind, type TargetUnit } from '@training/core';

export const KIND_LABELS: Record<ExerciseKind, string> = {
  weight: 'Poids',
  bodyweight: 'Poids du corps',
  cardio: 'Cardio',
  isometric: 'Isométrie',
};

export const KIND_OPTIONS = (Object.keys(KIND_LABELS) as ExerciseKind[]).map((value) => ({
  value,
  label: KIND_LABELS[value],
}));

export const BLOCK_OPTIONS = (Object.keys(BLOCK_LABELS) as Block[]).map((value) => ({
  value,
  label: BLOCK_LABELS[value],
}));

export const UNIT_OPTIONS: { value: TargetUnit; label: string }[] = [
  { value: 'reps', label: 'répétitions' },
  { value: 's', label: 'secondes' },
  { value: 'm', label: 'mètres' },
  { value: 'min', label: 'minutes' },
];
