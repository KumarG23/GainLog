import type { BodyWeightEntry, NutritionEntry } from '../types/health';
import type { WorkoutSession } from '../types/workout';

export type TrendRange = '7D' | '30D' | '90D' | 'ALL';

export interface WeightTrendPoint {
  date: string;
  value: number;
  bodyFatPercent?: number;
  leanBodyMassLbs?: number;
}

export interface NutritionTrendPoint {
  date: string;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fiberG: number;
}

export interface TrainingTrendPoint {
  date: string;
  volume: number;
  sessions: number;
  minutes: number;
}

export function resolveChartWidth(
  layoutWidth: number,
  viewportWidth: number,
  horizontalInset: number,
): number {
  if (layoutWidth > 0) return layoutWidth;
  return Math.max(viewportWidth - horizontalInset, 0);
}

export function resolveChartDomain(
  values: number[],
  goal?: number,
  floorAtZero = false,
): {
  min: number;
  max: number;
  goalVisible: boolean;
} {
  const dataMin = Math.min(...values);
  const dataMax = Math.max(...values);
  const dataSpread = dataMax - dataMin || Math.max(Math.abs(dataMax) * 0.08, 1);
  const goalDistance = goal == null
    ? Number.POSITIVE_INFINITY
    : goal < dataMin
      ? dataMin - goal
      : goal > dataMax
        ? goal - dataMax
        : 0;
  const goalVisible = goal != null && goalDistance <= dataSpread * 0.75;
  const domainValues = goalVisible ? [...values, goal] : values;
  const rawMin = Math.min(...domainValues);
  const rawMax = Math.max(...domainValues);
  const spread = rawMax - rawMin || dataSpread;
  return {
    min: floorAtZero ? Math.max(0, rawMin - spread * 0.12) : rawMin - spread * 0.12,
    max: rawMax + spread * 0.12,
    goalVisible,
  };
}

function dateKey(isoString: string): string {
  return isoString.slice(0, 10);
}

function dateNumber(key: string): number {
  return Date.parse(`${key}T12:00:00Z`);
}

function addDays(key: string, days: number): string {
  const date = new Date(dateNumber(key));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function mondayKey(key: string): string {
  const date = new Date(dateNumber(key));
  const daysSinceMonday = (date.getUTCDay() + 6) % 7;
  return addDays(key, -daysSinceMonday);
}

export function relativeDatePositions(dateKeys: string[]): number[] {
  if (dateKeys.length === 0) return [];
  if (dateKeys.length === 1) return [0.5];
  const values = dateKeys.map(dateNumber);
  const first = values[0];
  const span = values[values.length - 1] - first;
  if (span <= 0) return values.map(() => 0.5);
  return values.map(value => (value - first) / span);
}

export function aggregateWeightTrend(entries: BodyWeightEntry[]): WeightTrendPoint[] {
  const latestByDay = new Map<string, BodyWeightEntry>();

  for (const entry of entries) {
    const key = dateKey(entry.date);
    const existing = latestByDay.get(key);
    if (!existing || Date.parse(entry.date) >= Date.parse(existing.date)) {
      latestByDay.set(key, entry);
    }
  }

  return [...latestByDay.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, entry]) => ({
      date,
      value: entry.weightLbs,
      bodyFatPercent: entry.bodyFatPercent,
      leanBodyMassLbs: entry.leanBodyMassLbs,
    }));
}

export function aggregateNutritionTrend(
  entries: NutritionEntry[],
  excludedDate?: string,
): NutritionTrendPoint[] {
  const byDay = new Map<string, NutritionTrendPoint>();

  for (const entry of entries) {
    const key = dateKey(entry.date);
    if (key === excludedDate) continue;
    const current = byDay.get(key) ?? {
      date: key,
      calories: 0,
      proteinG: 0,
      carbsG: 0,
      fatG: 0,
      fiberG: 0,
    };
    current.calories += entry.calories;
    current.proteinG += entry.proteinG;
    current.carbsG += entry.carbsG;
    current.fatG += entry.fatG;
    current.fiberG += entry.fiberG;
    byDay.set(key, current);
  }

  return [...byDay.values()].sort((left, right) => left.date.localeCompare(right.date));
}

export function aggregateTrainingTrend(sessions: WorkoutSession[]): TrainingTrendPoint[] {
  const byWeek = new Map<string, TrainingTrendPoint>();

  for (const session of sessions) {
    const key = mondayKey(dateKey(session.date));
    const current = byWeek.get(key) ?? { date: key, volume: 0, sessions: 0, minutes: 0 };
    const strengthVolume = session.exercises.reduce((exerciseTotal, exercise) => {
      if (exercise.kind === 'cardio') return exerciseTotal;
      return exerciseTotal + exercise.sets.reduce(
        (setTotal, set) => setTotal + set.weight * set.reps,
        0,
      );
    }, 0);

    current.volume += strengthVolume;
    current.sessions += 1;
    current.minutes += session.durationMinutes;
    byWeek.set(key, current);
  }

  const populated = [...byWeek.values()].sort((left, right) => left.date.localeCompare(right.date));
  if (populated.length < 2) return populated;

  const result: TrainingTrendPoint[] = [];
  const lastWeek = populated[populated.length - 1].date;
  for (let week = populated[0].date; week <= lastWeek; week = addDays(week, 7)) {
    result.push(byWeek.get(week) ?? { date: week, volume: 0, sessions: 0, minutes: 0 });
  }
  return result;
}

export function filterTrendRange<T extends { date: string }>(
  points: T[],
  range: TrendRange,
  todayKey: string,
): T[] {
  if (range === 'ALL') return points;
  const days = Number.parseInt(range, 10);
  const start = addDays(todayKey, -(days - 1));
  return points.filter(point => point.date >= start && point.date <= todayKey);
}

export function withRollingAverage<T extends { date: string }>(
  points: T[],
  valueKey: keyof T,
  windowDays = 7,
): Array<T & { average: number }> {
  return points.map((point, index) => {
    const start = addDays(point.date, -(windowDays - 1));
    const values = points
      .slice(0, index + 1)
      .filter(candidate => candidate.date >= start && candidate.date <= point.date)
      .map(candidate => Number(candidate[valueKey]))
      .filter(Number.isFinite);
    const average = values.reduce((sum, value) => sum + value, 0) / values.length;
    return { ...point, average };
  });
}

export function buildTrendSeries<T extends { date: string; value: number }>(
  points: T[],
  range: TrendRange,
  todayKey: string,
  rollingWindowDays?: number,
): Array<T & { average?: number }> {
  const prepared = rollingWindowDays == null
    ? points
    : withRollingAverage(points, 'value', rollingWindowDays);
  return filterTrendRange(prepared, range, todayKey);
}
