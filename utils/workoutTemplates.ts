import type { Exercise, WorkoutSession, WorkoutSet } from '../types/workout';

export type WorkoutTemplateId = 'push' | 'pull' | 'recovery' | 'legs' | 'upper';

export interface WorkoutTemplateExercise {
  name: string;
  sets: number;
  targetReps: string;
  rest: string;
  cue?: string;
  substitutions?: readonly [string, string];
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
  prescription?: string;
  recommendedWeight?: string;
  targetReps?: string;
  rest?: string;
  cue?: string;
  substitutionOptions?: readonly string[];
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
      {
        name: 'Smith Machine Bench Press',
        sets: 3,
        targetReps: '8–12',
        rest: '2 min',
        cue: 'keep 2 good reps in reserve',
        substitutions: ['Machine Chest Press', 'Dumbbell Bench Press'],
      },
      {
        name: 'Incline Dumbbell Bench Press',
        sets: 3,
        targetReps: '8–12',
        rest: '2 min',
        cue: 'use a low 15–30° incline and control the stretch',
        substitutions: ['Smith Machine Incline Bench Press', 'Incline Chest Press Machine'],
      },
      {
        name: 'Machine Shoulder Press',
        sets: 3,
        targetReps: '8–12',
        rest: '2 min',
        substitutions: ['Dumbbell Shoulder Press', 'Plate-Loaded Shoulder Press'],
      },
      {
        name: 'Lateral Raise Machine',
        sets: 3,
        targetReps: '12–20',
        rest: '60–90 sec',
        substitutions: ['Cable Lateral Raise', 'Dumbbell Lateral Raise'],
      },
      {
        name: 'Cable Triceps Pressdown',
        sets: 3,
        targetReps: '10–15',
        rest: '60–90 sec',
        substitutions: ['Triceps Press Machine', 'Single-Arm Cable Pressdown'],
      },
    ],
  },
  {
    id: 'pull',
    weekday: 'Tuesday',
    title: 'Pull',
    focus: 'Back · rear delts · biceps',
    estimatedMinutes: 50,
    exercises: [
      {
        name: 'Lat Pulldown', sets: 3, targetReps: '8–12', rest: '2 min',
        substitutions: ['Lat Pulldown Machine', 'Assisted Pull-Up'],
      },
      {
        name: 'Seated Cable Row', sets: 3, targetReps: '8–12', rest: '2 min',
        substitutions: ['Single-Arm Cable Row', 'Seated Row Machine'],
      },
      {
        name: 'Chest-Supported Row Machine', sets: 3, targetReps: '10–15', rest: '2 min',
        substitutions: ['Chest-Supported Dumbbell Row', 'Plate-Loaded Row Machine'],
      },
      {
        name: 'Reverse Pec Deck', sets: 3, targetReps: '12–20', rest: '60–90 sec',
        substitutions: ['Cable Rear Delt Fly', 'Incline Rear Delt Raise'],
      },
      {
        name: 'Cable Curl', sets: 3, targetReps: '10–15', rest: '60–90 sec',
        substitutions: ['Preacher Curl', 'Dumbbell Curl'],
      },
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
      {
        name: '45-Degree Leg Press', sets: 3, targetReps: '8–12', rest: '2–3 min',
        substitutions: ['Seated Leg Press', 'Smith Machine Squat'],
      },
      {
        name: 'Glute Kickback Machine', sets: 3, targetReps: '10–15', rest: '60–90 sec',
        substitutions: ['Cable Glute Kickback', 'Smith Machine Reverse Lunge'],
      },
      {
        name: 'Leg Extension', sets: 3, targetReps: '10–15', rest: '60–90 sec',
        substitutions: ['Single-Leg Leg Extension', 'Dumbbell Split Squat'],
      },
      {
        name: 'Seated Leg Curl', sets: 3, targetReps: '10–15', rest: '60–90 sec',
        substitutions: ['Lying Leg Curl', 'Standing Single-Leg Curl'],
      },
    ],
  },
  {
    id: 'upper',
    weekday: 'Friday',
    title: 'Upper',
    focus: 'Chest · back · shoulders',
    estimatedMinutes: 50,
    exercises: [
      {
        name: 'Incline Dumbbell Bench Press',
        sets: 3,
        targetReps: '8–12',
        rest: '2 min',
        cue: 'use a low 15–30° incline and control the stretch',
        substitutions: ['Smith Machine Incline Bench Press', 'Incline Chest Press Machine'],
      },
      {
        name: 'Neutral-Grip Lat Pulldown', sets: 3, targetReps: '8–12', rest: '2 min',
        substitutions: ['Lat Pulldown', 'Assisted Pull-Up'],
      },
      {
        name: 'Seated Row Machine', sets: 3, targetReps: '8–12', rest: '2 min',
        substitutions: ['Seated Cable Row', 'Chest-Supported Row Machine'],
      },
      {
        name: 'Machine Shoulder Press', sets: 2, targetReps: '8–12', rest: '2 min',
        substitutions: ['Dumbbell Shoulder Press', 'Plate-Loaded Shoulder Press'],
      },
      {
        name: 'Pec Deck Fly', sets: 2, targetReps: '10–15', rest: '60–90 sec',
        substitutions: ['Standing Cable Chest Fly', 'Dumbbell Chest Fly'],
      },
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

function formatExercisePrescription(
  exercise: Pick<WorkoutTemplateExercise, 'sets' | 'targetReps' | 'rest' | 'cue'>,
  recommendation: { weight?: string; label: string } | null,
): string {
  const base = recommendation?.label ?? 'Establish a clean baseline';
  const cue = exercise.cue ? ` · ${exercise.cue}` : '';
  return `${base} · ${exercise.sets} × ${exercise.targetReps} · rest ${exercise.rest}${cue}`;
}

function buildStrengthDraftExercise(
  exercise: WorkoutTemplateExercise,
  templateId: WorkoutTemplateId,
  createId: () => string,
  sessions: readonly WorkoutSession[],
  planDate: Date,
): WorkoutTemplateDraftExercise {
  const recommendation = buildWeightRecommendation(exercise, templateId, sessions, planDate);
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
    prescription: formatExercisePrescription(exercise, recommendation),
    recommendedWeight: recommendation?.weight,
    targetReps: exercise.targetReps,
    rest: exercise.rest,
    cue: exercise.cue,
    substitutionOptions: exercise.substitutions
      ? [exercise.name, ...exercise.substitutions]
      : undefined,
  };
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

  const exercises = template.exercises.map(exercise =>
    buildStrengthDraftExercise(exercise, template.id, createId, sessions, planDate));

  const cardio = template.id === 'recovery' ? recoveryCardio() : cardioFinisher();
  cardio.id = createId();
  exercises.push(cardio);

  return { template, exercises };
}

export function substituteWorkoutTemplateExercise(
  exercise: WorkoutTemplateDraftExercise,
  substituteName: string,
  templateId: WorkoutTemplateId,
  sessions: readonly WorkoutSession[] = [],
  planDate: Date = new Date(),
): WorkoutTemplateDraftExercise {
  const options = exercise.substitutionOptions ?? [];
  if (exercise.kind !== 'strength' || !options.includes(substituteName)) {
    throw new Error(`Unsupported exercise substitution: ${substituteName}`);
  }
  if (!exercise.targetReps || !exercise.rest) {
    throw new Error('Exercise substitution is missing its prescription');
  }

  const substitutedExercise: WorkoutTemplateExercise = {
    name: substituteName,
    sets: exercise.sets.length,
    targetReps: exercise.targetReps,
    rest: exercise.rest,
    cue: exercise.cue,
  };
  const recommendation = buildWeightRecommendation(
    substitutedExercise,
    templateId,
    sessions,
    planDate,
  );
  return {
    ...exercise,
    name: substituteName,
    sets: exercise.sets.map(set => ({ ...set, weight: '', reps: '' })),
    prescription: formatExercisePrescription(substitutedExercise, recommendation),
    recommendedWeight: recommendation?.weight,
  };
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

interface PriorExercise {
  exercise: Exercise;
  session: WorkoutSession;
}

function priorExercises(
  templateExercise: WorkoutTemplateExercise,
  templateId: WorkoutTemplateId,
  sessions: readonly WorkoutSession[],
  planDate: Date,
): PriorExercise[] {
  const historyName = normalizeExerciseName(templateExercise.name);
  const weekStart = getWorkoutPlanWeekStart(planDate).getTime();
  const seenSessionIds = new Set<string>();

  return [...sessions]
    .filter(session => Date.parse(session.date) < weekStart)
    .filter(session => session.templateId === templateId)
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date) || a.id.localeCompare(b.id))
    .flatMap(session => {
      if (seenSessionIds.has(session.id)) return [];
      seenSessionIds.add(session.id);
      const matches = session.exercises
        .filter(
          exercise =>
            (exercise.kind ?? 'strength') === 'strength' &&
            normalizeExerciseName(exercise.name) === historyName &&
            validSets(exercise).length > 0,
        )
        .sort((a, b) => {
          const aSets = validSets(a);
          const bSets = validSets(b);
          const aLatest = aSets[aSets.length - 1];
          const bLatest = bSets[bSets.length - 1];
          return (
            aLatest.weight - bLatest.weight ||
            aLatest.reps - bLatest.reps ||
            a.id.localeCompare(b.id)
          );
        });
      return matches[0] ? [{ exercise: matches[0], session }] : [];
    });
}

