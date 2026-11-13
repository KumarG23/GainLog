import assert from 'node:assert/strict';
import test from 'node:test';
import { buildBpReminderPlan } from '../utils/bpReminderPlan.ts';
test('BP reminders are Tuesday/Saturday 8 AM Eastern and skip elapsed triggers', () => {
  const plan = buildBpReminderPlan(new Date('2026-11-10T14:00:00Z'), 7);
  assert.deepEqual(plan.map(d => d.toISOString()), ['2026-11-14T13:00:00.000Z']);
});
test('BP reminder Eastern wall clock survives spring daylight-saving transition', () => {
  const plan = buildBpReminderPlan(new Date('2026-03-06T12:00:00Z'), 9);
  assert.deepEqual(plan.map(d => d.toISOString()), ['2026-03-07T13:00:00.000Z', '2026-03-10T12:00:00.000Z', '2026-03-14T12:00:00.000Z']);
});
