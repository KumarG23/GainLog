import assert from 'node:assert/strict';
import test from 'node:test';

import {
  aggregateNutritionTrend,
  aggregateTrainingTrend,
  aggregateWeightTrend,
  filterTrendRange,
  withRollingAverage,
  resolveChartWidth,
  resolveChartDomain,
  buildTrendSeries,
  relativeDatePositions,
} from '../utils/trends.ts';

test('weight trend keeps the latest measurement for each local calendar day', () => {
  const points = aggregateWeightTrend([
    { id: '1', date: '2026-08-01T06:00:00-04:00', weightLbs: 208 },
    { id: '2', date: '2026-08-01T08:00:00-04:00', weightLbs: 207.5, bodyFatPercent: 24.2 },
    { id: '3', date: '2026-08-02T06:00:00-04:00', weightLbs: 207 },
  ]);

  assert.deepEqual(points, [
    { date: '2026-08-01', value: 207.5, bodyFatPercent: 24.2, leanBodyMassLbs: undefined },
    { date: '2026-08-02', value: 207, bodyFatPercent: undefined, leanBodyMassLbs: undefined },
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
