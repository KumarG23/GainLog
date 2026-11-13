import assert from 'node:assert/strict';
import test from 'node:test';
import { intervalProtocol, intervalReadiness } from '../utils/cardioPlan.ts';
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

test('interval draft records distinct actual segments without inventing completed minutes', () => {
  assert.deepEqual(intervalProtocol(4).map(item => item.minutes), [10, 4, 3, 4, 3, 4, 3, 4, 5]);
  assert.deepEqual(intervalProtocol(3).map(item => item.minutes), [10, 4, 3, 4, 3, 4, 5]);
  let counter = 0;
  const draft = (option) => buildWorkoutTemplateDraft('recovery', () => String(++counter), [], now, undefined, option);
  const four = draft('intervals').exercises;
  assert.equal(four.length, 9);
  assert.equal(four.every(exercise => exercise.kind === 'cardio' && exercise.cardioDurationMinutes === ''), true);
  assert.match(four[1].name, /Hard interval 1/);
  assert.equal(draft('three-rounds').exercises.length, 7);
  assert.equal(draft('easy').exercises.length, 1);
});
