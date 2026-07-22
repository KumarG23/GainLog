export interface WorkoutSet {
  id: string;
  weight: number; // lbs
  reps: number;
}

export type ExerciseKind = 'strength' | 'cardio';

export interface Exercise {
  id: string;
  name: string;
  kind?: ExerciseKind;
  sets: WorkoutSet[];
  cardioDurationMinutes?: number;
  distanceMiles?: number;
  resistanceLevel?: number;
}

export interface WorkoutActivitySummary {
  durationMinutes: number;
  avgHeartRate?: number;
  activeCalories?: number;
}

export interface WorkoutSession {
  id: string;
  date: string; // ISO 8601
  exercises: Exercise[];
  durationMinutes: number;
  avgHeartRate?: number; // bpm
  activeCalories?: number;
  strengthSummary?: WorkoutActivitySummary;
  cardioSummary?: WorkoutActivitySummary;
  notes?: string;
  insight?: string;
}
