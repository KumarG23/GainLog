import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as healthDisplay from '../utils/healthDisplay.ts';

const healthScreen = readFileSync(new URL('../app/(tabs)/health.tsx', import.meta.url), 'utf8');

test('recovery calories prefer watch-comparable total energy and name active fallback honestly', () => {
  assert.equal(typeof healthDisplay.selectRecoveryCalories, 'function');
  assert.deepEqual(
    healthDisplay.selectRecoveryCalories({ totalCalories: 1605.2, activeCalories: 651.8 }),
    { value: 1605.2, label: 'Total' },
  );
  assert.deepEqual(
    healthDisplay.selectRecoveryCalories({ totalCalories: null, activeCalories: 651.8 }),
    { value: 651.8, label: 'Active' },
  );
  assert.equal(
    healthDisplay.selectRecoveryCalories({ totalCalories: null, activeCalories: null }),
    null,
  );
});

test('recovery source time is readable and invalid timestamps stay hidden', () => {
  assert.equal(typeof healthDisplay.formatHealthUpdatedAt, 'function');
  assert.equal(
    healthDisplay.formatHealthUpdatedAt('2026-08-27T13:43:02.619765+00:00', 'America/New_York'),
    'Updated 9:43 AM',
  );
  assert.equal(healthDisplay.formatHealthUpdatedAt('not-a-date', 'America/New_York'), null);
});

test('Health card uses the shared calorie choice and exposes provider update time', () => {
  assert.match(healthScreen, /selectRecoveryCalories/);
  assert.match(healthScreen, /const recoveryCalories = selectRecoveryCalories\(/);
  assert.match(healthScreen, /recoveryCalories\.value\.toFixed\(0\)/);
  assert.match(healthScreen, /\{recoveryCalories\.label\}/);
  assert.match(healthScreen, /const healthUpdatedLabel = formatHealthUpdatedAt\(/);
  assert.match(healthScreen, /\{healthUpdatedLabel && \(/);
});
