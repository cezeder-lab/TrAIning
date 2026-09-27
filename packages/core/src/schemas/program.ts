import { z } from 'zod';
import { BLOCKS, EXERCISE_KINDS, MUSCLE_ROLES, TARGET_UNITS } from '../types.ts';

// Messages de validation en français (application et serveur MCP).
z.config(z.locales.fr());

const text = (max: number) => z.string().trim().max(max);
const optText = (max: number) =>
  z
    .string()
    .max(max)
    .nullable()
    .transform((s) => (s === null || s.trim() === '' ? null : s));
const num = (min: number, max: number) => z.number().min(min).max(max).nullable();
const int = (min: number, max: number) => z.number().int().min(min).max(max).nullable();

/** Champs modifiables d'un slot (éditeur de programme). */
export const slotPatchSchema = z
  .object({
    block: z.enum(BLOCKS),
    blockLabel: optText(80),
    label: optText(120),
    sets: int(0, 50),
    targetMin: num(0, 10000),
    targetMax: num(0, 10000),
    targetUnit: z.enum(TARGET_UNITS),
    perSide: z.boolean(),
    loadKg: num(0, 1000),
    loadNextKg: num(0, 1000),
    loadNote: optText(200),
    rirMin: int(0, 10),
    rirMax: int(0, 10),
    restS: int(0, 3600),
    comment: optText(2000),
    isOptional: z.boolean(),
    enabledByDefault: z.boolean(),
  })
  .partial();
export type SlotPatch = z.input<typeof slotPatchSchema>;

export const optionPatchSchema = z
  .object({
    sets: int(0, 50),
    targetMin: num(0, 10000),
    targetMax: num(0, 10000),
    loadKg: num(0, 1000),
    loadNextKg: num(0, 1000),
    note: optText(500),
  })
  .partial();
export type OptionPatch = z.input<typeof optionPatchSchema>;

export const exerciseInputSchema = z.object({
  name: text(120).min(1, 'Le nom est obligatoire.'),
  kind: z.enum(EXERCISE_KINDS),
  equipment: optText(120).optional(),
  techniqueNotes: optText(5000).optional(),
  muscles: z
    .array(z.object({ muscleGroupId: z.string(), role: z.enum(MUSCLE_ROLES) }))
    .optional(),
});
export type ExerciseInput = z.input<typeof exerciseInputSchema>;
export const exercisePatchSchema = exerciseInputSchema.partial();
export type ExercisePatch = z.input<typeof exercisePatchSchema>;

// ---------------------------------------------------------------------------
// Format d'export / import JSON du programme (docs/program-json-format.md)
// ---------------------------------------------------------------------------

const jsonNum = z.number().nullable().optional();
const jsonText = z.string().nullable().optional();

export const programJsonOptionSchema = z.object({
  exercise: z.string().trim().min(1),
  sets: jsonNum,
  targetMin: jsonNum,
  targetMax: jsonNum,
  loadKg: jsonNum,
  loadNextKg: jsonNum,
  note: jsonText,
});

export const programJsonSlotSchema = z.object({
  block: z.enum(BLOCKS).default('work'),
  blockLabel: jsonText,
  label: jsonText,
  sets: jsonNum,
  targetMin: jsonNum,
  targetMax: jsonNum,
  targetUnit: z.enum(TARGET_UNITS).default('reps'),
  perSide: z.boolean().default(false),
  loadKg: jsonNum,
  loadNextKg: jsonNum,
  loadNote: jsonText,
  rirMin: jsonNum,
  rirMax: jsonNum,
  restS: jsonNum,
  comment: jsonText,
  isOptional: z.boolean().default(false),
  enabledByDefault: z.boolean().default(true),
  options: z.array(programJsonOptionSchema).min(1, 'Chaque slot doit contenir au moins un exercice.'),
});

export const programJsonTemplateSchema = z.object({
  name: z.string().trim().min(1),
  comment: jsonText,
  slots: z.array(programJsonSlotSchema),
});

export const programJsonExerciseSchema = z.object({
  name: z.string().trim().min(1),
  kind: z.enum(EXERCISE_KINDS).default('weight'),
  equipment: jsonText,
  techniqueNotes: jsonText,
  muscles: z
    .array(z.object({ id: z.string(), role: z.enum(MUSCLE_ROLES).default('primary') }))
    .default([]),
});

export const PROGRAM_JSON_FORMAT = 'training-program';
export const PROGRAM_JSON_VERSION = 1;

export const programJsonSchema = z.object({
  format: z.literal(PROGRAM_JSON_FORMAT, {
    error: "Ce fichier n'est pas un programme TrAIning (champ « format » attendu : training-program).",
  }),
  version: z.literal(PROGRAM_JSON_VERSION, { error: 'Version de format non prise en charge.' }),
  exportedAt: z.string().optional(),
  program: z.object({
    name: z.string().trim().min(1),
    comment: jsonText,
    templates: z.array(programJsonTemplateSchema),
  }),
  exercises: z.array(programJsonExerciseSchema).default([]),
});
export type ProgramJson = z.output<typeof programJsonSchema>;
export type ProgramJsonInput = z.input<typeof programJsonSchema>;
