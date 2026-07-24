export type WorkoutTemplateId = 'push' | 'pull' | 'legs' | 'upper' | 'lower-arms';

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
    id: 'legs',
    weekday: 'Wednesday',
    title: 'Legs',
    focus: 'Quads · hamstrings · glutes · calves',
    estimatedMinutes: 55,
    exercises: [
      { name: '45-Degree Leg Press', sets: 3, targetReps: '8–12', rest: '2–3 min' },
      { name: 'Smith Machine Romanian Deadlift', sets: 3, targetReps: '8–12', rest: '2–3 min' },
      { name: 'Leg Extension', sets: 3, targetReps: '10–15', rest: '60–90 sec' },
      { name: 'Seated Leg Curl', sets: 3, targetReps: '10–15', rest: '60–90 sec' },
      { name: 'Calf Press on Leg Press', sets: 3, targetReps: '12–20', rest: '60–90 sec' },
    ],
  },
  {
    id: 'upper',
    weekday: 'Thursday',
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
  {
    id: 'lower-arms',
    weekday: 'Friday',
    title: 'Lower + Arms',
    focus: 'Legs · biceps · triceps',
    estimatedMinutes: 55,
    exercises: [
      { name: 'Smith Machine Squat', sets: 3, targetReps: '8–12', rest: '2–3 min' },
      { name: 'Seated Leg Curl', sets: 3, targetReps: '10–15', rest: '90 sec' },
      { name: 'Leg Extension', sets: 2, targetReps: '10–15', rest: '90 sec' },
      { name: 'Calf Raise Machine', sets: 3, targetReps: '12–20', rest: '60–90 sec' },
      { name: 'Machine Preacher Curl', sets: 3, targetReps: '10–15', rest: '60–90 sec' },
      { name: 'Cable Triceps Pressdown', sets: 3, targetReps: '10–15', rest: '60–90 sec' },
    ],
  },
];

export function getSuggestedTemplateId(dayOfWeek: number): WorkoutTemplateId | null {
  const weekdayIds: Partial<Record<number, WorkoutTemplateId>> = {
    1: 'push',
    2: 'pull',
    3: 'legs',
    4: 'upper',
    5: 'lower-arms',
  };
  return weekdayIds[dayOfWeek] ?? null;
}

export function buildWorkoutTemplateDraft(
  templateId: string,
  createId: () => string,
): BuiltWorkoutTemplateDraft {
  const template = PLANET_FITNESS_TEMPLATES.find(item => item.id === templateId);
  if (!template) {
    throw new Error(`Unknown workout template: ${templateId}`);
  }

  const exercises: WorkoutTemplateDraftExercise[] = template.exercises.map(exercise => ({
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
    prescription: `${exercise.sets} sets · ${exercise.targetReps} reps · rest ${exercise.rest}`,
  }));

  const cardio = cardioFinisher();
  cardio.id = createId();
  exercises.push(cardio);

  return { template, exercises };
}
