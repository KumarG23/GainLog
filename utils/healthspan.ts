import type { BodyWeightEntry, Goal, HealthDaily, NutritionEntry } from '../types/health';
import type { WorkoutSession } from '../types/workout';
import type { HealthV2Today } from '../types/healthV2';

export const isHealthspanUIEnabled = (value = process.env.EXPO_PUBLIC_GAINLOG_V2_UI) => value === '1';
export const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
export const label = (state: string) => state.replaceAll('_', ' ').replace(/\b\w/g, c => c.toUpperCase());
export const numberLabel = (value: unknown, digits = 0) => finite(value) ? value.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits }) : '—';
export function durationLabel(value: unknown): string {
  if (!finite(value) || value < 0) return '—';
  const minutes = Math.round(value);
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}
export const greeting = (hour: number) => hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
export function localDay(value = new Date()): string {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}
export function entryDay(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? localDay(date) : '';
}
export function shiftDay(day: string, offset: number): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}
export const daysEnding = (end: string, count: number) => Array.from({ length: count }, (_, i) => shiftDay(end, i - count + 1));

export interface Observation { date: string; value: number; source?: string }
export interface TrendWindow {
  points: Observation[];
  recent: number | null;
  baseline: number | null;
  delta: number | null;
  observed: number;
  baselineObserved: number;
  mixedSources: boolean;
}
/** Seven completed calendar days vs the preceding 28. Missing days are not zeroes. */
export function compareCompleteDays(points: Observation[], today: string): TrendWindow {
  const end = shiftDay(today, -1);
  const start = shiftDay(end, -6);
  const baselineStart = shiftDay(start, -28);
  const byDay = new Map<string, Observation>();
  for (const point of points) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(point.date) && finite(point.value) && point.date >= baselineStart && point.date <= end) byDay.set(point.date, point);
  }
  const observed = [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));
  const recent = observed.filter(point => point.date >= start);
  const baseline = observed.filter(point => point.date < start);
  const average = (rows: Observation[]) => rows.reduce((sum, row) => sum + row.value, 0) / rows.length;
  const mixedSources = new Set(observed.map(point => point.source).filter(Boolean)).size > 1;
  const recentValue = recent.length ? average(recent) : null;
  const baselineValue = baseline.length >= 7 ? average(baseline) : null;
  return {
    points: observed.filter(point => point.date >= shiftDay(end, -27)),
    recent: recentValue,
    baseline: baselineValue,
    // Do not imply comparable physiology across a source transition or sparse window.
    delta: recent.length >= 3 && baselineValue != null && !mixedSources ? recentValue! - baselineValue : null,
    observed: recent.length,
    baselineObserved: baseline.length,
    mixedSources,
  };
}
export function healthObservations(rows: HealthDaily[], key: keyof HealthDaily): Observation[] {
  const latest = new Map<string, HealthDaily>();
  for (const row of [...rows].sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))) latest.set(entryDay(row.date), row);
  return [...latest.values()].flatMap(row => finite(row[key]) ? [{ date: entryDay(row.date), value: row[key] as number, source: row.source }] : []);
}
export function weightObservations(rows: BodyWeightEntry[], key: 'weightLbs' | 'bodyFatPercent' = 'weightLbs'): Observation[] {
  const latest = new Map<string, BodyWeightEntry>();
  for (const row of [...rows].sort((a, b) => Date.parse(a.date) - Date.parse(b.date))) latest.set(entryDay(row.date), row);
  return [...latest.values()].flatMap(row => finite(row[key]) ? [{ date: entryDay(row.date), value: row[key] as number, source: row.source }] : []);
}
export function goalFor(goals: Goal[], kind: string): Goal | undefined {
  return goals.find(goal => goal.status === 'active' && goal.kind === kind);
}
export function goalLabel(goal?: Goal): string {
  if (!goal) return 'No target set';
  const { minimumValue: min, maximumValue: max, targetValue: target, unit = '' } = goal;
  const suffix = unit ? ` ${unit}` : '';
  if (finite(min) && finite(max)) return `${numberLabel(min)}–${numberLabel(max)}${suffix}`;
  if (finite(target)) return `${numberLabel(target)}${suffix}`;
  if (finite(min)) return `At least ${numberLabel(min)}${suffix}`;
  if (finite(max)) return `Up to ${numberLabel(max)}${suffix}`;
  return 'No numeric target';
}
export function progressFraction(value: number, goal?: Goal): number | null {
  const target = goal?.targetValue ?? goal?.minimumValue ?? goal?.maximumValue;
  return finite(value) && finite(target) && target > 0 ? Math.max(0, Math.min(1, value / target)) : null;
}
export const emptyMacros = () => ({ calories: 0, proteinG: 0, carbsG: 0, fatG: 0, fiberG: 0 });
export function nutritionOnDay(entries: NutritionEntry[], day: string) {
  const rows = [...new Map(entries.map(entry => [entry.id, entry])).values()].filter(entry => entryDay(entry.date) === day);
  const totals = emptyMacros();
  for (const row of rows) for (const key of Object.keys(totals) as (keyof typeof totals)[]) if (finite(row[key])) totals[key] += row[key];
  return { rows, totals };
}
export function trainingWeek(sessions: WorkoutSession[], today: string) {
  const date = new Date(`${today}T12:00:00Z`);
  const start = shiftDay(today, -((date.getUTCDay() + 6) % 7));
  const unique = [...new Map(sessions.map(session => [session.id, session])).values()];
  const rows = unique.filter(session => entryDay(session.date) >= start && entryDay(session.date) <= today);
  return {
    start,
    rows,
    minutes: rows.reduce((sum, row) => sum + (finite(row.durationMinutes) ? row.durationMinutes : 0), 0),
    days: daysEnding(shiftDay(start, 6), 7).map(day => ({ day, count: rows.filter(row => entryDay(row.date) === day).length, future: day > today })),
  };
}
/** A compact chart path breaks at missing calendar dates rather than interpolating them. */
export function sparklineGeometry(points: Observation[], end: string, count = 28) {
  const keys = daysEnding(end, count);
  const byDay = new Map(points.filter(point => finite(point.value)).map(point => [point.date, point.value]));
  const values = keys.map(key => byDay.get(key)).filter(finite);
  if (!values.length) return { path: '', dots: [] as { x: number; y: number }[] };
  const low = Math.min(...values), high = Math.max(...values);
  const span = Math.max(high - low, Math.abs(high) * 0.05, 1);
  let connected = false;
  const dots: { x: number; y: number }[] = [];
  const segments = keys.map((key, i) => {
    const value = byDay.get(key);
    if (!finite(value)) { connected = false; return ''; }
    const x = 3 + i * 234 / Math.max(1, count - 1);
    const y = high === low ? 30 : 52 - (value - low) / span * 42;
    const command = `${connected ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`;
    dots.push({ x, y }); connected = true;
    return command;
  });
  return { path: segments.join(' '), dots };
}
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const score = (value: unknown) => value === null || (finite(value) && value >= 0 && value <= 100);
/** Boundary validation; never treat an error page or a different date as today's physiology. */
export function validTodayPayload(value: unknown, date: string): value is HealthV2Today {
  if (!record(value) || value.date !== date || typeof value.version !== 'string' || typeof value.provenance !== 'string') return false;
  for (const key of ['recovery', 'sleep', 'load', 'stress']) {
    const domain = value[key];
    if (!record(domain) || typeof domain.state !== 'string' || !finite(domain.confidence) || domain.confidence < 0 || domain.confidence > 1) return false;
    if (key !== 'load' && !score(domain.score)) return false;
    if (key !== 'stress' && (!record(domain.components) || !Object.values(domain.components).every(record))) return false;
  }
  const load = value.load as Record<string, unknown>;
  if (load.loadPoints !== null && (!finite(load.loadPoints) || load.loadPoints < 0)) return false;
  const stress = value.stress as Record<string, unknown>;
  if (typeof stress.baselineReady !== 'boolean' || !Array.isArray(stress.segments) || stress.segments.length > 48) return false;
  for (const key of ['expectedMinutes', 'observedHeartRateMinutes', 'scoredMinutes', 'baselineDays']) if (!finite(stress[key]) || (stress[key] as number) < 0) return false;
  if ((stress.expectedMinutes as number) > 1440 || (stress.observedHeartRateMinutes as number) > 1440 || (stress.scoredMinutes as number) > 1440) return false;
  return stress.segments.every(segment => record(segment) && finite(segment.startMinute) && segment.startMinute >= 0 && segment.startMinute < 1440 && typeof segment.state === 'string' && score(segment.score) && finite(segment.confidence) && segment.confidence >= 0 && segment.confidence <= 1);
}
export function signalStory(data: HealthV2Today): string {
  const hrv = data.recovery.components.hrv;
  const rhr = data.recovery.components.restingHeartRate;
  const sleep = data.sleep.components.duration;
  const facts: string[] = [];
  if (finite(hrv?.deviationPercent)) facts.push(`HRV is ${numberLabel(Math.abs(hrv.deviationPercent), 1)}% ${hrv.deviationPercent >= 0 ? 'above' : 'below'} your personal baseline.`);
  if (finite(rhr?.valueBpm)) facts.push(`Resting heart rate is ${numberLabel(rhr.valueBpm)} bpm.`);
  if (finite(sleep?.valueMinutes)) facts.push(`Sleep lasted ${durationLabel(sleep.valueMinutes)}.`);
  return facts.length ? facts.join(' ') : 'Some signals are missing. Available measurements are shown without filling the gaps or inventing a score.';
}
export function timeAtMinute(minute: number): string {
  const safe = Math.max(0, Math.min(1440, Math.floor(minute)));
  return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`;
}
