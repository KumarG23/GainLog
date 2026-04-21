export interface WorkoutSet {
  id: string;
  weight: number; // lbs
  reps: number;
}

export interface Exercise {
  id: string;
  name: string;
  sets: WorkoutSet[];
}

export interface WorkoutSession {
  id: string;
  date: string; // ISO 8601
  exercises: Exercise[];
  durationMinutes: number;
  avgHeartRate?: number; // bpm
  activeCalories?: number;
  notes?: string;
  insight?: string;
}
