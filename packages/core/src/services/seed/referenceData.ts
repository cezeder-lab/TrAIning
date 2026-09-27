import type { MuscleGroup } from '../../types.ts';

export const MUSCLE_GROUPS: MuscleGroup[] = [
  { id: 'chest_upper', name: 'Pectoraux (haut)', region: 'upper', sort: 10 },
  { id: 'chest', name: 'Pectoraux', region: 'upper', sort: 11 },
  { id: 'delt_front', name: 'Deltoïde antérieur', region: 'upper', sort: 20 },
  { id: 'delt_side', name: 'Deltoïde latéral', region: 'upper', sort: 21 },
  { id: 'delt_rear', name: 'Deltoïde postérieur', region: 'upper', sort: 22 },
  { id: 'lats', name: 'Grand dorsal', region: 'upper', sort: 30 },
  { id: 'upper_back', name: 'Haut du dos / trapèzes', region: 'upper', sort: 31 },
  { id: 'biceps', name: 'Biceps', region: 'upper', sort: 40 },
  { id: 'triceps', name: 'Triceps', region: 'upper', sort: 41 },
  { id: 'forearms', name: 'Avant-bras / préhension', region: 'upper', sort: 42 },
  { id: 'abs', name: 'Abdominaux', region: 'core', sort: 50 },
  { id: 'obliques', name: 'Obliques', region: 'core', sort: 51 },
  { id: 'core_deep', name: 'Transverse / gainage', region: 'core', sort: 52 },
  { id: 'lower_back', name: 'Lombaires', region: 'core', sort: 53 },
  { id: 'glutes', name: 'Fessiers', region: 'lower', sort: 60 },
  { id: 'quads', name: 'Quadriceps', region: 'lower', sort: 61 },
  { id: 'hamstrings', name: 'Ischio-jambiers', region: 'lower', sort: 62 },
  { id: 'adductors', name: 'Adducteurs', region: 'lower', sort: 63 },
  { id: 'calves', name: 'Mollets', region: 'lower', sort: 64 },
  { id: 'mobility', name: 'Mobilité / étirements', region: 'core', sort: 90 },
];
