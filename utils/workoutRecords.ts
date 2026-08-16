import type { WorkoutSession, WorkoutSet } from '../types/workout';

export const MAX_REASONABLE_REPS = 40;

interface StrengthSetDraft {
  id: string;
  weight: string | number;
  reps: string | number;
}

interface ExerciseDraft {
  id: string;
  name: string;
  kind?: 'strength' | 'cardio';
  sets: readonly StrengthSetDraft[];
}

export interface SuspiciousStrengthSet {
  exerciseId: string;
  exerciseName: string;
  setId: string;
  weight: number;
  reps: number;
}

export type PersonalRecordKind = 'weight' | 'reps';

export interface PersonalRecord {
  kind: PersonalRecordKind;
  exerciseName: string;
  weight: number;
  reps: number;
}

export interface SetPersonalRecord extends PersonalRecord {
  setId: string;
}

function normalizeExerciseName(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

function exerciseKey(name: string): string {
  return normalizeExerciseName(name).toLocaleLowerCase();
}

function parseNumber(value: string | number): number {
  return typeof value === 'number' ? value : Number(value.trim());
}

function isUsableStrengthSet(set: Pick<WorkoutSet, 'weight' | 'reps'>): boolean {
  return Number.isFinite(set.weight)
    && Number.isFinite(set.reps)
    && set.weight >= 0
    && set.reps > 0
    && set.reps <= MAX_REASONABLE_REPS;
}

export function findSuspiciousStrengthSets(
  exercises: readonly ExerciseDraft[],
): SuspiciousStrengthSet[] {
  return exercises.flatMap(exercise => {
    if ((exercise.kind ?? 'strength') !== 'strength') return [];

    return exercise.sets.flatMap(set => {
      const reps = parseNumber(set.reps);
      if (!Number.isFinite(reps) || reps <= MAX_REASONABLE_REPS) return [];

      const parsedWeight = parseNumber(set.weight);
      return [{
        exerciseId: exercise.id,
        exerciseName: normalizeExerciseName(exercise.name),
        setId: set.id,
        weight: Number.isFinite(parsedWeight) ? parsedWeight : 0,
        reps,
      }];
    });
  });
}

export function findPersonalRecordsForSet(
  sessions: readonly WorkoutSession[],
  exerciseName: string,
  currentSet: Pick<WorkoutSet, 'weight' | 'reps'>,
): PersonalRecord[] {
  if (!isUsableStrengthSet(currentSet)) return [];

  const normalizedName = normalizeExerciseName(exerciseName);
  const key = exerciseKey(exerciseName);
  if (!key) return [];

  const historicalSets = sessions.flatMap(session =>
    session.exercises.flatMap(exercise =>
      (exercise.kind ?? 'strength') === 'strength'
        && exerciseKey(exercise.name) === key
        ? exercise.sets.filter(isUsableStrengthSet)
        : [],
    ),
  );

  if (historicalSets.length === 0) return [];

  const bestWeight = Math.max(...historicalSets.map(set => set.weight));
  if (currentSet.weight > bestWeight) {
    return [{
      kind: 'weight',
      exerciseName: normalizedName,
      weight: currentSet.weight,
      reps: currentSet.reps,
    }];
  }

  const sameWeightSets = historicalSets.filter(set => set.weight === currentSet.weight);
  if (sameWeightSets.length === 0) return [];

  const bestRepsAtWeight = Math.max(...sameWeightSets.map(set => set.reps));
  if (currentSet.reps > bestRepsAtWeight) {
    return [{
      kind: 'reps',
      exerciseName: normalizedName,
      weight: currentSet.weight,
      reps: currentSet.reps,
    }];
  }

  return [];
}

export function findPersonalRecordsForSession(
  history: readonly WorkoutSession[],
  session: WorkoutSession,
): SetPersonalRecord[] {
  const sessionTime = Date.parse(session.date);
  const priorSessions = history.filter(candidate =>
    candidate.id !== session.id
      && (!Number.isFinite(sessionTime) || Date.parse(candidate.date) < sessionTime),
  );

  const records: SetPersonalRecord[] = [];
  const earlierSetsByExercise = new Map<string, WorkoutSet[]>();

  for (const exercise of session.exercises) {
    if ((exercise.kind ?? 'strength') !== 'strength') continue;

    const key = exerciseKey(exercise.name);
    const earlierSets = earlierSetsByExercise.get(key) ?? [];

    for (const set of exercise.sets) {
      const sameWorkoutHistory: WorkoutSession[] = earlierSets.length > 0
        ? [{
            id: `${session.id}-earlier-sets`,
            date: session.date,
            durationMinutes: 0,
            exercises: [{
              id: `${exercise.id}-earlier-sets`,
              name: exercise.name,
              kind: 'strength',
              sets: earlierSets,
            }],
          }]
        : [];

      records.push(
        ...findPersonalRecordsForSet(
          [...priorSessions, ...sameWorkoutHistory],
          exercise.name,
          set,
        ).map(record => ({ setId: set.id, ...record })),
      );
      earlierSets.push(set);
    }

    earlierSetsByExercise.set(key, earlierSets);
  }

  return records;
}