function targetRange(targetReps: string): [number, number] {
  const values = targetReps.split(/[^0-9]+/).filter(Boolean).map(Number);
  return [values[0], values[1] ?? values[0]];
}

function inferWeightIncrement(history: readonly PriorExercise[]): number | null {
  const weights = Array.from(
    new Set(history.flatMap(entry => validSets(entry.exercise).map(set => set.weight))),
  ).sort((a, b) => a - b);
  const increments = weights
    .slice(1)
    .map((weight, index) => weight - weights[index])
    .filter(increment => increment >= 2.5 && increment <= 10);
  return increments.length > 0 ? Math.min(...increments) : null;
}

function feedbackSupportsIncrease(session: WorkoutSession): boolean {
  if (session.pain || (session.effort !== 'easy' && session.effort !== 'right')) return false;
  const notes = session.notes?.trim();
  if (!notes) return false;
  const withoutNegatedSymptoms = notes
    .replace(
      /\b(?:no|without)\s+(?:(?:shoulder|joint)s?\s+)?(?:pain|issues?|problems?|discomfort|hurt|ache|aching|sore(?:ness)?|tired(?:ness)?|fatigue|pinch(?:ing)?|stiff(?:ness)?|instability|shakiness|grinding|struggling)(?:\s+(?:or|and)\s+(?:no\s+)?(?:(?:shoulder|joint)s?\s+)?(?:pain|issues?|problems?|discomfort|hurt|ache|aching|sore(?:ness)?|tired(?:ness)?|fatigue|pinch(?:ing)?|stiff(?:ness)?|instability|shakiness|grinding|struggling))?\b/gi,
      '',
    )
    .replace(
      /\b(?:did not|didn't|was not|wasn't)\s+(?:hurt|bother(?:ed|ing)?|feel (?:off|sore|tired|fatigued|stiff|a pinch)|sore|tired|fatigued|pinching|stiff|unstable|shaky|grinding|struggling)\b/gi,
      '',
    );
  const progressionNotes = withoutNegatedSymptoms
    .trim()
    .replace(/^[\s,;:.!?-]+/, '');
  const hasConcern = /\b(?:pain(?:ful)?|discomfort|hurt(?:s|ing)?|injur(?:y|ed)|ache|aching|sore(?:ness)?|tired(?:ness)?|fatigue(?:d)?|pinch(?:ing)?|stiff(?:ness)?|twinge|sharp|form broke|form breakdown|sloppy|too heavy|weak today|unstable|instability|shak(?:y|iness|ing)|grind(?:ing|s)?|struggl(?:e[ds]?|ing)|issues?|problems?|felt off|bother(?:s|ed|ing)?(?: me)?|act(?:ed|ing)? up)\b/i
    .test(progressionNotes);
  const hasContrastiveCaveat = /\b(?:but|however|although|though|except|yet)\b/i
    .test(progressionNotes);
  const noteBody = progressionNotes.replace(/[.!?]+$/, '');
  const hasAdditionalStatement = /[.!?;:\n\r]/.test(noteBody);
  const hasNegatedPositiveSignal = /\b(?:not|wasn't|weren't|isn't|aren't|didn't feel|did not feel|don't feel|do not feel)\s+(?:very\s+)?(?:strong|clean|controlled|stable|smooth|solid|snappy)\b/i
    .test(progressionNotes);
  const hasPositiveProgressionSignal = /\b(?:strong|clean|controlled|stable|smooth|solid|snappy)\b|\b(?:reps?|repetitions?)\s+(?:left|in reserve)\b|\bcould\s+(?:have\s+)?(?:do|done|perform(?:ed)?)\s+more\b/i
    .test(progressionNotes);
  return hasPositiveProgressionSignal
    && !hasConcern
    && !hasContrastiveCaveat
    && !hasAdditionalStatement
    && !hasNegatedPositiveSignal;
}

