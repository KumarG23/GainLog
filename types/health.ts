export interface BodyWeightEntry {
  id: string;
  date: string;
  weightLbs: number;
  notes?: string;
}

export interface Goal {
  id: string;
  kind: 'weight' | 'calories' | 'protein' | 'workout_frequency' | string;
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
  notes?: string;
}

export interface DashboardSummary {
  latestWeight: BodyWeightEntry | null;
  activeGoals: Goal[];
  todayNutrition: {
    calories: number;
    proteinG: number;
    carbsG: number;
    fatG: number;
  };
  workoutCount: number;
  totalWorkoutVolume: number;
  latestWorkout: unknown | null;
}
