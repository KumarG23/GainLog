import assert from 'node:assert/strict';
import test from 'node:test';

import { formatGoalTarget } from '../utils/goals.ts';

test('formats a ranged goal with its aiming target', () => {
  assert.equal(
    formatGoalTarget({ minimumValue: 160, targetValue: 170, maximumValue: 180, unit: 'g' }),
    '160–180 g · aim 170 g',
  );
});

test('preserves the existing single-target display', () => {
  assert.equal(formatGoalTarget({ targetValue: 2300, unit: 'kcal' }), '2300 kcal');
});

test('formats a range without an aiming target', () => {
  assert.equal(formatGoalTarget({ minimumValue: 30, maximumValue: 35, unit: 'g' }), '30–35 g');
});