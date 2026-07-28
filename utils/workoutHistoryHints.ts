import type { Exercise, ExerciseKind, WorkoutSession, WorkoutSet } from '../types/workout';

export interface PreviousSetHint {
  weight?: string;
  reps?: string;
}

function normalizeExerciseName(name: string): string {
  return name.trim().toLocaleLowerCase().replace(/\s+/g, ' ');
}

export function findPreviousExercise(
  sessions: readonly WorkoutSession[],
  exerciseName: string,
  exerciseKind: ExerciseKind = 'strength',
): Exercise | undefined {
  if (exerciseKind !== 'strength') return undefined;

  const normalizedName = normalizeExerciseName(exerciseName);
  if (!normalizedName) return undefined;

  return [...sessions]
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date))
    .flatMap(session => session.exercises)
    .find(
      exercise =>
        (exercise.kind ?? 'strength') === 'strength' &&
        normalizeExerciseName(exercise.name) === normalizedName &&
        exercise.sets.length > 0,
    );
}

function formatValue(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
}

export function formatPreviousExerciseSummary(exercise: Exercise | undefined): string | null {
  if (!exercise || exercise.sets.length === 0) return null;

  const sets = exercise.sets
    .filter(set => set.weight > 0 && set.reps > 0)
    .map(set => `${formatValue(set.weight)}×${formatValue(set.reps)}`);

  return sets.length > 0 ? `Last: ${sets.join(' · ')}` : null;
}

export function getPreviousSetHint(
  exercise: Exercise | undefined,
  setIndex: number,
): PreviousSetHint {
  if (!exercise || exercise.sets.length === 0) return {};

  const previousSet: WorkoutSet =
    exercise.sets[setIndex] ?? exercise.sets[exercise.sets.length - 1];

  return {
    ...(previousSet.weight > 0 ? { weight: formatValue(previousSet.weight) } : {}),
    ...(previousSet.reps > 0 ? { reps: formatValue(previousSet.reps) } : {}),
  };
}
