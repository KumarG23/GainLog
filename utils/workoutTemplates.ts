import type { Exercise, WorkoutSession, WorkoutSet } from '../types/workout';

export type WorkoutTemplateId = 'push' | 'pull' | 'recovery' | 'legs' | 'upper';

export interface WorkoutTemplateExercise {
  name: string;
  sets: number;
  targetReps: string;
  rest: string;
}

export interface WorkoutTemplate {
  id: WorkoutTemplateId;
  weekday: string;
  title: string;
  focus: string;
  estimatedMinutes: number;
  exercises: readonly WorkoutTemplateExercise[];
}

export interface WorkoutTemplateDraftSet {
  id: string;
  weight: string;
  reps: string;
}

export interface WorkoutTemplateDraftExercise {
  id: string;
  name: string;
  kind: 'strength' | 'cardio';
  sets: WorkoutTemplateDraftSet[];
  cardioDurationMinutes: string;
  distanceMiles: string;
  resistanceLevel: string;
  prescription: string;
  recommendedWeight?: string;
}

interface BuiltWorkoutTemplateDraft {
  template: WorkoutTemplate;
  exercises: WorkoutTemplateDraftExercise[];
}

const cardioFinisher = (): WorkoutTemplateDraftExercise => ({
  id: '',
  name: 'Elliptical',
  kind: 'cardio',
  sets: [],
  cardioDurationMinutes: '',
  distanceMiles: '',
  resistanceLevel: '',
  prescription: 'Optional · 10–15 min · easy to moderate',
});

const recoveryCardio = (): WorkoutTemplateDraftExercise => ({
  id: '',
  name: 'Elliptical',
  kind: 'cardio',
  sets: [],
  cardioDurationMinutes: '',
  distanceMiles: '',
  resistanceLevel: '',
  prescription:
    '25–35 min easy · resistance 3–4 · conversational pace · a treadmill walk is interchangeable · elliptical counts as cardio, not steps',
});

export const PLANET_FITNESS_TEMPLATES: readonly WorkoutTemplate[] = [
  {
    id: 'push',
    weekday: 'Monday',
    title: 'Push',
    focus: 'Chest · shoulders · triceps',
    estimatedMinutes: 50,
    exercises: [
      { name: 'Machine Chest Press', sets: 3, targetReps: '8–12', rest: '2 min' },
      { name: 'Incline Chest Press Machine', sets: 3, targetReps: '8–12', rest: '2 min' },
      { name: 'Machine Shoulder Press', sets: 3, targetReps: '8–12', rest: '2 min' },
      { name: 'Lateral Raise Machine', sets: 3, targetReps: '12–20', rest: '60–90 sec' },
      { name: 'Cable Triceps Pressdown', sets: 3, targetReps: '10–15', rest: '60–90 sec' },
    ],
  },
  {
    id: 'pull',
    weekday: 'Tuesday',
    title: 'Pull',
    focus: 'Back · rear delts · biceps',
    estimatedMinutes: 50,
    exercises: [
      { name: 'Lat Pulldown', sets: 3, targetReps: '8–12', rest: '2 min' },
      { name: 'Seated Cable Row', sets: 3, targetReps: '8–12', rest: '2 min' },
      { name: 'Chest-Supported Row Machine', sets: 3, targetReps: '10–15', rest: '2 min' },
      { name: 'Reverse Pec Deck', sets: 3, targetReps: '12–20', rest: '60–90 sec' },
      { name: 'Cable Curl', sets: 3, targetReps: '10–15', rest: '60–90 sec' },
    ],
  },
  {
    id: 'recovery',
    weekday: 'Wednesday',
    title: 'Recovery Cardio',
    focus: 'Easy elliptical or treadmill walk',
    estimatedMinutes: 30,
    exercises: [],
  },
  {
    id: 'legs',
    weekday: 'Thursday',
    title: 'Legs',
    focus: 'Quads · hamstrings · glutes',
    estimatedMinutes: 45,
    exercises: [
      { name: '45-Degree Leg Press', sets: 3, targetReps: '8–12', rest: '2–3 min' },
      { name: 'Glute Kickback Machine', sets: 3, targetReps: '10–15', rest: '60–90 sec' },
      { name: 'Leg Extension', sets: 3, targetReps: '10–15', rest: '60–90 sec' },
      { name: 'Seated Leg Curl', sets: 3, targetReps: '10–15', rest: '60–90 sec' },
    ],
  },
  {
    id: 'upper',
    weekday: 'Friday',
    title: 'Upper',
    focus: 'Chest · back · shoulders',
    estimatedMinutes: 50,
    exercises: [
      { name: 'Incline Chest Press Machine', sets: 3, targetReps: '8–12', rest: '2 min' },
      { name: 'Neutral-Grip Lat Pulldown', sets: 3, targetReps: '8–12', rest: '2 min' },
      { name: 'Seated Row Machine', sets: 3, targetReps: '8–12', rest: '2 min' },
      { name: 'Machine Shoulder Press', sets: 2, targetReps: '8–12', rest: '2 min' },
      { name: 'Pec Deck Fly', sets: 2, targetReps: '10–15', rest: '60–90 sec' },
    ],
  },
];

export function getSuggestedTemplateId(dayOfWeek: number): WorkoutTemplateId | null {
  const weekdayIds: Partial<Record<number, WorkoutTemplateId>> = {
    1: 'push',
    2: 'pull',
    3: 'recovery',
    4: 'legs',
    5: 'upper',
  };
  return weekdayIds[dayOfWeek] ?? null;
}

