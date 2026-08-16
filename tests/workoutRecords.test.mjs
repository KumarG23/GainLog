import assert from 'node:assert/strict';
import test from 'node:test';

import {
  findPersonalRecordsForSession,
  findPersonalRecordsForSet,
  findSuspiciousStrengthSets,
} from '../utils/workoutRecords.ts';

const session = (id, date, name, sets, kind = 'strength') => ({
  id,
  date,
  durationMinutes: 30,
  exercises: [{ id: `${id}-exercise`, name, kind, sets }],
});

test('findSuspiciousStrengthSets flags reps above 40 without blocking ordinary or cardio entries', () => {
  const exercises = [
    {
      id: 'press',
      name: 'Machine Shoulder Press',
      kind: 'strength',
      sets: [
        { id: 'normal', weight: '40', reps: '40' },
        { id: 'typo', weight: '40', reps: '41' },
      ],
    },
    {
      id: 'cardio',
      name: 'Elliptical',
      kind: 'cardio',
      sets: [{ id: 'ignored', weight: '0', reps: '99' }],
    },
  ];

  assert.deepEqual(findSuspiciousStrengthSets(exercises), [
    {
      exerciseId: 'press',
      exerciseName: 'Machine Shoulder Press',
      setId: 'typo',
      weight: 40,
      reps: 41,
    },
  ]);
});

test('findPersonalRecordsForSet awards a weight PR against exact-name valid history', () => {
  const sessions = [
    session('older', '2026-08-01T07:00:00-04:00', 'Machine Chest Press', [
      { id: 'old-1', weight: 90, reps: 12 },
      { id: 'old-2', weight: 100, reps: 8 },
    ]),
    session('other-machine', '2026-08-02T07:00:00-04:00', 'Smith Machine Chest Press', [
      { id: 'other-1', weight: 200, reps: 10 },
    ]),
  ];

  assert.deepEqual(
    findPersonalRecordsForSet(sessions, ' machine   chest press ', { weight: 105, reps: 7 }),
    [{ kind: 'weight', exerciseName: 'machine chest press', weight: 105, reps: 7 }],
  );
});

test('findPersonalRecordsForSet awards a rep PR only at the same weight', () => {
  const sessions = [
    session('older', '2026-08-01T07:00:00-04:00', 'Lat Pulldown', [
      { id: 'old-1', weight: 85, reps: 12 },
      { id: 'old-2', weight: 100, reps: 8 },
    ]),
  ];

  assert.deepEqual(
    findPersonalRecordsForSet(sessions, 'Lat Pulldown', { weight: 100, reps: 10 }),
    [{ kind: 'reps', exerciseName: 'Lat Pulldown', weight: 100, reps: 10 }],
  );
  assert.deepEqual(
    findPersonalRecordsForSet(sessions, 'Lat Pulldown', { weight: 95, reps: 13 }),
    [],
  );
});

test('findPersonalRecordsForSet ignores first baselines, cardio, and implausible reps', () => {
  const history = [
    session('cardio', '2026-08-01T07:00:00-04:00', 'Row Erg', [
      { id: 'cardio-set', weight: 100, reps: 10 },
    ], 'cardio'),
    session('outlier', '2026-08-02T07:00:00-04:00', 'Machine Shoulder Press', [
      { id: 'bad-set', weight: 40, reps: 74 },
    ]),
  ];

  assert.deepEqual(findPersonalRecordsForSet([], 'New Exercise', { weight: 50, reps: 10 }), []);
  assert.deepEqual(findPersonalRecordsForSet(history, 'Row Erg', { weight: 110, reps: 10 }), []);
  assert.deepEqual(
    findPersonalRecordsForSet(history, 'Machine Shoulder Press', { weight: 45, reps: 8 }),
    [],
  );
  assert.deepEqual(
    findPersonalRecordsForSet(
      [session('valid', '2026-08-03T07:00:00-04:00', 'Machine Shoulder Press', [
        { id: 'valid-set', weight: 40, reps: 10 },
      ])],
      'Machine Shoulder Press',
      { weight: 45, reps: 74 },
    ),
    [],
  );
});

test('findPersonalRecordsForSession maps PRs to the sets that earned them', () => {
  const history = [
    session('prior', '2026-08-01T07:00:00-04:00', 'Machine Chest Press', [
      { id: 'prior-1', weight: 100, reps: 8 },
      { id: 'prior-2', weight: 90, reps: 12 },
    ]),
  ];
  const completed = session('current', '2026-08-08T07:00:00-04:00', 'Machine Chest Press', [
    { id: 'ordinary', weight: 90, reps: 10 },
    { id: 'rep-pr', weight: 90, reps: 13 },
    { id: 'weight-pr', weight: 105, reps: 7 },
  ]);

  assert.deepEqual(findPersonalRecordsForSession(history, completed), [
    {
      setId: 'rep-pr',
      kind: 'reps',
      exerciseName: 'Machine Chest Press',
      weight: 90,
      reps: 13,
    },
    {
      setId: 'weight-pr',
      kind: 'weight',
      exerciseName: 'Machine Chest Press',
      weight: 105,
      reps: 7,
    },
  ]);
});

test('findPersonalRecordsForSession compares later sets with earlier sets in the same workout', () => {
  const history = [
    session('prior', '2026-08-01T07:00:00-04:00', 'Machine Chest Press', [
      { id: 'prior', weight: 100, reps: 8 },
    ]),
  ];
  const completed = session('current', '2026-08-08T07:00:00-04:00', 'Machine Chest Press', [
    { id: 'new-weight-pr', weight: 110, reps: 6 },
    { id: 'not-a-later-pr', weight: 105, reps: 7 },
    { id: 'new-rep-pr', weight: 100, reps: 10 },
    { id: 'not-a-later-rep-pr', weight: 100, reps: 9 },
  ]);

  assert.deepEqual(
    findPersonalRecordsForSession(history, completed).map(record => record.setId),
    ['new-weight-pr', 'new-rep-pr'],
  );
});
