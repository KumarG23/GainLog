import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildHealthConnectDailyPayload,
  buildHealthConnectWeightPayload,
  nearestRecordWithin,
  recentLocalDateKeys,
  selectBestSleepSession,
  sleepSessionsEndingOnDate,
  stepTotalFromAggregate,
} from '../utils/healthConnect.ts';

test('step aggregate stays absent when Health Connect reports no contributing origin', () => {
  assert.equal(stepTotalFromAggregate({ COUNT_TOTAL: 0, dataOrigins: [] }), undefined);
});

test('step aggregate preserves a legitimate zero from a contributing origin', () => {
  assert.equal(stepTotalFromAggregate({ COUNT_TOTAL: 0, dataOrigins: ['com.fitbit.FitbitMobile'] }), 0);
});

test('Health Connect mapper uses the deduplicated aggregate step total', () => {
  const daily = buildHealthConnectDailyPayload('2026-08-21', {
    stepsTotal: 5354,
  });

  assert.equal(daily.steps, 5354);
});

test('Health Connect mapper totals activity, maps light sleep to core, and leaves stand hours absent', () => {
  const daily = buildHealthConnectDailyPayload('2026-08-21', {
    stepsTotal: 8100,
    distancesMeters: [1609.344, 3218.688],
    activeCalories: [100.5, 200.25],
    sleepStages: [
      { stage: 5, durationMinutes: 90 },
      { stage: 4, durationMinutes: 240 },
      { stage: 6, durationMinutes: 100 },
      { stage: 1, durationMinutes: 20 },
    ],
    restingHeartRates: [54, 56],
    hrvMs: [41, 43],
    exerciseDurationsMinutes: [30, 45],
  });

  assert.deepEqual(daily, {
    date: '2026-08-21',
    source: 'health-connect',
    steps: 8100,
    distanceMiles: 3,
    activeCalories: 300.75,
    sleepMinutes: 430,
    deepSleepMinutes: 90,
    lightSleepMinutes: 240,
    remSleepMinutes: 100,
    awakeMinutes: 20,
    restingHeartRateBpm: 55,
    hrvMs: 42,
    exerciseMinutes: 75,
  });
  assert.equal('standHours' in daily, false);
});

test('Health Connect mapper prefers direct lean mass and derives BMI from height', () => {
  assert.deepEqual(buildHealthConnectWeightPayload({
    id: 'weight-abc', time: '2026-08-21T11:00:00.000Z', weightKg: 90,
    bodyFatPercent: 24, leanMassKg: 65, heightMeters: 1.8034,
  }), {
    date: '2026-08-21T11:00:00.000Z', weightLbs: 198.416, bodyFatPercent: 24,
    leanBodyMassLbs: 143.3, bmi: 27.67, source: 'health-connect',
    sourceRecordId: 'health-connect:weight:weight-abc',
  });
});

test('Health Connect mapper derives lean mass from body fat when no direct record exists', () => {
  const payload = buildHealthConnectWeightPayload({
    id: 'weight-derived',
    time: '2026-08-21T11:00:00.000Z',
    weightKg: 90,
    bodyFatPercent: 24,
    heightMeters: 1.8034,
  });

  assert.equal(payload.leanBodyMassLbs, 150.796);
  assert.equal(payload.leanBodyMassDerived, true);
  assert.equal(payload.bmi, 27.67);
});

test('body-composition pairing ignores records outside the tolerance window', () => {
  const records = [
    { time: '2026-08-21T10:40:00.000Z', value: 'stale' },
    { time: '2026-08-21T11:08:00.000Z', value: 'near' },
  ];

  assert.equal(
    nearestRecordWithin(records, '2026-08-21T11:00:00.000Z', 15)?.value,
    'near',
  );
  assert.equal(
    nearestRecordWithin(records.slice(0, 1), '2026-08-21T11:00:00.000Z', 15),
    undefined,
  );
});

test('empty Health Connect collections remain absent instead of becoming zeroes', () => {
  assert.deepEqual(buildHealthConnectDailyPayload('2026-08-21', {
    distancesMeters: [],
    activeCalories: [],
    totalCalories: [],
    sleepStages: [],
    exerciseDurationsMinutes: [],
  }), {
    date: '2026-08-21',
    source: 'health-connect',
  });
});

test('Health Connect mapper retains Fitbit total calories separately from active calories', () => {
  const daily = buildHealthConnectDailyPayload('2026-08-21', {
    totalCalories: [420.5, 380.25],
  });

  assert.equal(daily.totalCalories, 800.75);
  assert.equal(daily.activeCalories, undefined);
});

test('sleep selection keeps one coherent session instead of mixing overlapping providers', () => {
  const staleSession = {
    startTime: '2026-08-24T23:22:00-04:00',
    endTime: '2026-08-25T06:40:00-04:00',
    stages: [
      { stage: 5, durationMinutes: 76 },
      { stage: 4, durationMinutes: 207 },
      { stage: 6, durationMinutes: 129 },
    ],
  };
  const fitbitSession = {
    startTime: '2026-08-24T23:22:00-04:00',
    endTime: '2026-08-25T06:40:00-04:00',
    stages: [
      { stage: 5, durationMinutes: 74 },
      { stage: 4, durationMinutes: 220 },
      { stage: 6, durationMinutes: 127 },
      { stage: 1, durationMinutes: 8 },
    ],
  };

  assert.equal(selectBestSleepSession([staleSession, fitbitSession]), fitbitSession);
});

test('overnight sleep is assigned to the local date when the session ends', () => {
  const sessions = [
    { startTime: '2026-08-20T23:10:00-04:00', endTime: '2026-08-21T06:15:00-04:00' },
    { startTime: '2026-08-19T23:00:00-04:00', endTime: '2026-08-20T06:00:00-04:00' },
  ];

  assert.deepEqual(sleepSessionsEndingOnDate(sessions, '2026-08-21'), [sessions[0]]);
});

test('automatic Health Connect sync refreshes yesterday and today', () => {
  assert.deepEqual(
    recentLocalDateKeys(new Date('2026-08-21T09:30:00-04:00'), 2),
    ['2026-08-20', '2026-08-21'],
  );
});

test('automatic Health Connect sync handles month boundaries in local time', () => {
  assert.deepEqual(
    recentLocalDateKeys(new Date('2026-09-01T00:05:00-04:00'), 2),
    ['2026-08-31', '2026-09-01'],
  );
});
