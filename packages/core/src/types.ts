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

// --- Séances (journal) -------------------------------------------------------

export const SESSION_STATUSES = ['planned', 'done', 'skipped'] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];
export type SessionExerciseStatus = 'pending' | 'done' | 'skipped';

export interface SetEntry {
  id: string;
  sessionExerciseId: string;
  setIndex: number;
  isWarmup: boolean;
  plannedLoadKg: number | null;
  plannedValue: number | null;
  loadKg: number | null;
  value: number | null;
  isDone: boolean;
  rir: number | null;
  rpe: number | null;
  comment: string | null;
}

export interface SessionExercise {
  id: string;
  sessionId: string;
  templateSlotId: string | null;
  sort: number;
  block: Block;
  blockLabel: string | null;
  label: string | null;
  exerciseId: string;
  exerciseName: string;
  exerciseKind: ExerciseKind;
  alternatives: { exerciseId: string; name: string }[];
  sets: number | null;
  targetMin: number | null;
  targetMax: number | null;
  targetUnit: TargetUnit;
  perSide: boolean;
  loadKg: number | null;
  loadNote: string | null;
  rirMin: number | null;
  rirMax: number | null;
  restS: number | null;
  plannedComment: string | null;
  note: string | null;
  isOptional: boolean;
  isEnabled: boolean;
  status: SessionExerciseStatus;
  setEntries: SetEntry[];
}

export const PAIN_SIDES = ['left', 'right', 'both', 'center'] as const;
export type PainSide = (typeof PAIN_SIDES)[number];

export interface PainEntry {
  id: string;
  date: string;
  sessionId: string | null;
  zone: string;
  side: PainSide | null;
  intensity: number;
  context: string | null;
  note: string | null;
  createdVia: string;
  createdAt: string;
}

export interface CardioSession {
  id: string;
  date: string;
  startTime: string | null;
  sessionId: string | null;
  activity: string;
  durationS: number;
  distanceM: number | null;
  speedKmh: number | null;
  inclineOrLevel: string | null;
  hrAvg: number | null;
  hrMax: number | null;
  caloriesWatchEst: number | null;
  feeling: number | null;
  comment: string | null;
  createdVia: string;
}

export interface WorkoutSession {
  id: string;
  templateId: string | null;
  name: string;
  date: string;
  status: SessionStatus;
  startedAt: string | null;
  endedAt: string | null;
  fatigue: number | null;
  soreness: number | null;
  comment: string | null;
  createdVia: string;
  exercises: SessionExercise[];
  pains: PainEntry[];
  cardio: CardioSession[];
}

export interface SessionSummary {
  id: string;
  templateId: string | null;
  name: string;
  date: string;
  status: SessionStatus;
  exerciseCount: number;
  doneSets: number;
  plannedSets: number;
  maxPain: number | null;
  fatigue: number | null;
}

export interface ExerciseMedia {
  id: string;
  exerciseId: string;
  kind: 'image' | 'gif' | 'video_link' | 'link';
  filePath: string | null;
  url: string | null;
  caption: string | null;
  isThumbnail: boolean;
  sort: number;
}

// --- Nutrition ---------------------------------------------------------------

export const FOOD_SOURCES = ['ciqual', 'off', 'custom', 'recipe'] as const;
export type FoodSource = (typeof FOOD_SOURCES)[number];
export type WeightState = 'raw' | 'cooked' | 'na';
export type EntryUnit = 'g' | 'ml' | 'portion';
export const DAY_TYPES = ['rest', 'training', 'cardio'] as const;
export type DayType = (typeof DAY_TYPES)[number];
export type GoalDayType = DayType | 'default';

export interface Nutrients {
  kcal: number | null;
  proteinG: number | null;
  carbsG: number | null;
  sugarsG: number | null;
  fatG: number | null;
  satFatG: number | null;
  fiberG: number | null;
  saltG: number | null;
}

export interface FoodPortion {
  id: string;
  foodId: string;
  label: string;
  grams: number;
  isDefault: boolean;
}

export interface Food extends Nutrients {
  id: string;
  source: FoodSource;
  sourceRef: string | null;
  name: string;
  brand: string | null;
  category: string | null;
  basis: '100g' | '100ml';
  state: WeightState;
  cookedYield: number | null;
  alcoholG: number | null;
  valueFlags: Record<string, string>;
  isFavorite: boolean;
  useCount: number;
  lastUsedAt: string | null;
  sourceVersion: string | null;
  isArchived: boolean;
  portions: FoodPortion[];
}

export interface FoodEntry {
  id: string;
  date: string;
  mealCategoryId: string;
  foodId: string | null;
  label: string;
  quantity: number;
  unit: EntryUnit;
  portionId: string | null;
  portionLabel: string | null;
  grams: number;
  weightState: WeightState;
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fiberG: number | null;
  sugarsG: number | null;
  satFatG: number | null;
  saltG: number | null;
  source: FoodSource | 'estimate';
  isEstimated: boolean;
  note: string | null;
  createdVia: string;
}

export interface MealCategory {
  id: string;
  name: string;
  sort: number;
  isActive: boolean;
}

export interface MacroTotals {
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fiberG: number;
}

export interface NutritionGoal {
  id: string;
  dayType: GoalDayType;
  validFrom: string;
  kcal: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  fiberG: number | null;
}