function buildWeightRecommendation(
  templateExercise: WorkoutTemplateExercise,
  templateId: WorkoutTemplateId,
  sessions: readonly WorkoutSession[],
  planDate: Date,
): { weight?: string; label: string } | null {
  const history = priorExercises(templateExercise, templateId, sessions, planDate);
  const previous = history[0]?.exercise;
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
        label: `Use one available load step below ${formatWeight(latestSet.weight)} lb`,
      };
    }
    recommended = Math.max(increment, latestSet.weight - increment);
    action = 'Reduce to';
  } else {
    const completedAtTop = (
      entry: PriorExercise | undefined,
      requiredWeight: number,
    ): boolean => {
      if (!entry) return false;
      const completedSets = validSets(entry.exercise).slice(-templateExercise.sets);
      return (
        completedSets.length === templateExercise.sets &&
        completedSets.every(
          set => set.weight === requiredWeight && set.reps >= maximum,
        )
      );
    };
    const earnedIncrease =
      completedAtTop(history[0], latestSet.weight) &&
      completedAtTop(history[1], latestSet.weight) &&
      feedbackSupportsIncrease(history[0].session) &&
      feedbackSupportsIncrease(history[1].session);
    if (earnedIncrease) {
      if (increment == null) {
        return {
          weight: '↑ 1 step',
          label: `Use the next available load step above ${formatWeight(latestSet.weight)} lb`,
        };
      }
      recommended = latestSet.weight + increment;
      action = 'Increase to';
    }
  }

  const weight = formatWeight(recommended);
  return { weight, label: `${action} ${weight} lb` };
}
