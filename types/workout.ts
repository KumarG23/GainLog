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
  totalCalories?: number;
}

export type WorkoutEffort = 'easy' | 'right' | 'hard';
export type WorkoutTemplateId = 'push' | 'pull' | 'recovery' | 'legs' | 'upper';

export interface CoachInsight {
  headline: string;
  verdict: string;
  wins: string[];
  caveat?: string;
  nextAction: {
    title: string;
    detail: string;
  };
  question: string;
  confidence: 'low' | 'medium' | 'high';
}

export interface WorkoutSession {
  id: string;
  date: string; // ISO 8601
  exercises: Exercise[];
  durationMinutes: number;
  avgHeartRate?: number; // bpm
  activeCalories?: number;
  totalCalories?: number;
  strengthSummary?: WorkoutActivitySummary;
  cardioSummary?: WorkoutActivitySummary;
  notes?: string;
  insight?: string;
  coachInsight?: CoachInsight;
  templateId?: WorkoutTemplateId;
  effort?: WorkoutEffort;
  pain?: boolean;
}