export function canLoadWorkoutTemplate(
  historyLoading: boolean,
  historyError: string | null,
): boolean {
  return !historyLoading && historyError == null;
}

export function buildWorkoutTemplateDraft(
  templateId: string,
  createId: () => string,
  sessions: readonly WorkoutSession[] = [],
  planDate: Date = new Date(),
): BuiltWorkoutTemplateDraft {
  const template = PLANET_FITNESS_TEMPLATES.find(item => item.id === templateId);
  if (!template) {
    throw new Error(`Unknown workout template: ${templateId}`);
  }

  const exercises: WorkoutTemplateDraftExercise[] = template.exercises.map(exercise => {
    const recommendation = buildWeightRecommendation(exercise, sessions, planDate);
    return {
      id: createId(),
      name: exercise.name,
      kind: 'strength',
      sets: Array.from({ length: exercise.sets }, () => ({
        id: createId(),
        weight: '',
        reps: '',
      })),
      cardioDurationMinutes: '',
      distanceMiles: '',
      resistanceLevel: '',
      prescription: recommendation
        ? `${recommendation.label} · ${exercise.sets} × ${exercise.targetReps} · rest ${exercise.rest}`
        : `Establish a clean baseline · ${exercise.sets} × ${exercise.targetReps} · rest ${exercise.rest}`,
      recommendedWeight: recommendation?.weight,
    };
  });

  const cardio = template.id === 'recovery' ? recoveryCardio() : cardioFinisher();
  cardio.id = createId();
  exercises.push(cardio);

  return { template, exercises };
}

function normalizeExerciseName(name: string): string {
  return name.trim().toLocaleLowerCase().replace(/\s+/g, ' ');
}

export function getWorkoutPlanWeekStart(value: Date): Date {
  const start = new Date(value.getFullYear(), value.getMonth(), value.getDate());
  const day = start.getDay();
  start.setDate(start.getDate() - (day === 0 ? 6 : day - 1));
  return start;
}

function formatWeight(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
}

function validSets(exercise: Exercise): WorkoutSet[] {
  return exercise.sets.filter(
    set =>
      Number.isFinite(set.weight) &&
      Number.isFinite(set.reps) &&
      set.weight > 0 &&
      set.reps > 0 &&
      set.reps <= 40,
  );
}

function priorExercises(
  templateExercise: WorkoutTemplateExercise,
  sessions: readonly WorkoutSession[],
  planDate: Date,
): Exercise[] {
  const historyName = normalizeExerciseName(templateExercise.name);
  const weekStart = getWorkoutPlanWeekStart(planDate).getTime();

  return [...sessions]
    .filter(session => Date.parse(session.date) < weekStart)
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date))
    .flatMap(session => session.exercises)
    .filter(
      exercise =>
        (exercise.kind ?? 'strength') === 'strength' &&
        normalizeExerciseName(exercise.name) === historyName &&
        validSets(exercise).length > 0,
    );
}

function targetRange(targetReps: string): [number, number] {
  const values = targetReps.split(/[^0-9]+/).filter(Boolean).map(Number);
  return [values[0], values[1] ?? values[0]];
}

function inferWeightIncrement(history: readonly Exercise[]): number | null {
  const weights = Array.from(
    new Set(history.flatMap(exercise => validSets(exercise).map(set => set.weight))),
  ).sort((a, b) => a - b);
  const increments = weights
    .slice(1)
    .map((weight, index) => weight - weights[index])
    .filter(increment => increment >= 2.5 && increment <= 30);
  return increments.length > 0 ? Math.min(...increments) : null;
}

function buildWeightRecommendation(
  templateExercise: WorkoutTemplateExercise,
  sessions: readonly WorkoutSession[],
  planDate: Date,
): { weight?: string; label: string } | null {
  const history = priorExercises(templateExercise, sessions, planDate);
  const previous = history[0];
  if (!previous) return null;

  const sets = validSets(previous);
  const latestSet = sets[sets.length - 1];
  if (!latestSet) return null;

  const [minimum, maximum] = targetRange(templateExercise.targetReps);
  const increment = inferWeightIncrement(history);
  let recommended = latestSet.weight;
  let action = 'Hold';

  if (latestSet.reps < minimum) {
    if (increment == null) {
      return {
        weight: '↓ 1 step',
        label: `Use one machine step below ${formatWeight(latestSet.weight)} lb`,
      };
    }
    recommended = Math.max(increment, latestSet.weight - increment);
    action = 'Reduce to';
  } else {
    const completedAtTop = (
      exercise: Exercise | undefined,
      requiredWeight: number,
    ): boolean => {
      if (!exercise) return false;
      const completedSets = validSets(exercise).slice(-templateExercise.sets);
      return (
        completedSets.length === templateExercise.sets &&
        completedSets.every(
          set => set.weight === requiredWeight && set.reps >= maximum,
        )
      );
    };
    const earnedIncrease =
      completedAtTop(history[0], latestSet.weight) &&
      completedAtTop(history[1], latestSet.weight);
    if (earnedIncrease) {
      if (increment == null) {
        return {
          weight: '↑ 1 step',
          label: `Use the next machine step above ${formatWeight(latestSet.weight)} lb`,
        };
      }
      recommended = latestSet.weight + increment;
      action = 'Increase to';
    }
  }

  const weight = formatWeight(recommended);
  return { weight, label: `${action} ${weight} lb` };
}
