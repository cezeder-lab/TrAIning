import {
  getActiveProgram,
  getSettings,
  getUserProfile,
  listExercises,
  listMuscleGroups,
  listPrograms,
} from '@training/core';
import { useQuery } from '@tanstack/react-query';
import { useApp } from './app.tsx';

export const keys = {
  activeProgram: ['program', 'active'] as const,
  programs: ['programs'] as const,
  exercises: ['exercises'] as const,
  muscleGroups: ['muscleGroups'] as const,
  settings: ['settings'] as const,
  profile: ['profile'] as const,
  dbInfo: ['dbInfo'] as const,
};

export function useActiveProgram() {
  const { platform } = useApp();
  return useQuery({ queryKey: keys.activeProgram, queryFn: () => getActiveProgram(platform.db) });
}

export function usePrograms() {
  const { platform } = useApp();
  return useQuery({ queryKey: keys.programs, queryFn: () => listPrograms(platform.db) });
}

export function useExercises() {
  const { platform } = useApp();
  return useQuery({ queryKey: keys.exercises, queryFn: () => listExercises(platform.db) });
}

export function useMuscleGroups() {
  const { platform } = useApp();
  return useQuery({ queryKey: keys.muscleGroups, queryFn: () => listMuscleGroups(platform.db) });
}

export function useSettings() {
  const { platform } = useApp();
  return useQuery({ queryKey: keys.settings, queryFn: () => getSettings(platform.db) });
}

export function useProfile() {
  const { platform } = useApp();
  return useQuery({ queryKey: keys.profile, queryFn: () => getUserProfile(platform.db) });
}

export function useDbInfo() {
  const { platform } = useApp();
  return useQuery({ queryKey: keys.dbInfo, queryFn: () => platform.dbInfo() });
}
