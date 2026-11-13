import type { Exercise, ExerciseKind, WorkoutSession, WorkoutSet } from '../types/workout';

export interface PreviousSetHint {
  weight?: string;
  reps?: string;
}

function normalizeExerciseName(name: string): string {
  return name.trim().toLocaleLowerCase().replace(/\s+/g, ' ');
}

function usableHistoricalSets(exercise: Exercise): WorkoutSet[] {
  return exercise.sets.filter(
    set =>
      (set.measure ?? 'reps') === 'reps' &&
      Number.isFinite(set.weight) &&
      Number.isFinite(set.reps) &&
      set.weight > 0 &&
      set.reps > 0 &&
      set.reps <= 40,
  );
}

export function findPreviousExercise(
  sessions: readonly WorkoutSession[],
  exerciseName: string,
  exerciseKind: ExerciseKind = 'strength',
  before?: Date,
  templateId?: string,
  measure: 'reps' | 'seconds' = 'reps',
): Exercise | undefined {
  if (exerciseKind !== 'strength') return undefined;

  const normalizedName = normalizeExerciseName(exerciseName);
  if (!normalizedName) return undefined;

  return [...sessions]
    .filter(
      session =>
        (before == null || Date.parse(session.date) < before.getTime()) &&
        (templateId == null || session.templateId === templateId),
    )
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date))
    .flatMap(session => session.exercises)
    .find(
      exercise =>
        (exercise.kind ?? 'strength') === 'strength' &&
        normalizeExerciseName(exercise.name) === normalizedName &&
        (measure === 'seconds'
          ? exercise.sets.some(set => set.measure === 'seconds' && Number.isFinite(set.seconds) && (set.seconds ?? 0) > 0)
          : usableHistoricalSets(exercise).length > 0),
    );
}

function formatValue(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
}

export function formatPreviousExerciseSummary(exercise: Exercise | undefined): string | null {
  if (!exercise || exercise.sets.length === 0) return null;
  const timed = exercise.sets.filter(set => set.measure === 'seconds' && (set.seconds ?? 0) > 0);
  if (timed.length > 0) return `Last: ${timed.map(set => `${formatValue(set.seconds!)} s${set.weight > 0 ? ` @ ${formatValue(set.weight)} lb` : ''}`).join(' · ')}`;

  const sets = usableHistoricalSets(exercise)
    .map(set => `${formatValue(set.weight)}×${formatValue(set.reps)}`);

  return sets.length > 0 ? `Last: ${sets.join(' · ')}` : null;
}

export function getPreviousSetHint(
  exercise: Exercise | undefined,
  setIndex: number,
): PreviousSetHint {
  if (!exercise) return {};

  const sets = usableHistoricalSets(exercise);
  if (sets.length === 0) return {};
  const previousSet: WorkoutSet =
    sets[setIndex] ?? sets[sets.length - 1];

  return {
    ...(previousSet.weight > 0 ? { weight: formatValue(previousSet.weight) } : {}),
    ...(previousSet.reps > 0 ? { reps: formatValue(previousSet.reps) } : {}),
  };
}
