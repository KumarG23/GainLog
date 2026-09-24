import type { DayCheckIn, Focus, JourneyPreferences, SleepNight } from '../types/journey';
import type { Goal, HealthDaily, NutritionEntry } from '../types/health';
import type { WorkoutSession } from '../types/workout';
import type { HealthV2Today } from '../types/healthV2';
import { dayKey, daysBefore, duration, finite } from './healthspan.ts';

export const EMPTY_PREFERENCES: JourneyPreferences = { revision: 0, wakeTime: null, sleepMinutes: null, windDownMinutes: 30, focus: null };
export const FOCUS_LABELS: Record<Focus, string> = { sleep: 'Sleep rhythm', movement: 'Everyday movement', strength: 'Strength', nutrition: 'Nutrition', stress: 'Stress awareness' };
/** Pin writes to the revision the user actually edited, including after a refresh. */
export function assertDraftRevision(expected: number, current: number): void {
  if (!Number.isSafeInteger(expected) || expected < 0 || expected !== current) {
    throw new Error('The saved entry changed. Close and reopen the editor to review the latest version before saving.');
  }
}
export function emptyDay(date: string): DayCheckIn {
  return { date, revision: 0, updatedAt: null, energy: null, soreness: null, stress: null, trainingIntent: null, note: null, stressMinute: null, reflection: null, nutritionReviewed: false, nutritionReviewedAt: null, nutritionFingerprint: null };
}
export function recordedDay(value: string): string | null {
  const match = /^(\d{4}-\d{2}-\d{2})(?:$|T)/.exec(value);
  return match?.[1] ?? null;
}
export function sessionsOnDay(sessions: readonly WorkoutSession[], now: Date) {
  return [...new Map(sessions.filter(s => recordedDay(s.date) === dayKey(now) && Date.parse(s.date) <= now.getTime()).map(s => [s.id, s])).values()];
}
export function foodOnDay(entries: readonly NutritionEntry[], date: string, now = new Date()) {
  return [...new Map(entries.filter(e => recordedDay(e.date) === date && (e.date.length === 10 || Date.parse(e.date) <= now.getTime())).map(e => [e.id, e])).values()];
}
export function foodTotals(entries: readonly NutritionEntry[]) {
  return entries.reduce((a, e) => ({ calories: a.calories + e.calories, proteinG: a.proteinG + e.proteinG, fiberG: a.fiberG + e.fiberG }), { calories: 0, proteinG: 0, fiberG: 0 });
}
export function clockLabel(minutes: number) {
  const n = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
}
export function sleepPlan(p: JourneyPreferences) {
  if (!p.wakeTime || !/^([01]\d|2[0-3]):[0-5]\d$/.test(p.wakeTime) || !finite(p.sleepMinutes) || p.sleepMinutes < 300 || p.sleepMinutes > 660) return null;
  const [h, m] = p.wakeTime.split(':').map(Number);
  const bed = h * 60 + m - p.sleepMinutes;
  return { bedtime: clockLabel(bed), windDown: clockLabel(bed - p.windDownMinutes), wake: p.wakeTime, opportunity: duration(p.sleepMinutes) };
}
/** Non-security change token: any edit, deletion, or addition requires another review. */
export function foodFingerprint(meals: readonly NutritionEntry[]) {
  const data = JSON.stringify([...meals].sort((a, b) => a.id.localeCompare(b.id)).map(e => [e.id, e.date, e.meal, e.name, e.calories, e.proteinG, e.carbsG, e.fatG, e.fiberG, e.notes ?? '']));
  let a = 2166136261, b = 5381;
  for (let i = 0; i < data.length; i++) { a = Math.imul(a ^ data.charCodeAt(i), 16777619); b = Math.imul(b, 33) ^ data.charCodeAt(i); }
  return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
}
export function reviewedFood(check: DayCheckIn, meals: readonly NutritionEntry[]) {
  return !!check.nutritionReviewed && check.nutritionFingerprint === foodFingerprint(meals);
}
export function buildHistoricalDay(
  date: string,
  health: readonly HealthDaily[],
  sessions: readonly WorkoutSession[],
  meals: readonly NutritionEntry[],
  checks: readonly DayCheckIn[],
) {
  const healthRows = health.filter(row => row.date === date).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return {
    date,
    check: checks.find(check => check.date === date) ?? null,
    health: healthRows[0] ?? null,
    sessions: [...new Map(sessions.filter(session => recordedDay(session.date) === date).map(session => [session.id, session])).values()],
    meals: [...new Map(meals.filter(meal => recordedDay(meal.date) === date).map(meal => [meal.id, meal])).values()],
    recovery: null,
  };
}
export function segmentIndexForMinute(segments: readonly { startMinute: number }[], minute: number) {
  if (!segments.length) return -1;
  const boundedMinute = Math.max(0, Math.min(1439, minute));
  return segments.findIndex((segment, index) => boundedMinute >= segment.startMinute && boundedMinute < (segments[index + 1]?.startMinute ?? 1440));
}
export type BriefAction = 'checkin' | 'training' | 'fuel' | 'sleep' | 'reflection';
export interface DailyBrief { phase: 'Morning' | 'Daytime' | 'After training' | 'Evening'; title: string; body: string; action: BriefAction; actionLabel: string; evidence: string[] }
export interface BriefInput {
  now: Date; today: HealthV2Today | null; modelStale: boolean; healthStale: boolean; workoutsStale: boolean; journeyStale?: boolean;
  sessions: readonly WorkoutSession[]; meals: readonly NutritionEntry[]; check: DayCheckIn; preferences: JourneyPreferences; planTitle: string | null;
}
/** Evidence-ranked presentation, not a training prescription or a new health score. */
export function buildDailyBrief(input: BriefInput): DailyBrief {
  const { now, preferences, planTitle } = input;
  const date = dayKey(now), check = !input.journeyStale && input.check.date === date ? input.check : emptyDay(date);
  const model = !input.modelStale && input.today?.date === date ? input.today : null;
  const sessions = input.workoutsStale ? [] : sessionsOnDay(input.sessions, now);
  const meals = input.healthStale ? [] : foodOnDay(input.meals, date, now);
  const phase: DailyBrief['phase'] = now.getHours() >= 18 ? 'Evening' : sessions.length ? 'After training' : now.getHours() < 12 ? 'Morning' : 'Daytime';
  const evidence: string[] = [];
  if (sessions.length) evidence.push(`${sessions.length} session${sessions.length > 1 ? 's' : ''} logged today`);
  if (!input.healthStale) evidence.push(`${meals.length} food entr${meals.length === 1 ? 'y' : 'ies'} today`);
  const sleep = model?.sleep.components.duration?.valueMinutes;
  if (finite(sleep)) evidence.push(`${duration(sleep)} recorded sleep`);
  if (check.energy !== null) evidence.push(`Energy ${check.energy}/5 · your check-in`);
  const base = { phase, evidence };
  const recoveryUnavailable = input.modelStale ? ' Recovery data is unavailable right now.' : '';
  const nutritionUnavailable = input.healthStale ? ' Nutrition data is unavailable right now.' : '';
  const workoutsUnavailable = input.workoutsStale ? ' Training records could not be refreshed, so no training-status conclusion is shown.' : '';
  const journeyUnavailable = input.journeyStale ? ' Personal check-ins could not be loaded; wearable, workout, and nutrition records remain read-only.' : '';
  const unavailable = `${recoveryUnavailable}${nutritionUnavailable}${workoutsUnavailable}${journeyUnavailable}`;
  const hasSorenessOrLowEnergy = (check.soreness ?? 0) >= 4 || (check.energy !== null && check.energy <= 2);
  const stressContext = (check.stress ?? 0) >= 4 ? ' You reported a high-stress day. Keep that context beside your wearable signals; nothing has been automatically changed.' : '';
  if (sessions.length && hasSorenessOrLowEnergy) {
    return { ...base, title: 'Training is recorded. Your check-in still matters.', body: `Your session is logged, and you reported ${check.soreness !== null && check.soreness >= 4 ? 'substantial soreness' : 'low energy'}. Keep that context with your day; no second workout is pending.${stressContext}${unavailable}`, action: phase === 'Evening' ? 'reflection' : 'checkin', actionLabel: phase === 'Evening' ? 'Review tonight' : 'Update check-in' };
  }
  if (check.trainingIntent === 'rest' && hasSorenessOrLowEnergy) {
    return { ...base, title: 'Rest is still your plan. Your check-in matters.', body: `You chose rest and reported ${check.soreness !== null && check.soreness >= 4 ? 'substantial soreness' : 'low energy'}. GainLog has not changed that intention.${stressContext}${unavailable}`, action: phase === 'Evening' ? 'reflection' : 'checkin', actionLabel: phase === 'Evening' ? 'Review tonight' : 'Update check-in' };
  }
  if (sessions.length && input.modelStale) {
    return { ...base, title: 'Your workout is recorded.', body: `Training remains confirmed. Recovery data is unavailable right now.${nutritionUnavailable}${journeyUnavailable}`, action: phase === 'Evening' ? 'reflection' : input.healthStale ? 'sleep' : 'fuel', actionLabel: phase === 'Evening' ? 'Review tonight' : input.healthStale ? 'Plan tonight' : 'Review nutrition' };
  }
  if (hasSorenessOrLowEnergy) {
    return { ...base, title: 'Your check-in deserves attention.', body: `${model?.recovery.state === 'high' ? 'The recovery estimate looks strong, but ' : ''}you reported ${check.soreness !== null && check.soreness >= 4 ? 'substantial soreness' : 'low energy'}. Keep how you feel alongside the wearable signals when reviewing your plan.${stressContext}${unavailable}`, action: phase === 'Evening' ? 'reflection' : 'training', actionLabel: phase === 'Evening' ? 'Reflect on today' : 'Review today’s plan' };
  }
  if (phase === 'Evening') {
    const plan = sleepPlan(preferences);
    return { ...base, title: check.reflection ? 'Today is recorded. Tomorrow can wait.' : 'Bring your day to a close.', body: `${sessions.length ? 'Your training is logged. ' : check.trainingIntent === 'rest' ? 'You chose a rest day. ' : ''}${plan ? `Your chosen sleep window starts at ${plan.bedtime}; wind down at ${plan.windDown}.` : 'Choose your sleep window and leave a short reflection. No need to fill every ring.'}${stressContext}${unavailable}`, action: plan ? 'reflection' : 'sleep', actionLabel: plan ? 'Reflect on today' : 'Plan tonight' };
  }
  if (sessions.length) return { ...base, title: 'Your workout is done. Own the rest of your day.', body: `${input.healthStale ? 'Your session is logged; nutrition data is unavailable right now.' : reviewedFood(check, meals) ? 'Your training and food-log review are recorded. Your next step is simply to check tonight’s plan.' : 'Your session is logged. Review your food entries next—an incomplete log does not mean you have not eaten.'}${stressContext}${recoveryUnavailable}${journeyUnavailable}`, action: input.healthStale || reviewedFood(check, meals) ? 'sleep' : 'fuel', actionLabel: input.healthStale || reviewedFood(check, meals) ? 'Plan tonight' : 'Review nutrition' };
  if (check.trainingIntent === 'rest') return { ...base, title: 'Rest is part of your plan.', body: `You chose rest today. GainLog will not turn the absence of a workout into a missed target for this day.${stressContext}${unavailable}`, action: 'sleep', actionLabel: 'Plan tonight' };
  if (check.energy === null && check.soreness === null && check.stress === null) return { ...base, title: input.workoutsStale ? 'Use the context that is available.' : 'Start with how you feel.', body: `${model && model.recovery.state !== 'unavailable' ? 'Your overnight signals are ready. ' : 'Your day does not have to wait for a recovery score. '}${planTitle && !input.workoutsStale ? `${planTitle} is on your existing schedule. ` : ''}A quick check-in adds the context a wearable cannot supply.${unavailable}`, action: 'checkin', actionLabel: 'Check in · optional' };
  return { ...base, title: planTitle && !input.workoutsStale ? `${planTitle}, on your terms.` : 'Make space for your priorities.', body: `${planTitle && !input.workoutsStale ? 'Review your existing workout plan with today’s signals and your check-in together.' : input.workoutsStale ? 'Known recovery, nutrition, and check-in facts remain available without claiming today’s training status.' : 'No scheduled template today. Choose training or rest, and keep your longer-term focus in view.'}${stressContext}${unavailable} Nothing has been automatically changed.`, action: input.workoutsStale ? 'checkin' : 'training', actionLabel: input.workoutsStale ? 'Update check-in' : 'Review today’s plan' };
}
export function targetProgress(value: number | null, goal?: Goal) {
  const low = goal?.minimumValue ?? goal?.targetValue ?? null, high = goal?.maximumValue ?? goal?.targetValue ?? null;
  const scale = Math.max(value ?? 0, high ?? low ?? 1, 1) * 1.15;
  return { percent: value === null ? 0 : value / scale * 100, lowPercent: low === null ? null : low / scale * 100, highPercent: high === null ? null : high / scale * 100, note: value === null ? 'No entries loaded' : low !== null && value < low ? `${Math.round(low - value)} below your saved ${high === low ? 'target' : 'range minimum'} in the log` : high !== null && value > high ? 'Above the saved range in the log' : goal ? 'Within your saved target' : 'No target selected' };
}
export function sourceClock(utc: string, offset: number | null) {
  if (!finite(offset) || !Number.isFinite(Date.parse(utc))) return null;
  const d = new Date(Date.parse(utc) + offset * 1000);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}
