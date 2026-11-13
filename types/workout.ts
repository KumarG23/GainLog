export interface WorkoutSet {
  id: string;
  weight: number; // lbs
  reps: number;
  measure?: 'reps' | 'seconds';
  seconds?: number;
}

export type ExerciseKind = 'strength' | 'cardio';

export interface Exercise {
  id: string;
  name: string;
  kind?: ExerciseKind;
  sets: WorkoutSet[];
  targetRepsMin?: number;
  targetRepsMax?: number;
  prescribedSets?: number;
  cardioDurationMinutes?: number;
  cardioStartedAt?: string;
  cardioEndedAt?: string;
  distanceMiles?: number;
  resistanceLevel?: number;
  inclinePercent?: number;
}

export interface WorkoutActivitySummary {
  durationMinutes: number;
  avgHeartRate?: number;
  activeCalories?: number;
  totalCalories?: number;
}

export interface CardioAnalysis {
  windowSource?: 'recorded' | 'unverified';
  segments: { name: string; start?: string; end?: string; coverage: number; coveredMinutes: number; averageHr: number | null; zone2Minutes: number | null }[];
  zone2Minutes: number | null;
  benchmarkAverageHr: number | null;
  benchmarkCoverage: number | null;
  protocolCompliant: boolean;
  source: 'google-health' | 'health-connect' | 'none';
  band: [number, number];
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
  cardioAnalysis?: CardioAnalysis | null;
  notes?: string;
  insight?: string;
  coachInsight?: CoachInsight;
  templateId?: WorkoutTemplateId;
  effort?: WorkoutEffort;
  pain?: boolean;
}
