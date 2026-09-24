/** Presentation-only calculations. Never writes goals or creates medical scores. */
export const isHealthspanEnabled = (value = process.env.EXPO_PUBLIC_GAINLOG_V2_SHELL) => value === '1';
export const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
export function dayKey(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function entryDay(value: string): string | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : dayKey(date);
}
export function daysBefore(end: string, count: number): string[] {
  const date = new Date(`${end}T12:00:00`);
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(date); d.setDate(d.getDate() - count + i); return dayKey(d);
  });
}
export function greeting(date = new Date()): string {
  return date.getHours() < 12 ? 'Good morning' : date.getHours() < 18 ? 'Good afternoon' : 'Good evening';
}
export function duration(value: unknown): string {
  if (!finite(value) || value < 0) return '—';
  const minutes = Math.round(value);
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}
export function numberLabel(value: unknown, digits = 0): string {
  return finite(value) ? value.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits }) : '—';
}
export function stateLabel(value: string): string {
  return value.replaceAll('_', ' ').replace(/\b\w/g, c => c.toUpperCase());
}
export function confidenceLabel(value: unknown): string {
  return !finite(value) || value <= 0 ? 'Unavailable' : value < 0.75 ? 'Partial' : 'High';
}
export type MetricRow = { date: string; source?: string; updatedAt?: string };
export type Trend = { points: (number | null)[]; recent: number | null; previous: number | null; delta: number | null; recentDays: number; previousDays: number; sourceChanged: boolean };
export function metricTrend(rows: readonly MetricRow[], field: string, end = dayKey()): Trend {
  // Only completed calendar days. Missing observations remain gaps, never zeroes.
  const map = new Map<string, MetricRow>();
  for (const row of rows) {
    const key = entryDay(row.date);
    if (!key) continue;
    const prior = map.get(key);
    if (!prior || (row.updatedAt ?? row.date) >= (prior.updatedAt ?? prior.date)) map.set(key, row);
  }
  const window = daysBefore(end, 14).map(key => map.get(key));
  const points = window.map(row => { const value = row ? (row as unknown as Record<string, unknown>)[field] : null; return finite(value) ? value : null; });
  const before = points.slice(0, 7).filter(finite), after = points.slice(7).filter(finite);
  const mean = (values: number[]) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
  const previous = mean(before), recent = mean(after);
  const sources = new Set(window.filter((row, i) => points[i] !== null).map(row => row?.source ?? 'unknown'));
  const sourceChanged = sources.size > 1;
  return { points, recent, previous, recentDays: after.length, previousDays: before.length, sourceChanged,
    delta: !sourceChanged && before.length >= 4 && after.length >= 4 && recent !== null && previous !== null ? recent - previous : null };
}
export function trendCaption(trend: Trend, unit: string, digits = 1): string {
  if (trend.sourceChanged) return 'Source changed · comparison paused';
  if (trend.delta === null) return `${trend.recentDays}/7 recent days · more data needed to compare`;
  const delta = Number(trend.delta.toFixed(digits));
  return `${delta > 0 ? '+' : ''}${delta.toFixed(digits)} ${unit} vs previous 7 days · ${trend.recentDays}/7 days`;
}
export function calendarWeekSessions<T extends { date: string }>(sessions: readonly T[], now = new Date()): T[] {
  const start = new Date(now); start.setHours(0, 0, 0, 0); start.setDate(start.getDate() - (start.getDay() + 6) % 7);
  return sessions.filter(session => { const time = new Date(session.date).getTime(); return time >= start.getTime() && time <= now.getTime(); });
}
export type GoalLike = { kind: string; status: string; targetValue?: number; minimumValue?: number; maximumValue?: number; unit?: string };
export function goalLabel(goal?: GoalLike): string {
  if (!goal) return 'No target set';
  const { minimumValue: min, maximumValue: max, targetValue: aim } = goal;
  const parts: string[] = [];
  if (finite(min) && finite(max)) parts.push(`${min}–${max}`);
  else if (finite(min)) parts.push(`At least ${min}`);
  else if (finite(max)) parts.push(`Up to ${max}`);
  if (finite(aim)) parts.push(parts.length ? `aim ${aim}` : `${aim}`);
  return parts.length ? `${parts.join(' · ')} ${goal.unit ?? ''}`.trim() : 'No target set';
}
export function todayInterpretation(recovery: { state: string; components: Record<string, { deviationPercent?: number; deviationBpm?: number }> }, sleepMinutes?: number): string {
  if (recovery.state === 'unavailable' || recovery.state === 'warming_up') return 'Not enough signals for a recovery estimate yet. Missing data is not a low score.';
  const parts = [recovery.state === 'high' ? 'Your recovery signals look strong today.' : recovery.state === 'moderate' ? 'Your recovery signals are mixed today.' : recovery.state === 'low' ? 'Your recovery estimate is lower today.' : 'Your available recovery signals are shown above.'];
  const hrv = recovery.components.hrv?.deviationPercent;
  const rhr = recovery.components.restingHeartRate?.deviationBpm;
  if (finite(hrv)) parts.push(`HRV is ${Math.abs(hrv).toFixed(0)}% ${hrv >= 0 ? 'above' : 'below'} your baseline.`);
  if (finite(rhr)) parts.push(`Resting heart rate is ${Math.abs(rhr).toFixed(0)} bpm ${rhr >= 0 ? 'above' : 'below'} baseline.`);
  if (finite(sleepMinutes)) parts.push(`Recorded sleep: ${duration(sleepMinutes)}.`);
  return parts.join(' ');
}
