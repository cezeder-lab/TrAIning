import {
  getActiveProgram,
  getExerciseHistory,
  getLastPerformance,
  getSession,
  listCardio,
  listMedia,
  listSessions,
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

export function useSessions(from: string, to: string) {
  const { platform } = useApp();
  return useQuery({ queryKey: ['sessions', from, to], queryFn: () => listSessions(platform.db, from, to) });
}

export function useSession(id: string | null) {
  const { platform } = useApp();
  return useQuery({ queryKey: ['session', id], queryFn: () => getSession(platform.db, id!), enabled: !!id });
}

export function useCardioList(from: string, to: string) {
  const { platform } = useApp();
  return useQuery({ queryKey: ['cardio', from, to], queryFn: () => listCardio(platform.db, { from, to }) });
}

export function useLastPerformance(exerciseId: string, beforeDate: string, excludeSessionId: string) {
  const { platform } = useApp();
  return useQuery({
    queryKey: ['lastPerf', exerciseId, beforeDate, excludeSessionId],
    queryFn: () => getLastPerformance(platform.db, exerciseId, { beforeDate, excludeSessionId }),
  });
}

export function useExerciseHistory(exerciseId: string | null) {
  const { platform } = useApp();
  return useQuery({
    queryKey: ['history', exerciseId],
    queryFn: () => getExerciseHistory(platform.db, exerciseId!),
    enabled: !!exerciseId,
  });
}

export function useMedia(exerciseId: string | null) {
  const { platform } = useApp();
  return useQuery({ queryKey: ['media', exerciseId], queryFn: () => listMedia(platform.db, exerciseId!), enabled: !!exerciseId });
}
