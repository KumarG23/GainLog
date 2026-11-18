import assert from 'node:assert/strict';
import test from 'node:test';
import {
  INTERVAL_SESSION_NAME,
  intervalProtocol,
  intervalReadiness,
  isIntervalCardioName,
} from '../utils/cardioPlan.ts';
import { buildWorkoutTemplateDraft } from '../utils/workoutTemplates.ts';

const now = new Date(2026, 10, 12, 12);
const previous = days => {
  const day = new Date(now);
  day.setDate(day.getDate() - days);
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
};
const baseline = Array.from({ length: 7 }, (_, i) => ({
  date: previous(i + 2), sleepMinutes: 450, hrvMs: 50, restingHeartRateBpm: 60,
}));
const yesterday = { date: previous(1), sleepMinutes: 450, hrvMs: 50, restingHeartRateBpm: 60 };

test('readiness uses last completed night and seven preceding full calendar days', () => {
  assert.deepEqual(intervalReadiness([yesterday, ...baseline], now), { status: 'clear', reasons: [] });
  const swap = intervalReadiness([
    { ...yesterday, sleepMinutes: 350, hrvMs: 42, restingHeartRateBpm: 65 },
    ...baseline, { date: previous(0), sleepMinutes: 0, hrvMs: 1 },
  ], now);
  assert.equal(swap.status, 'swap');
  assert.equal(swap.reasons.length, 3);
  assert.equal(intervalReadiness([{ ...yesterday, hrvMs: 42.5 }, ...baseline], now).status, 'clear');
  assert.equal(intervalReadiness([{ ...yesterday, restingHeartRateBpm: 64.9 }, ...baseline], now).status, 'clear');
});

test('missing and partial history is unknown, but observed sleep veto still applies', () => {
  assert.equal(intervalReadiness([], now).status, 'unknown');
  assert.equal(intervalReadiness([yesterday, ...baseline.slice(1)], now).status, 'unknown');
  assert.equal(intervalReadiness([{ ...yesterday, sleepMinutes: 350 }, ...baseline.slice(1)], now).status, 'swap');
  assert.equal(intervalReadiness([{ ...yesterday, hrvMs: null }, ...baseline], now).status, 'unknown');
});

test('interval day is one cardio entry with one timer, not a timer per segment', () => {
  assert.deepEqual(intervalProtocol(4).map(item => item.minutes), [10, 4, 3, 4, 3, 4, 3, 4, 5]);
  let counter = 0;
  const draft = (option) => buildWorkoutTemplateDraft('recovery', () => String(++counter), [], now, undefined, option);
  const four = draft('intervals').exercises;
  assert.equal(four.length, 1);
  assert.equal(four[0].kind, 'cardio');
  assert.equal(four[0].name, INTERVAL_SESSION_NAME);
  assert.equal(four[0].cardioDurationMinutes, '');
  assert.match(four[0].prescription, /^40 min total · 10 min easy warm-up → 4 × 4 min hard incline with 3 min easy between → 5 min cool-down/);
  const three = draft('three-rounds').exercises;
  assert.equal(three.length, 1);
  assert.match(three[0].prescription, /^33 min total · .*3 × 4 min hard/);
  assert.equal(draft('easy').exercises.length, 1);
});

test('interval detection covers the single entry and legacy per-segment logs', () => {
  assert.equal(isIntervalCardioName(INTERVAL_SESSION_NAME), true);
  assert.equal(isIntervalCardioName('Treadmill · Hard interval 2'), true);
  assert.equal(isIntervalCardioName('Treadmill · Warm-up'), false);
  assert.equal(isIntervalCardioName('Treadmill'), false);
});
