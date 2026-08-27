import assert from 'node:assert/strict';
import test from 'node:test';

import {
  aggregateNutritionTrend,
  aggregateRecoveryTrend,
  aggregateTrainingTrend,
  aggregateWeightTrend,
  calculateRecoveryComparison,
  filterTrendRange,
  includeRecoveryActivityDetails,
  withRollingAverage,
  resolveChartWidth,
  resolveScrollableChartWidth,
  resolveChartDomain,
  buildTrendSeries,
  relativeDatePositions,
} from '../utils/trends.ts';

test('weight trend keeps the latest measurement for each local calendar day', () => {
  const points = aggregateWeightTrend([
    { id: '1', date: '2026-08-01T06:00:00-04:00', weightLbs: 208 },
    { id: '2', date: '2026-08-01T08:00:00-04:00', weightLbs: 207.5, bodyFatPercent: 24.2, bmi: 28.9, source: 'apple-health' },
    { id: '3', date: '2026-08-02T06:00:00-04:00', weightLbs: 207 },
  ]);

  assert.deepEqual(points, [
    { date: '2026-08-01', value: 207.5, bodyFatPercent: 24.2, leanBodyMassLbs: undefined, bmi: 28.9, source: 'apple-health' },
    { date: '2026-08-02', value: 207, bodyFatPercent: undefined, leanBodyMassLbs: undefined, bmi: undefined, source: undefined },
  ]);
});

test('nutrition trend sums logged entries without manufacturing zero-calorie missing days', () => {
  const points = aggregateNutritionTrend([
    { id: '1', date: '2026-08-01T08:00:00-04:00', meal: 'breakfast', name: 'Breakfast', calories: 400, proteinG: 35, carbsG: 30, fatG: 12, fiberG: 4 },
    { id: '2', date: '2026-08-01T12:00:00-04:00', meal: 'lunch', name: 'Lunch', calories: 600, proteinG: 45, carbsG: 60, fatG: 18, fiberG: 10 },
    { id: '3', date: '2026-08-03T08:00:00-04:00', meal: 'breakfast', name: 'Breakfast', calories: 450, proteinG: 40, carbsG: 35, fatG: 13, fiberG: 5 },
  ]);

  assert.deepEqual(points, [
    { date: '2026-08-01', calories: 1000, proteinG: 80, carbsG: 90, fatG: 30, fiberG: 14 },
    { date: '2026-08-03', calories: 450, proteinG: 40, carbsG: 35, fatG: 13, fiberG: 5 },
  ]);
});

test('nutrition trend can exclude the unfinished current day', () => {
  const points = aggregateNutritionTrend([
    { id: '1', date: '2026-08-04T20:00:00-04:00', meal: 'dinner', name: 'Day', calories: 1900, proteinG: 170, carbsG: 150, fatG: 60, fiberG: 30 },
    { id: '2', date: '2026-08-05T08:00:00-04:00', meal: 'breakfast', name: 'Breakfast', calories: 420, proteinG: 54, carbsG: 34, fatG: 7, fiberG: 4 },
  ], '2026-08-05');

  assert.deepEqual(points.map(point => point.date), ['2026-08-04']);
});

test('recovery trend preserves missing metrics and derives sleep efficiency without manufacturing zeroes', () => {
  const points = aggregateRecoveryTrend([
    {
      date: '2026-08-01',
      sleepMinutes: 420,
      deepSleepMinutes: 72,
      awakeMinutes: 60,
      restingHeartRateBpm: 58,
      hrvMs: 48,
      steps: 9000,
      activeCalories: 0,
      source: 'google-health',
      updatedAt: '2026-08-02T10:00:00Z',
    },
    {
      date: '2026-08-03',
      sleepMinutes: 390,
      source: 'health-connect',
      updatedAt: '2026-08-04T10:00:00Z',
    },
  ]);

  assert.deepEqual(points, [
    {
      date: '2026-08-01',
      sleepMinutes: 420,
      deepSleepMinutes: 72,
      awakeMinutes: 60,
      sleepEfficiencyPercent: 87.5,
      restingHeartRateBpm: 58,
      hrvMs: 48,
      steps: 9000,
      activeCalories: 0,
      exerciseMinutes: undefined,
      source: 'google-health',
    },
    {
      date: '2026-08-03',
      sleepMinutes: 390,
      deepSleepMinutes: undefined,
      awakeMinutes: undefined,
      sleepEfficiencyPercent: undefined,
      restingHeartRateBpm: undefined,
      hrvMs: undefined,
      steps: undefined,
      activeCalories: undefined,
      exerciseMinutes: undefined,
      source: 'health-connect',
    },
  ]);
});

test('today activity details are excluded while completed-day activity remains available', () => {
  assert.equal(includeRecoveryActivityDetails('2026-08-26', '2026-08-26'), false);
  assert.equal(includeRecoveryActivityDetails('2026-08-25', '2026-08-26'), true);
});

test('recovery comparison uses seven current days and the preceding 28-day personal baseline', () => {
  const points = Array.from({ length: 35 }, (_, index) => {
    const date = new Date(Date.UTC(2026, 6, 28 + index)).toISOString().slice(0, 10);
    return { date, value: index < 28 ? 50 : 70 };
  });

  assert.deepEqual(calculateRecoveryComparison(points, '2026-08-31'), {
    currentAverage: 70,
    currentObservedDays: 7,
    baselineAverage: 50,
    baselineObservedDays: 28,
    delta: 20,
  });
});

