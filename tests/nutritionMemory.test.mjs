import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildDailyMacroHistory,
  buildQuickAddFoods,
} from '../utils/nutritionMemory.ts';

const entries = [
  {
    id: 'new-breakfast',
    date: '2026-07-22T08:00:00-04:00',
    meal: 'breakfast',
    name: 'Protein shake',
    calories: 180,
    proteinG: 32,
    carbsG: 8,
    fatG: 3,
  },
  {
    id: 'lunch',
    date: '2026-07-21T12:00:00-04:00',
    meal: 'lunch',
    name: 'Chicken bowl',
    calories: 610,
    proteinG: 50,
    carbsG: 65,
    fatG: 17,
  },
  {
    id: 'old-breakfast',
    date: '2026-07-20T08:00:00-04:00',
    meal: 'Breakfast',
    name: ' protein SHAKE ',
    calories: 160,
    proteinG: 30,
    carbsG: 7,
    fatG: 2,
  },
];

test('quick add remembers repeated meals once and keeps the latest macros', () => {
  const quickAdds = buildQuickAddFoods(entries, 6);

  assert.equal(quickAdds.length, 1);
  assert.equal(quickAdds[0].name, 'Protein shake');
  assert.equal(quickAdds[0].timesLogged, 2);
  assert.equal(quickAdds[0].calories, 180);
  assert.equal(quickAdds[0].proteinG, 32);
});

test('quick add compares offset timestamps by their actual instant', () => {
  const quickAdds = buildQuickAddFoods([
    {
      id: 'earlier',
      date: '2026-07-22T10:00:00+02:00',
      meal: 'breakfast',
      name: 'Work breakfast',
      calories: 400,
      proteinG: 30,
      carbsG: 40,
      fatG: 12,
    },
    {
      id: 'later',
      date: '2026-07-22T09:00:00-04:00',
      meal: 'breakfast',
      name: 'Work breakfast',
      calories: 450,
      proteinG: 38,
      carbsG: 42,
      fatG: 13,
    },
  ]);

  assert.equal(quickAdds[0].calories, 450);
  assert.equal(quickAdds[0].proteinG, 38);
});

test('macro history includes every calendar day and totals multiple entries', () => {
  const history = buildDailyMacroHistory(
    [
      ...entries,
      {
        id: 'dinner',
        date: '2026-07-22T19:00:00-04:00',
        meal: 'dinner',
        name: 'Dinner',
        calories: 700,
        proteinG: 45,
        carbsG: 60,
        fatG: 30,
      },
    ],
    '2026-07-22',
    3,
  );

  assert.deepEqual(history.map(day => day.date), [
    '2026-07-22',
    '2026-07-21',
    '2026-07-20',
  ]);
  assert.deepEqual(history[0], {
    date: '2026-07-22',
    calories: 880,
    proteinG: 77,
    carbsG: 68,
    fatG: 33,
    entryCount: 2,
  });
  assert.equal(history[1].calories, 610);
  assert.equal(history[2].calories, 160);
});

test('macro history keeps unlogged days visible as zeroes', () => {
  const history = buildDailyMacroHistory([], '2026-07-22', 3);

  assert.equal(history.length, 3);
  assert.ok(history.every(day => day.entryCount === 0 && day.calories === 0));
});