export function buildSleepClockBasis(
  night: Pick<SleepNight, 'startUtc' | 'endUtc' | 'startOffsetSeconds' | 'endOffsetSeconds'>,
  stages: readonly { startUtc: string; endUtc: string }[],
) {
  const timestamps = [night.startUtc, night.endUtc, ...stages.flatMap(stage => [stage.startUtc, stage.endUtc])];
  const valid = timestamps.every(value => Number.isFinite(Date.parse(value)));
  const stableOffset = finite(night.startOffsetSeconds) && night.startOffsetSeconds === night.endOffsetSeconds;
  const offset = stableOffset ? Number(night.startOffsetSeconds) : 0;
  return {
    label: valid && stableOffset ? 'source local time' : 'UTC fallback',
    format: (utc: string) => {
      if (!valid || !Number.isFinite(Date.parse(utc))) return '—';
      const value = new Date(Date.parse(utc) + offset * 1000);
      return `${String(value.getUTCHours()).padStart(2, '0')}:${String(value.getUTCMinutes()).padStart(2, '0')}`;
    },
  };
}
export function sleepTimingSpread(nights: readonly SleepNight[]) {
  if (nights.length < 4 || new Set(nights.map(n => `${n.provenance}:${n.sourceId ?? 'unknown'}`)).size !== 1) return null;
  const starts = nights.map(n => sourceClock(n.startUtc, n.startOffsetSeconds)).filter(finite);
  if (starts.length < 4) return null;
  // Find a circular medoid, then the median absolute distance: midnight is not a discontinuity.
  const distance = (a: number, b: number) => Math.min(Math.abs(a - b), 1440 - Math.abs(a - b));
  const center = starts.reduce((best, v) => starts.reduce((s, x) => s + distance(v, x), 0) < starts.reduce((s, x) => s + distance(best, x), 0) ? v : best);
  const deviations = starts.map(v => distance(v, center)).sort((a, b) => a - b);
  const middle = Math.floor(deviations.length / 2);
  return Math.round(deviations.length % 2 ? deviations[middle] : (deviations[middle - 1] + deviations[middle]) / 2);
}
export interface Foundation { id: Focus; title: string; value: string; detail: string; days: (number | null)[]; observed: number; href: string }
export function buildFoundations(health: readonly HealthDaily[], sessions: readonly WorkoutSession[], meals: readonly NutritionEntry[], checks: readonly DayCheckIn[], end: string): Foundation[] {
  const dates = daysBefore(end, 7);
  const byDay = new Map<string, HealthDaily>();
  for (const row of health) { const previous = byDay.get(row.date); if (!previous || row.updatedAt > previous.updatedAt) byDay.set(row.date, row); }
  const series = (field: keyof HealthDaily) => dates.map(date => { const v = byDay.get(date)?.[field]; return finite(v) ? v : null; });
  const mean = (values: (number | null)[]) => { const present = values.filter(finite); return present.length ? present.reduce((a, b) => a + b, 0) / present.length : null; };
  const sleep = series('sleepMinutes'), steps = series('steps');
  const uniqueSessions = [...new Map(sessions.map(session => [session.id, session])).values()];
  const hasStrength = (session: WorkoutSession) => (finite(session.strengthSummary?.durationMinutes) && session.strengthSummary.durationMinutes > 0) || session.exercises.some(exercise => (exercise.kind ?? 'strength') === 'strength' && exercise.sets.length > 0);
  const cardioMinutes = (session: WorkoutSession) => finite(session.cardioSummary?.durationMinutes) && session.cardioSummary.durationMinutes > 0 ? session.cardioSummary.durationMinutes : session.exercises.filter(exercise => exercise.kind === 'cardio').reduce((total, exercise) => total + (finite(exercise.cardioDurationMinutes) && exercise.cardioDurationMinutes > 0 ? exercise.cardioDurationMinutes : 0), 0);
  const training = dates.map(date => uniqueSessions.filter(session => recordedDay(session.date) === date && hasStrength(session)).length);
  const cardio = dates.map(date => uniqueSessions.filter(session => recordedDay(session.date) === date).reduce((total, session) => total + cardioMinutes(session), 0));
  const food = dates.map(date => new Set(meals.filter(m => recordedDay(m.date) === date).map(m => m.id)).size);
  const stress = dates.map(date => checks.find(c => c.date === date)?.stress ?? null);
  const count = (values: (number | null)[]) => values.filter(finite).length;
  return [
    { id: 'sleep', title: 'Sleep & restoration', value: duration(mean(sleep)), detail: 'Average recorded sleep · seven completed days', days: sleep, observed: count(sleep), href: '/trends?metric=recovery' },
    { id: 'strength', title: 'Strength sessions', value: `${training.reduce((a, b) => a + b, 0)} sessions`, detail: 'Sessions containing recorded strength work · absence of a log is not proof of inactivity', days: training, observed: training.filter(v => v > 0).length, href: '/(tabs)/train' },
    { id: 'movement', title: 'Cardio & everyday movement', value: `${cardio.reduce((a, b) => a + b, 0)} min cardio · ${mean(steps) === null ? 'steps unavailable' : `${Math.round(mean(steps)!).toLocaleString()} avg steps`}`, detail: 'Logged cardio and wearable movement stay separate; they are not added into one score', days: cardio, observed: cardio.filter(v => v > 0).length, href: '/trends?metric=recovery' },
    { id: 'nutrition', title: 'Nutrition & body composition', value: `${food.filter(v => v > 0).length}/7 days logged`, detail: 'Logging coverage, not a diet-quality score', days: food, observed: food.filter(v => v > 0).length, href: '/(tabs)/fuel' },
    { id: 'stress', title: 'Stress awareness', value: `${count(stress)}/7 check-ins`, detail: 'Your reported stress · separate from wearable activation', days: stress, observed: count(stress), href: '/(tabs)/today' },
  ];
}
