import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildLoggedMealKeys,
  buildMealReminderPlan,
  buildTestMealReminder,
} from '../utils/mealReminderPlan.ts';

test('plans future meal reminders and skips meals already logged', () => {
  const now = new Date(2026, 6, 21, 8, 30);
  const loggedMealKeys = new Set(['2026-07-21:lunch']);

  const plan = buildMealReminderPlan({ now, days: 2, loggedMealKeys });

  assert.deepEqual(
    plan.map(item => item.key),
    [
      '2026-07-21:breakfast',
      '2026-07-21:dinner',
      '2026-07-22:breakfast',
      '2026-07-22:lunch',
      '2026-07-22:dinner',
    ],
  );
  assert.equal(plan[0].trigger.getHours(), 9);
  assert.equal(plan[0].trigger.getMinutes(), 30);
});

test('does not schedule meal times that already passed today', () => {
  const now = new Date(2026, 6, 21, 14, 0);

  const plan = buildMealReminderPlan({
    now,
    days: 1,
    loggedMealKeys: new Set(),
  });

  assert.deepEqual(plan.map(item => item.key), ['2026-07-21:dinner']);
});

test('builds logged keys for tracked meals and ignores snacks', () => {
  const keys = buildLoggedMealKeys([
    { date: '2026-07-21T08:12:00-04:00', meal: 'breakfast' },
    { date: '2026-07-21T12:42:00-04:00', meal: 'SNACK' },
    { date: '2026-07-22T13:10:00-04:00', meal: 'Lunch' },
  ]);

  assert.deepEqual([...keys].sort(), [
    '2026-07-21:breakfast',
    '2026-07-22:lunch',
  ]);
});

test('builds a test reminder five seconds in the future', () => {
  const now = new Date(2026, 6, 21, 18, 0, 0);
  const reminder = buildTestMealReminder(now, 5);

  assert.equal(reminder.trigger.getTime(), now.getTime() + 5_000);
  assert.equal(reminder.title, 'GainLog test reminder');
  assert.match(reminder.body, /notifications are working/i);
});
