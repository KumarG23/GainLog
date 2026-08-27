import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { previousLocalDateKey } from '../utils/date.ts';

const healthContext = readFileSync(new URL('../context/HealthContext.tsx', import.meta.url), 'utf8');
const healthScreen = readFileSync(new URL('../app/(tabs)/health.tsx', import.meta.url), 'utf8');
const trendsScreen = readFileSync(new URL('../app/trends.tsx', import.meta.url), 'utf8');


test('previous completed local date survives a daylight-saving boundary', () => {
  process.env.TZ = 'America/New_York';
  assert.equal(previousLocalDateKey(new Date(2026, 2, 9, 0, 30)), '2026-03-08');
});


test('Health context loads source-aware history and persisted completed-week review', () => {
  assert.match(healthContext, /apiFetch<HealthDaily\[]>\('\/health-data\/daily'\)/);
  assert.match(healthContext, /previousLocalDateKey\(\)/);
  assert.match(healthContext, /\/coach\/weekly-review\?weekEnd=/);
  assert.match(healthContext, /generateWeeklyReview/);
});


test('Health screen links Recovery activity to trends and exposes Weekly Review', () => {
  assert.match(healthScreen, /\/trends\?metric=recovery/);
  assert.match(healthScreen, />Weekly Review</);
  assert.match(healthScreen, /preceding 28-day personal baseline/);
  assert.match(healthScreen, /Generate Weekly Review/);
  assert.match(healthScreen, /accessibilityLabel=\{weeklyReview \? 'Refresh weekly review' : 'Generate weekly review'\}/);
});


test('Trends screen exposes Recovery metrics and honest baseline language', () => {
  assert.match(trendsScreen, /key: 'recovery', label: 'Recovery'/);
  for (const metric of [
    'sleep',
    'deepSleep',
    'awake',
    'sleepEfficiency',
    'restingHeartRate',
    'hrv',
    'steps',
    'activeCalories',
    'exerciseMinutes',
  ]) {
    assert.match(trendsScreen, new RegExp(`key: '${metric}'`));
  }
  assert.match(trendsScreen, /Missing metrics remain gaps, never zeroes/);
  assert.match(trendsScreen, /direction is context, not a readiness score/);
});
