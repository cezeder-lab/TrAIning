import type { ProgramJsonInput } from '../../schemas/program.ts';

type SlotIn = ProgramJsonInput['program']['templates'][number]['slots'][number];
type OptionIn = SlotIn['options'][number];

/** Raccourci d'écriture : un slot à partir de ses alternatives et de ses cibles. */
function slot(options: (string | OptionIn)[], p: Omit<SlotIn, 'options'> = {}): SlotIn {
  return { ...p, options: options.map((o) => (typeof o === 'string' ? { exercise: o } : o)) };
}
const reps = (sets: number | null, min: number, max = min) => ({ sets, targetMin: min, targetMax: max });

const PRINCIPLES = [
  '- Pauses courtes.',
  '- Polyarticulaires jambes (squat, RDL) : 2-3 reps en réserve.',
  "- Autres exercices : jusqu'à 1 rep de l'échec (RM-1).",
  '- Premiers exercices lourds / peu de reps ; derniers exercices plus légers / plus de reps.',
  '- Augmenter les charges progressivement.',
].join('\n');

const m = (primary: string[], secondary: string[] = []) => [
  ...primary.map((id) => ({ id, role: 'primary' as const })),
  ...secondary.map((id) => ({ id, role: 'secondary' as const })),
];

/** Programme inséré au premier lancement et par « Restaurer le programme initial ». */
export const INITIAL_PROGRAM: ProgramJsonInput = {
  format: 'training-program',
  version: 1,
  program: {
    name: 'Push / Pull / Legs',
    comment: PRINCIPLES,
    templates: [
      {
        name: 'Push',
        slots: [
          slot(['Suspension barre (deadhang)'], { block: 'warmup', sets: null }),
          slot(['Développé incliné (haltères)'], {
            ...reps(4, 6, 8), loadKg: 22, loadNextKg: 24,
            comment: 'Exercice prioritaire : haut des pectoraux.',
          }),
          slot(['Chest press (machine)'], { ...reps(3, 8, 10), comment: 'Version inclinée si disponible.' }),
          slot([{ exercise: 'Élévations latérales (haltères)', loadKg: 8 }, 'Élévations latérales (poulie)'], {
            label: 'Élévations latérales', ...reps(4, 12, 20), comment: 'Priorité : deltoïde latéral.',
          }),
          slot(['Écarté incliné (haltères)'], {
            ...reps(3, 10, 15), loadKg: 16, loadNextKg: 18, comment: 'Mouvement contrôlé.',
          }),
          slot(['Développé épaules (machine)', 'Développé épaules (haltères, prise neutre)'], {
            label: 'Développé épaules', ...reps(2, 8, 10), isOptional: true,
            comment: "Arrêter si douleur à l'épaule gauche.",
          }),
          slot(['Extension triceps au-dessus de la tête (poulie)', 'Extension triceps au-dessus de la tête (haltère)'], {
            label: 'Extension triceps au-dessus de la tête', ...reps(3, 10, 12), comment: 'Chef long.',
          }),
          slot(['Extension triceps poulie haute', 'Barre au front (EZ)'], {
            label: 'Extension triceps', ...reps(3, 10, 12),
          }),
          slot(['Dips'], {
            block: 'finisher', sets: null, isOptional: true, enabledByDefault: false,
            comment: 'Seulement si indolore, en fin de séance.',
          }),
        ],
      },
      {
        name: 'Pull',
        slots: [
          slot([{ exercise: 'Tractions', note: 'Poids du corps' }, 'Tirage vertical (machine)'], {
            label: 'Tirage vertical', ...reps(3, 6, 8),
          }),
          slot([{ exercise: 'Curl biceps (haltères)', loadKg: 14 }, 'Curl biceps (barre EZ)'], {
            label: 'Curl biceps', ...reps(4, 8),
          }),
          slot(
            [
              { exercise: 'Rowing haltère', loadKg: 26 },
              'Tirage horizontal poulie basse (prise V)',
              'Tirage horizontal poulie (unilatéral)',
            ],
            { label: 'Tirage horizontal', ...reps(3, 8, 10), comment: "Maintien, pas à l'échec." },
          ),
          slot(['Face pull (poulie)'], { ...reps(3, 12, 15), comment: 'Deltoïde postérieur, posture.' }),
          slot(['Curl marteau (haltères)'], reps(3, 10, 12)),
          slot(['Curl incliné (haltères)', 'Curl pronation (barre EZ)'], {
            label: 'Curl haut volume', ...reps(3, 12, 15), comment: 'Haut volume.',
          }),
        ],
      },
      {
        name: 'Legs',
        slots: [
          slot([{ exercise: 'Squat barre', loadKg: 90, note: '1RM estimé ~120 kg' }, 'Hack squat'], {
            label: 'Squat', ...reps(4, 6), rirMin: 2, rirMax: 3,
          }),
          slot(
            [
              'Soulevé de terre jambes tendues (RDL)',
              { exercise: 'Extension lombaire (Roman chair)', loadKg: 20, sets: 3, targetMin: 8, targetMax: 8 },
            ],
            {
              label: 'Chaîne postérieure', ...reps(3, 8), rirMin: 2, rirMax: 3,
              comment: 'Ne pas faire les deux dans la même séance.',
            },
          ),
          slot(['Leg curl'], { ...reps(3, 10, 15), comment: 'Assis de préférence.' }),
          slot(['Leg extension'], reps(4, 12, 15)),
          slot(['Mollets à la presse à cuisses', 'Mollets à la Smith machine'], {
            label: 'Mollets', ...reps(4, 10, 15), comment: 'Pas de machine mollets dédiée.',
          }),
          slot(['Étirements'], { block: 'cooldown', sets: null, isOptional: true }),
        ],
      },
      {
        name: 'Abdos / Gainage',
        comment: '~10 min : choisir 1-2 exercices dynamiques + 1-2 de gainage.',
        slots: [
          slot(['Relevés de genoux suspendu', 'Toes to bar'], {
            blockLabel: 'Dynamique', label: 'Relevés de jambes', ...reps(3, 10, 15), isOptional: true,
          }),
          slot(['Sit-up lesté'], { blockLabel: 'Dynamique', ...reps(3, 10, 12), isOptional: true }),
          slot(['Planche hollow sur les mains'], {
            blockLabel: 'Gainage / posture', ...reps(3, 30, 45), targetUnit: 's', isOptional: true,
            comment: 'Contraction du transverse.',
          }),
          slot(['Hollow body'], {
            blockLabel: 'Gainage / posture', ...reps(3, 20, 30), targetUnit: 's', isOptional: true,
          }),
          slot(['Dead bug'], { blockLabel: 'Gainage / posture', ...reps(3, 8, 10), perSide: true, isOptional: true }),
          slot(['Pallof press (poulie)'], {
            blockLabel: 'Gainage / posture', ...reps(3, 10, 12), perSide: true, isOptional: true,
          }),
          slot(['Suspension genoux relevés'], {
            blockLabel: 'Gainage / posture', ...reps(3, 20, 30), targetUnit: 's', isOptional: true,
            comment: 'Abdos contractés.',
          }),
          slot(['Farmer walk'], {
            blockLabel: 'Gainage / posture', ...reps(3, 30, 40), targetUnit: 'm', loadNote: 'Lourd',
            isOptional: true, comment: 'Posture : bassin, abdos, épaules.',
          }),
        ],
      },
    ],
  },
  exercises: [
    // Push
    { name: 'Suspension barre (deadhang)', kind: 'isometric', equipment: 'Barre fixe', muscles: m(['forearms'], ['lats']) },
    { name: 'Développé incliné (haltères)', kind: 'weight', equipment: 'Haltères', muscles: m(['chest_upper'], ['delt_front', 'triceps']) },
    { name: 'Chest press (machine)', kind: 'weight', equipment: 'Machine', muscles: m(['chest'], ['delt_front', 'triceps']) },
    { name: 'Élévations latérales (haltères)', kind: 'weight', equipment: 'Haltères', muscles: m(['delt_side']) },
    { name: 'Élévations latérales (poulie)', kind: 'weight', equipment: 'Poulie', muscles: m(['delt_side']) },
    { name: 'Écarté incliné (haltères)', kind: 'weight', equipment: 'Haltères', muscles: m(['chest_upper'], ['delt_front']) },
    { name: 'Développé épaules (machine)', kind: 'weight', equipment: 'Machine', muscles: m(['delt_front'], ['delt_side', 'triceps']) },
    { name: 'Développé épaules (haltères, prise neutre)', kind: 'weight', equipment: 'Haltères', muscles: m(['delt_front'], ['delt_side', 'triceps']) },
    { name: 'Extension triceps au-dessus de la tête (poulie)', kind: 'weight', equipment: 'Poulie', muscles: m(['triceps']) },
    { name: 'Extension triceps au-dessus de la tête (haltère)', kind: 'weight', equipment: 'Haltère', muscles: m(['triceps']) },
    { name: 'Extension triceps poulie haute', kind: 'weight', equipment: 'Poulie', muscles: m(['triceps']) },
    { name: 'Barre au front (EZ)', kind: 'weight', equipment: 'Barre EZ', muscles: m(['triceps']) },
    { name: 'Dips', kind: 'bodyweight', equipment: 'Barres parallèles', muscles: m(['chest', 'triceps'], ['delt_front']) },
    // Pull
    { name: 'Tractions', kind: 'bodyweight', equipment: 'Barre fixe', muscles: m(['lats'], ['biceps', 'upper_back']) },
    { name: 'Tirage vertical (machine)', kind: 'weight', equipment: 'Machine', muscles: m(['lats'], ['biceps', 'upper_back']) },
    { name: 'Curl biceps (haltères)', kind: 'weight', equipment: 'Haltères', muscles: m(['biceps']) },
    { name: 'Curl biceps (barre EZ)', kind: 'weight', equipment: 'Barre EZ', muscles: m(['biceps']) },
    { name: 'Rowing haltère', kind: 'weight', equipment: 'Haltère', muscles: m(['upper_back', 'lats'], ['biceps', 'delt_rear']) },
    { name: 'Tirage horizontal poulie basse (prise V)', kind: 'weight', equipment: 'Poulie', muscles: m(['upper_back', 'lats'], ['biceps', 'delt_rear']) },
    { name: 'Tirage horizontal poulie (unilatéral)', kind: 'weight', equipment: 'Poulie', muscles: m(['upper_back', 'lats'], ['biceps', 'delt_rear']) },
    { name: 'Face pull (poulie)', kind: 'weight', equipment: 'Poulie', muscles: m(['delt_rear'], ['upper_back']) },
    { name: 'Curl marteau (haltères)', kind: 'weight', equipment: 'Haltères', muscles: m(['biceps', 'forearms']) },
    { name: 'Curl incliné (haltères)', kind: 'weight', equipment: 'Haltères', muscles: m(['biceps']) },
    { name: 'Curl pronation (barre EZ)', kind: 'weight', equipment: 'Barre EZ', muscles: m(['forearms'], ['biceps']) },
    // Legs
    { name: 'Squat barre', kind: 'weight', equipment: 'Barre', muscles: m(['quads', 'glutes'], ['adductors', 'lower_back']) },
    { name: 'Hack squat', kind: 'weight', equipment: 'Machine', muscles: m(['quads'], ['glutes']) },
    { name: 'Soulevé de terre jambes tendues (RDL)', kind: 'weight', equipment: 'Barre', muscles: m(['hamstrings', 'glutes'], ['lower_back']) },
    { name: 'Extension lombaire (Roman chair)', kind: 'weight', equipment: 'Banc à lombaires', muscles: m(['lower_back'], ['glutes', 'hamstrings']) },
    { name: 'Leg curl', kind: 'weight', equipment: 'Machine', muscles: m(['hamstrings']) },
    { name: 'Leg extension', kind: 'weight', equipment: 'Machine', muscles: m(['quads']) },
    { name: 'Mollets à la presse à cuisses', kind: 'weight', equipment: 'Presse à cuisses', muscles: m(['calves']) },
    { name: 'Mollets à la Smith machine', kind: 'weight', equipment: 'Smith machine', muscles: m(['calves']) },
    { name: 'Étirements', kind: 'isometric', equipment: null, muscles: m(['mobility']) },
    // Abdos / gainage
    { name: 'Relevés de genoux suspendu', kind: 'bodyweight', equipment: 'Barre fixe', muscles: m(['abs'], ['forearms']) },
    { name: 'Toes to bar', kind: 'bodyweight', equipment: 'Barre fixe', muscles: m(['abs'], ['lats', 'forearms']) },
    { name: 'Sit-up lesté', kind: 'weight', equipment: 'Disque / haltère', muscles: m(['abs']) },
    { name: 'Planche hollow sur les mains', kind: 'isometric', equipment: null, muscles: m(['core_deep', 'abs']) },
    { name: 'Hollow body', kind: 'isometric', equipment: null, muscles: m(['abs', 'core_deep']) },
    { name: 'Dead bug', kind: 'bodyweight', equipment: null, muscles: m(['core_deep'], ['abs']) },
    { name: 'Pallof press (poulie)', kind: 'weight', equipment: 'Poulie', muscles: m(['obliques', 'core_deep']) },
    { name: 'Suspension genoux relevés', kind: 'isometric', equipment: 'Barre fixe', muscles: m(['abs'], ['forearms']) },
    { name: 'Farmer walk', kind: 'weight', equipment: 'Haltères / kettlebells', muscles: m(['forearms', 'core_deep'], ['upper_back']) },
  ],
};
