import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildHealthConnectWorkoutRecord,
  buildWorkoutNotes,
  HC_EXERCISE_TYPE,
  parseExportedWorkouts,
  planWorkoutExport,
  workoutExerciseType,
  workoutFingerprint,
} from '../utils/healthConnectWorkouts.ts';

const pull = {
  id: 'w-1',
  date: '2026-01-15T07:14:49-05:00',
  durationMinutes: 68,
  avgHeartRate: 120,
  templateId: 'pull',
  effort: 'right',
  notes: 'Felt fine.',
  exercises: [
    {
      id: 'e1', name: 'Lat Pulldown', kind: 'strength',
      sets: [
        { id: 's1', weight: 80, reps: 12 },
        { id: 's2', weight: 80, reps: 10 },
      ],
    },
    {
      id: 'e2', name: 'Dead Hang', kind: 'strength',
      sets: [{ id: 's3', weight: 0, reps: 0, measure: 'seconds', seconds: 35 }],
    },
    {
      id: 'e3', name: 'Treadmill', kind: 'cardio', sets: [],
      cardioDurationMinutes: 30, distanceMiles: 1.05, inclinePercent: 5,
    },
  ],
};

test('workout notes carry every set, rep and weight plus cardio detail', () => {
  assert.equal(buildWorkoutNotes(pull), [
    'Lat Pulldown: 80×12, 80×10 lb',
    'Dead Hang: 35s',
    'Treadmill: 30 min, 1.05 mi, 5% incline',
    'avg HR 120 · effort right',
    'Notes: Felt fine.',
  ].join('\n'));
});

test('a GainLog workout maps to an idempotent Health Connect exercise session ending at save time', () => {
  const record = buildHealthConnectWorkoutRecord(pull, 42);
  assert.equal(record.recordType, 'ExerciseSession');
  assert.equal(record.exerciseType, HC_EXERCISE_TYPE.STRENGTH_TRAINING);
  assert.equal(record.title, 'GainLog · Pull');
  assert.equal(record.endTime, '2026-01-15T12:14:49.000Z');
  assert.equal(record.startTime, '2026-01-15T11:06:49.000Z');
  assert.deepEqual(record.metadata, {
    clientRecordId: 'gainlog:workout:w-1',
    clientRecordVersion: 42,
    recordingMethod: 3,
  });
});

test('recorded cardio timer windows widen the session interval', () => {
  const session = {
    ...pull,
    exercises: [{
      ...pull.exercises[2],
      cardioStartedAt: '2026-01-15T06:00:00-05:00',
      cardioEndedAt: '2026-01-15T07:20:00-05:00',
    }],
  };
  const record = buildHealthConnectWorkoutRecord(session, 1);
  assert.equal(record.startTime, '2026-01-15T11:00:00.000Z');
  assert.equal(record.endTime, '2026-01-15T12:20:00.000Z');
});

test('cardio-only sessions pick a matching exercise type', () => {
  const cardio = exercise => ({ ...pull, exercises: [exercise] });
  assert.equal(workoutExerciseType(cardio({ id: 'c', name: 'Treadmill', kind: 'cardio', sets: [], cardioDurationMinutes: 60, distanceMiles: 2.5 })), HC_EXERCISE_TYPE.WALKING);
  assert.equal(workoutExerciseType(cardio({ id: 'c', name: 'Treadmill', kind: 'cardio', sets: [], cardioDurationMinutes: 30, distanceMiles: 3 })), HC_EXERCISE_TYPE.RUNNING_TREADMILL);
  assert.equal(workoutExerciseType(cardio({ id: 'c', name: 'Elliptical', kind: 'cardio', sets: [] })), HC_EXERCISE_TYPE.ELLIPTICAL);
  assert.equal(workoutExerciseType(cardio({ id: 'c', name: 'Mystery', kind: 'cardio', sets: [] })), HC_EXERCISE_TYPE.OTHER_WORKOUT);
});

test('export plan writes new and changed workouts with increasing versions and skips unchanged ones', () => {
  const nowMs = Date.parse('2026-01-16T02:00:00Z');
  const first = planWorkoutExport({ sessions: [pull], exported: {}, nowMs });
  assert.equal(first.upserts.length, 1);
  assert.equal(first.upserts[0].clientRecordVersion, nowMs);

  const unchanged = planWorkoutExport({ sessions: [pull], exported: first.nextState, nowMs: nowMs + 1000 });
  assert.equal(unchanged.upserts.length, 0);
  assert.deepEqual(unchanged.nextState, first.nextState);

  const edited = { ...pull, effort: 'hard' };
  assert.notEqual(workoutFingerprint(edited), workoutFingerprint(pull));
  // Even if the phone clock went backwards, the version still increases.
  const changed = planWorkoutExport({ sessions: [edited], exported: first.nextState, nowMs: nowMs - 5000 });
  assert.equal(changed.upserts.length, 1);
  assert.equal(changed.upserts[0].clientRecordVersion, nowMs + 1);
});

test('export plan deletes recently exported workouts removed from GainLog and forgets old ones', () => {
  const nowMs = Date.parse('2026-01-16T02:00:00Z');
  const exported = {
    'w-deleted': { fingerprint: 'x', version: 1, date: '2026-01-14T07:00:00-05:00' },
    'w-old': { fingerprint: 'y', version: 1, date: '2025-11-01T07:00:00-04:00' },
  };
  const plan = planWorkoutExport({ sessions: [], exported, nowMs });
  assert.deepEqual(plan.deleteWorkoutIds, ['w-deleted']);
  assert.deepEqual(plan.nextState, {});
});

test('workouts outside the window are never written', () => {
  const nowMs = Date.parse('2026-01-16T02:00:00Z');
  const old = { ...pull, id: 'w-old', date: '2025-12-01T07:00:00-05:00' };
  assert.equal(planWorkoutExport({ sessions: [old], exported: {}, nowMs }).upserts.length, 0);
});

test('stored export state parses defensively', () => {
  assert.deepEqual(parseExportedWorkouts(null), {});
  assert.deepEqual(parseExportedWorkouts('nope'), {});
  assert.deepEqual(parseExportedWorkouts('[1]'), {});
  assert.deepEqual(
    parseExportedWorkouts('{"a":{"fingerprint":"f","version":2,"date":"d"},"b":{"version":"x"}}'),
    { a: { fingerprint: 'f', version: 2, date: 'd' } },
  );
});

test('workout export is opt-in, requests write access and runs after saves', () => {
  const nativeExport = readFileSync(new URL('../utils/healthConnectWorkoutExport.native.ts', import.meta.url), 'utf8');
  const workouts = readFileSync(new URL('../context/WorkoutsContext.tsx', import.meta.url), 'utf8');
  const appJson = readFileSync(new URL('../app.json', import.meta.url), 'utf8');
  assert.match(nativeExport, /if \(!await isWorkoutExportEnabled\(\)\) return \{ written: 0, deleted: 0, skipped: true \}/);
  assert.match(appJson, /android\.permission\.health\.WRITE_EXERCISE/);
  assert.equal(workouts.match(/exportWorkoutsInBackground\(\);/g)?.length, 3);
});