test('recovery comparison counts only observed values and withholds a sparse baseline', () => {
  const comparison = calculateRecoveryComparison([
    { date: '2026-07-30', value: 45 },
    { date: '2026-08-05', value: 47 },
    { date: '2026-08-25', value: 52 },
    { date: '2026-08-27', value: 54 },
  ], '2026-08-31');

  assert.deepEqual(comparison, {
    currentAverage: 53,
    currentObservedDays: 2,
    baselineAverage: undefined,
    baselineObservedDays: 2,
    delta: undefined,
  });
});

test('training trend groups sessions by Monday and excludes cardio from strength volume', () => {
  const points = aggregateTrainingTrend([
    {
      id: '1',
      date: '2026-08-05T06:00:00-04:00',
      durationMinutes: 45,
      exercises: [
        { id: 'e1', name: 'Press', kind: 'strength', sets: [{ id: 's1', weight: 100, reps: 10 }] },
        { id: 'e2', name: 'Elliptical', kind: 'cardio', sets: [], cardioDurationMinutes: 10 },
      ],
    },
    {
      id: '2',
      date: '2026-08-09T06:00:00-04:00',
      durationMinutes: 30,
      exercises: [
        { id: 'e3', name: 'Row', sets: [{ id: 's2', weight: 80, reps: 10 }] },
      ],
    },
    {
      id: '3',
      date: '2026-08-10T06:00:00-04:00',
      durationMinutes: 20,
      exercises: [
        { id: 'e4', name: 'Elliptical', kind: 'cardio', sets: [], cardioDurationMinutes: 20 },
      ],
    },
  ]);

  assert.deepEqual(points, [
    { date: '2026-08-03', volume: 1800, sessions: 2, minutes: 75 },
    { date: '2026-08-10', volume: 0, sessions: 1, minutes: 20 },
  ]);
});

test('training trend preserves zero-workout weeks between logged weeks', () => {
  const makeSession = (id, date) => ({
    id,
    date,
    exercises: [],
    durationMinutes: 30,
  });
  const points = aggregateTrainingTrend([
    makeSession('1', '2026-07-13T08:00:00-04:00'),
    makeSession('2', '2026-07-27T08:00:00-04:00'),
  ]);

  assert.deepEqual(points.map(point => [point.date, point.sessions]), [
    ['2026-07-13', 1],
    ['2026-07-20', 0],
    ['2026-07-27', 1],
  ]);
});

test('rolling average uses the prior seven calendar days rather than seven arbitrary records', () => {
  const points = withRollingAverage([
    { date: '2026-08-01', value: 210 },
    { date: '2026-08-03', value: 208 },
    { date: '2026-08-08', value: 206 },
  ], 'value', 7);

  assert.deepEqual(points.map(point => point.average), [210, 209, 207]);
});

test('range filtering is inclusive and uses local date keys', () => {
  const points = [
    { date: '2026-07-30', value: 1 },
    { date: '2026-07-31', value: 2 },
    { date: '2026-08-06', value: 3 },
  ];

  assert.deepEqual(
    filterTrendRange(points, '7D', '2026-08-06').map(point => point.date),
    ['2026-07-31', '2026-08-06'],
  );
  assert.equal(filterTrendRange(points, 'ALL', '2026-08-06').length, 3);
});

test('range series calculates rolling averages before hiding pre-range points', () => {
  const points = Array.from({ length: 8 }, (_, index) => ({
    date: `2026-08-0${index + 1}`,
    value: index + 1,
  }));
  const visible = buildTrendSeries(points, '7D', '2026-08-08', 7);

  assert.equal(visible[0].date, '2026-08-02');
  assert.equal(visible[0].average, 1.5);
  assert.equal(visible.at(-1).average, 5);
});

test('chart x positions preserve elapsed time across missing dates', () => {
  assert.deepEqual(
    relativeDatePositions(['2026-08-01', '2026-08-02', '2026-08-05']),
    [0, 0.25, 1],
  );
  assert.deepEqual(relativeDatePositions(['2026-08-05']), [0.5]);
});

test('chart width falls back to the viewport when layout measurement is unavailable', () => {
  assert.equal(resolveChartWidth(0, 390, 32), 358);
  assert.equal(resolveChartWidth(700, 390, 32), 700);
});

test('scrollable chart width gives daily chart points at least 44 px of elapsed-date separation', () => {
  assert.equal(
    resolveScrollableChartWidth(358, ['2026-08-01', '2026-08-07']),
    358,
  );
  assert.equal(
    resolveScrollableChartWidth(358, ['2026-08-01', '2026-08-31']),
    1_384,
  );
  assert.equal(resolveScrollableChartWidth(358, ['2026-08-10']), 358);
});

test('scrollable chart width permits weekly charts to use seven px per elapsed day', () => {
  assert.equal(
    resolveScrollableChartWidth(358, ['2026-08-03', '2026-08-31'], 7),
    358,
  );
  assert.equal(
    resolveScrollableChartWidth(358, ['2026-08-03', '2026-10-26'], 7),
    652,
  );
});

test('chart domain does not flatten useful variation to include a distant goal', () => {
  const distant = resolveChartDomain([206, 208, 210], 175);
  assert.equal(distant.goalVisible, false);
  assert.ok(distant.min > 200);

  const nearby = resolveChartDomain([206, 208, 210], 212);
  assert.equal(nearby.goalVisible, true);
  assert.ok(nearby.max > 212);

  const nonnegative = resolveChartDomain([0, 70000], undefined, true);
  assert.equal(nonnegative.min, 0);
});
