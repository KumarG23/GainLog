export interface BodyWeightEntry {
  id: string;
  date: string;
  weightLbs: number;
  bodyFatPercent?: number;
  leanBodyMassLbs?: number;
  bmi?: number;
  source?: string;
  sourceRecordId?: string;
  notes?: string;
}

export interface AppleHealthDaily {
  date: string;
  sleepMinutes?: number;
  deepSleepMinutes?: number;
  coreSleepMinutes?: number;
  remSleepMinutes?: number;
  awakeMinutes?: number;
  restingHeartRateBpm?: number;
  hrvMs?: number;
  steps?: number;
  activeCalories?: number;
  exerciseMinutes?: number;
  standHours?: number;
  walkingRunningMiles?: number;
  source: 'apple-health';
  updatedAt: string;
}

export interface Goal {
  id: string;
  kind: 'weight' | 'calories' | 'protein' | 'fiber' | 'workout_frequency' | string;
  title: string;
  targetValue?: number;
  unit?: string;
  startDate: string;
  targetDate?: string;
  status: 'active' | 'completed' | 'paused' | string;
  notes?: string;
}

export interface NutritionEntry {
  id: string;
  date: string;
  meal: string;
  name: string;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fiberG: number;
  notes?: string;
}

export interface DashboardSummary {
  latestWeight: BodyWeightEntry | null;
  todayHealth: AppleHealthDaily | null;
  activeGoals: Goal[];
  todayNutrition: {
    calories: number;
    proteinG: number;
    carbsG: number;
    fatG: number;
    fiberG: number;
  };
  workoutCount: number;
  totalWorkoutVolume: number;
  latestWorkout: unknown | null;
}

export interface CoachStatus {
  provider: string;
  model?: string;
  baseUrl?: string;
  configured: boolean;
}

export interface DailyReview {
  date: string;
  review: string;
  generatedAt: string;
}
