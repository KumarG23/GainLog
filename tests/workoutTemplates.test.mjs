import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PLANET_FITNESS_TEMPLATES,
  buildWorkoutTemplateDraft,
  getSuggestedTemplateId,
} from '../utils/workoutTemplates.ts';

test('Planet Fitness plan provides five ordered weekday templates', () => {
  assert.deepEqual(
    PLANET_FITNESS_TEMPLATES.map(template => template.id),
    ['push', 'pull', 'recovery', 'legs', 'upper'],
  );
  assert.equal(PLANET_FITNESS_TEMPLATES[2].weekday, 'Wednesday');
  assert.equal(PLANET_FITNESS_TEMPLATES[2].exercises.length, 0);
  assert.equal(PLANET_FITNESS_TEMPLATES[3].weekday, 'Thursday');
  assert.equal(PLANET_FITNESS_TEMPLATES[4].weekday, 'Friday');
});

test('template draft creates blank strength sets and an optional cardio finisher', () => {
  let nextId = 0;
  const draft = buildWorkoutTemplateDraft('push', () => `id-${++nextId}`);

  assert.equal(draft.template.id, 'push');
  assert.equal(draft.exercises[0].name, 'Machine Chest Press');
  assert.equal(draft.exercises[0].sets.length, 3);
  assert.deepEqual(draft.exercises[0].sets[0], {
    id: 'id-2',
    weight: '',
    reps: '',
  });
  assert.equal(
    draft.exercises[0].prescription,
    'Establish a clean baseline · 3 × 8–12 · rest 2 min',
  );

  const cardio = draft.exercises.at(-1);
  assert.equal(cardio.kind, 'cardio');
  assert.equal(cardio.name, 'Elliptical');
  assert.equal(cardio.cardioDurationMinutes, '');
  assert.match(cardio.prescription, /Optional/);
});

test('suggested template follows Monday through Friday and leaves weekends open', () => {
  assert.equal(getSuggestedTemplateId(1), 'push');
  assert.equal(getSuggestedTemplateId(3), 'recovery');
  assert.equal(getSuggestedTemplateId(4), 'legs');
  assert.equal(getSuggestedTemplateId(5), 'upper');
  assert.equal(getSuggestedTemplateId(0), null);
  assert.equal(getSuggestedTemplateId(6), null);
});

test('Wednesday draft is cardio-only recovery and does not manufacture steps', () => {
  let nextId = 0;
  const draft = buildWorkoutTemplateDraft(
    'recovery',
    () => `id-${++nextId}`,
    [],
    new Date('2026-08-12T06:00:00-04:00'),
  );

  assert.equal(draft.exercises.length, 1);
  assert.equal(draft.exercises[0].kind, 'cardio');
  assert.equal(draft.exercises[0].name, 'Elliptical');
  assert.equal(draft.exercises[0].cardioDurationMinutes, '');
  assert.match(draft.exercises[0].prescription, /25–35 min/);
  assert.match(draft.exercises[0].prescription, /treadmill walk/i);
  assert.match(draft.exercises[0].prescription, /not steps/i);
});

const workout = (id, date, exerciseName, sets) => ({
  id,
  date,
  durationMinutes: 40,
  exercises: [{ id: `${id}-exercise`, name: exerciseName, kind: 'strength', sets }],
});

test('weekly recommendations freeze at Monday and use the latest earlier workout', () => {
  const history = [
    workout('prior', '2026-08-03T06:00:00-04:00', 'Machine Chest Press', [
      { id: 'p1', weight: 85, reps: 10 },
      { id: 'p2', weight: 85, reps: 9 },
      { id: 'p3', weight: 85, reps: 8 },
    ]),
    workout('same-week', '2026-08-10T06:00:00-04:00', 'Machine Chest Press', [
      { id: 's1', weight: 100, reps: 12 },
      { id: 's2', weight: 100, reps: 12 },
      { id: 's3', weight: 100, reps: 12 },
    ]),
  ];

  const draft = buildWorkoutTemplateDraft(
    'push',
    () => crypto.randomUUID(),
    history,
    new Date('2026-08-13T06:00:00-04:00'),
  );

  assert.equal(draft.exercises[0].recommendedWeight, '85');
  assert.match(draft.exercises[0].prescription, /Hold 85 lb/);
  assert.ok(draft.exercises[0].sets.every(set => set.weight === '' && set.reps === ''));
});

test('optimizer does not merge similar machine names without a confirmed alias', () => {
  const history = [
    workout('other-machine', '2026-08-03T06:00:00-04:00', 'Chest Press Machine', [
      { id: '1', weight: 100, reps: 12 },
      { id: '2', weight: 100, reps: 12 },
      { id: '3', weight: 100, reps: 12 },
    ]),
  ];

  const draft = buildWorkoutTemplateDraft(
    'push',
    () => crypto.randomUUID(),
    history,
    new Date('2026-08-10T06:00:00-04:00'),
  );

  assert.equal(draft.exercises[0].recommendedWeight, undefined);
  assert.match(draft.exercises[0].prescription, /Establish a clean baseline/);
});

