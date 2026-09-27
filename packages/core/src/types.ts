export const EXERCISE_KINDS = ['weight', 'bodyweight', 'cardio', 'isometric'] as const;
export type ExerciseKind = (typeof EXERCISE_KINDS)[number];

export const BLOCKS = ['warmup', 'work', 'finisher', 'cooldown'] as const;
export type Block = (typeof BLOCKS)[number];

export const TARGET_UNITS = ['reps', 's', 'm', 'min'] as const;
export type TargetUnit = (typeof TARGET_UNITS)[number];

export const MUSCLE_ROLES = ['primary', 'secondary'] as const;
export type MuscleRole = (typeof MUSCLE_ROLES)[number];

export type ProgramOrigin = 'seed' | 'user' | 'import';
export type ExerciseOrigin = 'seed' | 'user' | 'free_exercise_db' | 'import';

export interface MuscleGroup {
  id: string;
  name: string;
  region: 'upper' | 'lower' | 'core';
  sort: number;
}

export interface ExerciseMuscle {
  muscleGroupId: string;
  role: MuscleRole;
}

export interface Exercise {
  id: string;
  name: string;
  kind: ExerciseKind;
  equipment: string | null;
  techniqueNotes: string | null;
  origin: ExerciseOrigin;
  isArchived: boolean;
  muscles: ExerciseMuscle[];
  createdAt: string;
  updatedAt: string;
}

/** Cibles communes à un slot et aux surcharges d'une alternative. */
export interface SlotOption {
  id: string;
  slotId: string;
  exerciseId: string;
  exerciseName: string;
  exerciseKind: ExerciseKind;
  sort: number;
  sets: number | null;
  targetMin: number | null;
  targetMax: number | null;
  loadKg: number | null;
  loadNextKg: number | null;
  note: string | null;
}

export interface TemplateSlot {
  id: string;
  templateId: string;
  sort: number;
  block: Block;
  blockLabel: string | null;
  label: string | null;
  sets: number | null;
  targetMin: number | null;
  targetMax: number | null;
  targetUnit: TargetUnit;
  perSide: boolean;
  loadKg: number | null;
  loadNextKg: number | null;
  loadNote: string | null;
  rirMin: number | null;
  rirMax: number | null;
  restS: number | null;
  comment: string | null;
  isOptional: boolean;
  enabledByDefault: boolean;
  options: SlotOption[];
}

export interface WorkoutTemplate {
  id: string;
  programId: string;
  name: string;
  comment: string | null;
  sort: number;
  slots: TemplateSlot[];
}

export interface Program {
  id: string;
  name: string;
  comment: string | null;
  isActive: boolean;
  origin: ProgramOrigin;
  createdAt: string;
  updatedAt: string;
  templates: WorkoutTemplate[];
}

export interface ProgramSummary {
  id: string;
  name: string;
  isActive: boolean;
  origin: ProgramOrigin;
  templateCount: number;
  createdAt: string;
  updatedAt: string;
}
