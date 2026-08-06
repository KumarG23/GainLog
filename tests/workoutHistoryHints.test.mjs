import assert from 'node:assert/strict';
import test from 'node:test';

import {
  findPreviousExercise,
  formatPreviousExerciseSummary,
  getPreviousSetHint,
} from '../utils/workoutHistoryHints.ts';

const session = (id, date, name, sets) => ({
  id,
  date,
  exercises: [{ id: `${id}-exercise`, name, kind: 'strength', sets }],
  durationMinutes: 30,
});

test('findPreviousExercise returns the newest matching strength exercise', () => {
  const sessions = [
    session('older', '2026-07-21T07:00:00-04:00', 'Lat Pulldown', [
      { id: 'older-set', weight: 42.5, reps: 12 },
    ]),
    session('newer', '2026-07-28T07:00:00-04:00', ' lat   pulldown ', [
      { id: 'newer-set', weight: 50, reps: 10 },
    ]),
    session('cardio', '2026-07-29T07:00:00-04:00', 'Lat Pulldown', []),
  ];
  sessions[2].exercises[0].kind = 'cardio';

  const previous = findPreviousExercise(sessions, 'LAT PULLDOWN');

  assert.equal(previous?.id, 'newer-exercise');
});

test('findPreviousExercise can freeze history before the current plan week', () => {
  const sessions = [
    session('prior-week', '2026-08-03T07:00:00-04:00', 'Machine Chest Press', [
      { id: 'prior-set', weight: 85, reps: 8 },
    ]),
    session('same-week', '2026-08-10T07:00:00-04:00', 'Machine Chest Press', [
      { id: 'same-set', weight: 100, reps: 12 },
    ]),
  ];

  const previous = findPreviousExercise(
    sessions,
    'Machine Chest Press',
    'strength',
    new Date('2026-08-10T00:00:00-04:00'),
  );

  assert.equal(previous?.id, 'prior-week-exercise');
});

test('findPreviousExercise does not suggest strength history for a cardio draft', () => {
  const sessions = [
    session('pull', '2026-07-28T07:00:00-04:00', 'Row Erg', [
      { id: 'set-1', weight: 50, reps: 10 },
    ]),
  ];

  assert.equal(findPreviousExercise(sessions, 'Row Erg', 'cardio'), undefined);
});

test('getPreviousSetHint returns matching set values and reuses the final set for added rows', () => {
  const exercise = session('pull', '2026-07-28T07:00:00-04:00', 'Seated Cable Row', [
    { id: 'set-1', weight: 50, reps: 10 },
    { id: 'set-2', weight: 50, reps: 9 },
  ]).exercises[0];

  assert.deepEqual(getPreviousSetHint(exercise, 0), { weight: '50', reps: '10' });
  assert.deepEqual(getPreviousSetHint(exercise, 1), { weight: '50', reps: '9' });
  assert.deepEqual(getPreviousSetHint(exercise, 2), { weight: '50', reps: '9' });
});

test('formatPreviousExerciseSummary shows the prior set sequence compactly', () => {
  const exercise = session('pull', '2026-07-28T07:00:00-04:00', 'Lat Pulldown', [
    { id: 'set-1', weight: 42.5, reps: 16 },
    { id: 'set-2', weight: 50, reps: 12 },
    { id: 'set-3', weight: 50, reps: 10 },
  ]).exercises[0];

  assert.equal(formatPreviousExerciseSummary(exercise), 'Last: 42.5×16 · 50×12 · 50×10');
  assert.equal(formatPreviousExerciseSummary(undefined), null);
});

test('getPreviousSetHint omits zero or missing historical values', () => {
  const exercise = session('pull', '2026-07-28T07:00:00-04:00', 'Cable Curl', [
    { id: 'set-1', weight: 0, reps: 0 },
  ]).exercises[0];

  assert.deepEqual(getPreviousSetHint(exercise, 0), {});
  assert.deepEqual(getPreviousSetHint(undefined, 0), {});
});

test('history hints and summaries omit implausible rep outliers', () => {
  const previous = session('push', '2026-07-27T07:00:00-04:00', 'Machine Shoulder Press', [
    { id: 'set-1', weight: 50, reps: 12 },
    { id: 'set-2', weight: 50, reps: 74 },
    { id: 'set-3', weight: 50, reps: 8 },
  ]).exercises[0];

  assert.deepEqual(getPreviousSetHint(previous, 1), { weight: '50', reps: '8' });
  assert.equal(formatPreviousExerciseSummary(previous), 'Last: 50×12 · 50×8');
});
