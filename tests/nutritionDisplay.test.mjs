import assert from 'node:assert/strict';
import test from 'node:test';

import {
  averageMacroDays,
  buildCalorieHistoryScale,
  formatNutritionProgress,
  nutritionGoalReferenceValue,
  selectNutritionGoals,
} from '../utils/nutritionDisplay.ts';

const activeGoals = [
  {
    id: 'calories',
    kind: 'calories',
    title: 'Daily Calories',
    targetValue: 2300,
    unit: 'kcal',
    startDate: '2026-08-01',
    status: 'active',
  },
  {
    id: 'protein',
    kind: 'protein',
    title: 'Daily Protein',
    minimumValue: 160,
    targetValue: 170,
    maximumValue: 180,
    unit: 'g',
    startDate: '2026-08-01',
    status: 'active',
  },
  {
    id: 'fiber',
    kind: 'fiber',
    title: 'Daily Fiber',
    targetValue: 35,
    unit: 'g',
    startDate: '2026-08-01',
    status: 'active',
  },
  {
    id: 'paused-calories',
    kind: 'calories',
    title: 'Old Calories',
    targetValue: 1800,
    unit: 'kcal',
    startDate: '2026-07-01',
    status: 'paused',
  },
];

test('nutrition goals select only active calorie, protein, and fiber targets', () => {
  const selected = selectNutritionGoals(activeGoals);

  assert.equal(selected.calories?.targetValue, 2300);
  assert.equal(selected.protein?.minimumValue, 160);
  assert.equal(selected.fiber?.targetValue, 35);
});

test('nutrition progress formats a ranged protein goal without losing its aim', () => {
  assert.deepEqual(
    formatNutritionProgress(94, activeGoals[1]),
    {
      valueLabel: '94 g',
      targetLabel: '160–180 g · aim 170 g',
      progress: 94 / 160,
      status: 'below',
    },
  );
});

test('nutrition progress recognizes values inside a target range', () => {
  assert.equal(formatNutritionProgress(170, activeGoals[1]).status, 'within');
});

test('nutrition goal reference uses aim first and supports one-sided goals', () => {
  assert.equal(nutritionGoalReferenceValue(activeGoals[0]), 2300);
  assert.equal(nutritionGoalReferenceValue({ minimumValue: 2000 }), 2000);
  assert.equal(nutritionGoalReferenceValue({ maximumValue: 2400 }), 2400);
  assert.equal(nutritionGoalReferenceValue(undefined), undefined);
});

test('completed-day averages ignore an in-progress day supplied separately by the caller', () => {
  const averages = averageMacroDays([
    { date: '2026-08-26', calories: 2000, proteinG: 160, carbsG: 180, fatG: 65, fiberG: 40, entryCount: 4 },
    { date: '2026-08-25', calories: 2200, proteinG: 180, carbsG: 200, fatG: 70, fiberG: 30, entryCount: 5 },
  ]);

  assert.deepEqual(averages, {
    calories: 2100,
    proteinG: 170,
    carbsG: 190,
    fatG: 68,
    fiberG: 35,
  });
});

test('calorie history scale keeps the goal marker visible and does not let one day redefine success', () => {
  const scale = buildCalorieHistoryScale([957, 1992, 2354], 2300);

  assert.equal(scale.ceiling, 2530);
  assert.equal(scale.targetPercent, 2300 / 2530);
  assert.equal(scale.barPercent(957), 957 / 2530);
  assert.equal(scale.barPercent(3000), 1);
});
