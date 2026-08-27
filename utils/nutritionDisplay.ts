import type { DailyMacroSummary } from './nutritionMemory';
import type { Goal } from '../types/health';

export interface NutritionGoalSelection {
  calories?: Goal;
  protein?: Goal;
  fiber?: Goal;
}

export interface MacroAverages {
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fiberG: number;
  loggedDays: number;
}

export type NutritionGoalStatus = 'below' | 'within' | 'above';

export function nutritionGoalReferenceValue(
  goal?: Pick<Goal, 'targetValue' | 'minimumValue' | 'maximumValue'>,
): number | undefined {
  return goal?.targetValue ?? goal?.maximumValue ?? goal?.minimumValue;
}

function formatValue(value: number, unit?: string): string {
  const rounded = Number.isInteger(value) ? value.toLocaleString('en-US') : value.toFixed(1);
  return `${rounded}${unit ? ` ${unit}` : ''}`;
}

function formatTarget(goal: Goal): string {
  const { minimumValue, targetValue, maximumValue, unit } = goal;
  if (minimumValue != null && maximumValue != null) {
    const range = `${minimumValue}–${maximumValue}${unit ? ` ${unit}` : ''}`;
    return targetValue != null ? `${range} · aim ${formatValue(targetValue, unit)}` : range;
  }
  if (targetValue != null) return formatValue(targetValue, unit);
  if (minimumValue != null) return `At least ${formatValue(minimumValue, unit)}`;
  if (maximumValue != null) return `Up to ${formatValue(maximumValue, unit)}`;
  return '';
}

export function selectNutritionGoals(goals: readonly Goal[]): NutritionGoalSelection {
  const active = goals.filter(goal => goal.status === 'active');
  return {
    calories: active.find(goal => goal.kind === 'calories'),
    protein: active.find(goal => goal.kind === 'protein'),
    fiber: active.find(goal => goal.kind === 'fiber'),
  };
}

export function formatNutritionProgress(value: number, goal?: Goal) {
  const progressTarget = goal?.minimumValue ?? goal?.targetValue ?? goal?.maximumValue;
  const minimum = goal?.minimumValue ?? goal?.targetValue;
  const maximum = goal?.maximumValue ?? goal?.targetValue;
  const status: NutritionGoalStatus =
    minimum != null && value < minimum
      ? 'below'
      : maximum != null && value > maximum
        ? 'above'
        : 'within';

  return {
    valueLabel: formatValue(value, goal?.unit),
    targetLabel: goal ? formatTarget(goal) : '',
    progress: progressTarget && progressTarget > 0 ? value / progressTarget : 0,
    status,
  };
}

export function averageMacroDays(days: readonly DailyMacroSummary[]): MacroAverages {
  const loggedDays = days.filter(day => day.entryCount > 0);
  if (loggedDays.length === 0) {
    return { calories: 0, proteinG: 0, carbsG: 0, fatG: 0, fiberG: 0, loggedDays: 0 };
  }

  const totals = loggedDays.reduce(
    (sum, day) => ({
      calories: sum.calories + day.calories,
      proteinG: sum.proteinG + day.proteinG,
      carbsG: sum.carbsG + day.carbsG,
      fatG: sum.fatG + day.fatG,
      fiberG: sum.fiberG + day.fiberG,
    }),
    { calories: 0, proteinG: 0, carbsG: 0, fatG: 0, fiberG: 0 },
  );

  return {
    calories: Math.round(totals.calories / loggedDays.length),
    proteinG: Math.round(totals.proteinG / loggedDays.length),
    carbsG: Math.round(totals.carbsG / loggedDays.length),
    fatG: Math.round(totals.fatG / loggedDays.length),
    fiberG: Math.round(totals.fiberG / loggedDays.length),
    loggedDays: loggedDays.length,
  };
}

export function buildCalorieHistoryScale(values: readonly number[], target?: number) {
  const highestValue = Math.max(1, ...values);
  const targetHeadroom = target && target > 0 ? Math.round(target * 1.1) : 0;
  const ceiling = Math.max(highestValue, targetHeadroom);

  return {
    ceiling,
    targetPercent: target && target > 0 ? Math.min(1, target / ceiling) : undefined,
    barPercent: (value: number) => Math.min(1, Math.max(0, value / ceiling)),
  };
}