test('optimizer reduces after a missed final-set range and ignores implausible rep outliers', () => {
  const history = [
    workout('older-push', '2026-07-27T06:00:00-04:00', 'Machine Shoulder Press', [
      { id: 'o1', weight: 50, reps: 10 },
      { id: 'o2', weight: 50, reps: 9 },
      { id: 'o3', weight: 50, reps: 8 },
    ]),
    workout('push', '2026-08-03T06:00:00-04:00', 'Machine Shoulder Press', [
      { id: '1', weight: 55, reps: 8 },
      { id: '2', weight: 55, reps: 6 },
      { id: '3', weight: 55, reps: 74 },
    ]),
  ];

  const draft = buildWorkoutTemplateDraft(
    'push',
    () => crypto.randomUUID(),
    history,
    new Date('2026-08-10T06:00:00-04:00'),
  );
  const shoulderPress = draft.exercises.find(exercise => exercise.name === 'Machine Shoulder Press');

  assert.equal(shoulderPress.recommendedWeight, '50');
  assert.match(shoulderPress.prescription, /Reduce to 50 lb/);
});

test('optimizer uses a machine-step instruction instead of inventing an unsupported increment', () => {
  const history = [
    workout('push', '2026-08-03T06:00:00-04:00', 'Machine Chest Press', [
      { id: '1', weight: 70, reps: 9 },
      { id: '2', weight: 70, reps: 7 },
      { id: '3', weight: 70, reps: 7 },
    ]),
  ];

  const draft = buildWorkoutTemplateDraft(
    'push',
    () => crypto.randomUUID(),
    history,
    new Date('2026-08-10T06:00:00-04:00'),
  );

  assert.equal(draft.exercises[0].recommendedWeight, '↓ 1 step');
  assert.match(draft.exercises[0].prescription, /one machine step below 70 lb/i);
});

test('optimizer increases only after two completed sessions reach the top of range', () => {
  const completeHistory = [
    workout('baseline', '2026-07-20T06:00:00-04:00', 'Machine Chest Press', [
      { id: 'b1', weight: 75, reps: 10 },
      { id: 'b2', weight: 75, reps: 10 },
      { id: 'b3', weight: 75, reps: 10 },
    ]),
    workout('complete-older', '2026-07-27T06:00:00-04:00', 'Machine Chest Press', [
      { id: 'o1', weight: 80, reps: 12 },
      { id: 'o2', weight: 80, reps: 12 },
      { id: 'o3', weight: 80, reps: 12 },
    ]),
    workout('complete', '2026-08-03T06:00:00-04:00', 'Machine Chest Press', [
      { id: '1', weight: 80, reps: 12 },
      { id: '2', weight: 80, reps: 12 },
      { id: '3', weight: 80, reps: 12 },
    ]),
  ];
  const incompleteHistory = [
    workout('incomplete', '2026-08-03T06:00:00-04:00', 'Machine Chest Press', [
      { id: '1', weight: 80, reps: 14 },
      { id: '2', weight: 80, reps: 12 },
      { id: '3', weight: 80, reps: 10 },
    ]),
  ];
  const mixedWeightHistory = [
    workout('older-75', '2026-07-27T06:00:00-04:00', 'Machine Chest Press', [
      { id: 'm1', weight: 75, reps: 12 },
      { id: 'm2', weight: 75, reps: 12 },
      { id: 'm3', weight: 75, reps: 12 },
    ]),
    workout('latest-80', '2026-08-03T06:00:00-04:00', 'Machine Chest Press', [
      { id: 'm4', weight: 80, reps: 12 },
      { id: 'm5', weight: 80, reps: 12 },
      { id: 'm6', weight: 80, reps: 12 },
    ]),
  ];

  const promoted = buildWorkoutTemplateDraft(
    'push',
    () => crypto.randomUUID(),
    completeHistory,
    new Date('2026-08-10T06:00:00-04:00'),
  );
  const held = buildWorkoutTemplateDraft(
    'push',
    () => crypto.randomUUID(),
    incompleteHistory,
    new Date('2026-08-10T06:00:00-04:00'),
  );
  const awaitingConfirmation = buildWorkoutTemplateDraft(
    'push',
    () => crypto.randomUUID(),
    completeHistory.slice(-1),
    new Date('2026-08-10T06:00:00-04:00'),
  );
  const mixedWeights = buildWorkoutTemplateDraft(
    'push',
    () => crypto.randomUUID(),
    mixedWeightHistory,
    new Date('2026-08-10T06:00:00-04:00'),
  );

  assert.equal(promoted.exercises[0].recommendedWeight, '85');
  assert.match(promoted.exercises[0].prescription, /Increase to 85 lb/);
  assert.equal(held.exercises[0].recommendedWeight, '80');
  assert.match(held.exercises[0].prescription, /Hold 80 lb/);
  assert.equal(awaitingConfirmation.exercises[0].recommendedWeight, '80');
  assert.match(awaitingConfirmation.exercises[0].prescription, /Hold 80 lb/);
  assert.equal(mixedWeights.exercises[0].recommendedWeight, '80');
  assert.match(mixedWeights.exercises[0].prescription, /Hold 80 lb/);
});

test('unknown template ids fail clearly', () => {
  assert.throws(
    () => buildWorkoutTemplateDraft('bench-every-day', () => 'id'),
    /Unknown workout template/,
  );
});
