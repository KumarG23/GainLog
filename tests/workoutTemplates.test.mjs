import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import * as workoutTemplates from '../utils/workoutTemplates.ts';

const logScreen = readFileSync(new URL('../app/(tabs)/index.tsx', import.meta.url), 'utf8');

const {
  PLANET_FITNESS_TEMPLATES,
  applyWorkoutPlanOverrides,
  buildWorkoutTemplateDraft,
  getSuggestedTemplateId,
  substituteWorkoutTemplateExercise,
} = workoutTemplates;

test('only an actual draft prescription is serialized at workout save', () => {
  const parse = workoutTemplates.savedRepPrescription;
  assert.deepEqual(parse('8–12', 3), { targetRepsMin: 8, targetRepsMax: 12, prescribedSets: 3 });
  assert.deepEqual(parse('10-15', 2), { targetRepsMin: 10, targetRepsMax: 15, prescribedSets: 2 });
  for (const input of [undefined, 'about 12', '12–8', '0–12', '8–41']) {
    assert.equal(parse(input, 3), undefined);
  }
  assert.equal(parse('8–12', 0), undefined);
  assert.match(logScreen, /savedRepPrescription\(e\.targetReps, e\.prescribedSets \?\? e\.sets\.length\)/);
  let serial = 0;
  const draft = buildWorkoutTemplateDraft('push', () => String(++serial));
  assert.deepEqual(parse(draft.exercises[0].targetReps, draft.exercises[0].prescribedSets),
    { targetRepsMin: 8, targetRepsMax: 12, prescribedSets: 3 });
  assert.equal(parse(draft.exercises.at(-1).targetReps, draft.exercises.at(-1).prescribedSets), undefined);
});

test('workout templates stay locked until history loads successfully', () => {
  const canLoad = workoutTemplates.canLoadWorkoutTemplate;

  assert.equal(typeof canLoad, 'function');
  if (typeof canLoad !== 'function') return;

  assert.equal(canLoad(true, null), false);
  assert.equal(canLoad(false, 'Request failed'), false);
  assert.equal(canLoad(false, null), true);
});

test('Log screen exposes failed workout history and a retry instead of a clean baseline', () => {
  assert.match(logScreen, /error: workoutsError/);
  assert.match(logScreen, /canLoadWorkoutTemplate\(workoutsLoading, workoutsError\)/);
  assert.match(logScreen, /disabled=\{!canLoadTemplate\}/);
  assert.match(logScreen, /Workout history unavailable/);
  assert.match(logScreen, /onPress=\{\(\) => void refresh\(\)\}/);
});

test('workout completion requires one overall effort rating and notes before save', () => {
  assert.match(logScreen, /useState<WorkoutEffort \| null>\(null\)/);
  assert.match(logScreen, /Workout Effort Required/);
  assert.match(logScreen, /Workout Notes Required/);
  assert.match(logScreen, /Required once per workout/);
  assert.match(logScreen, /Easy/);
  assert.match(logScreen, /About right/);
  assert.match(logScreen, /Hard/);
  assert.match(logScreen, /notes: notes\.trim\(\)/);
  assert.match(logScreen, /effort,/);
});

test('Log screen offers one-tap crowded-gym swaps and clears stale set data after confirmation', () => {
  assert.match(logScreen, /Swap exercise/);
  assert.match(logScreen, /substituteWorkoutTemplateExercise/);
  assert.match(logScreen, /Replace started exercise\?/);
  assert.match(logScreen, /This clears the entered sets/);
});

test('planned exercise names are read-only so work cannot be reassigned by manual rename', () => {
  assert.match(logScreen, /editable=\{!exercise\.substitutionOptions\}/);
  assert.match(logScreen, /if \(e\.substitutionOptions\) return e;/);
});

test('Android substitution alert remains within its three-button limit', () => {
  assert.match(logScreen, /\.filter\(name => name !== exercise\.name\)\s*\.slice\(0, 2\)/);
});

const workout = (id, date, exerciseName, sets, feedback = {}) => ({
  id,
  date,
  durationMinutes: 40,
  templateId: 'push',
  pain: false,
  ...feedback,
  exercises: [{ id: `${id}-exercise`, name: exerciseName, kind: 'strength', sets }],
});

test('Planet Fitness plan provides five ordered weekday templates', () => {
  assert.deepEqual(
    PLANET_FITNESS_TEMPLATES.map(template => template.id),
    ['push', 'pull', 'recovery', 'legs', 'upper'],
  );
  assert.equal(PLANET_FITNESS_TEMPLATES[2].weekday, 'Wednesday');
  assert.equal(PLANET_FITNESS_TEMPLATES[2].exercises.length, 0);
  assert.equal(PLANET_FITNESS_TEMPLATES[3].weekday, 'Thursday');
  assert.deepEqual(
    PLANET_FITNESS_TEMPLATES[3].exercises.map(exercise => exercise.name),
    ['45-Degree Leg Press', 'Standing Calf Raise', 'Leg Extension', 'Seated Leg Curl'],
  );
  const calfRaise = PLANET_FITNESS_TEMPLATES[3].exercises[1];
  assert.equal(calfRaise.targetReps, '12–20');
  assert.deepEqual(calfRaise.substitutions, [
    'Calf Raise Machine', 'Calf Press on Leg Press',
  ]);
  const draft = buildWorkoutTemplateDraft('legs', (() => { let id = 0; return () => String(++id); })());
  assert.equal(draft.exercises[1].name, 'Standing Calf Raise');
  assert.match(draft.exercises[1].prescription, /3 × 12–20/);
  assert.match(draft.exercises[1].cue, /standing calf raise machine/);
  assert.ok(draft.exercises[1].sets.every(set => set.weight === '' && set.reps === ''));
  const priorLegs = workout('calf-history', '2026-08-20T07:20:47-04:00', 'Standing Calf Raise', [
    { weight: 110, reps: 20 }, { weight: 130, reps: 15 }, { weight: 130, reps: 12 },
  ], { templateId: 'legs' });
  const withHistory = buildWorkoutTemplateDraft('legs', () => 'id', [priorLegs], new Date(2026, 8, 24));
  assert.equal(withHistory.exercises[1].recommendedWeight, '130');
  assert.ok(withHistory.exercises[1].sets.every(set => set.weight === '' && set.reps === ''));
  assert.equal(PLANET_FITNESS_TEMPLATES[4].weekday, 'Friday');
});

test('server-owned plan changes draft prescriptions without filling actual sets', () => {
  const baseLegs = PLANET_FITNESS_TEMPLATES.find(template => template.id === 'legs');
  const replacement = { ...baseLegs.exercises[1], targetReps: '10–15' };
  const templates = applyWorkoutPlanOverrides({
    legs: [baseLegs.exercises[0], replacement, ...baseLegs.exercises.slice(2)],
  });
  assert.equal(templates.find(template => template.id === 'legs').exercises[1].targetReps, '10–15');
  assert.equal(baseLegs.exercises[1].targetReps, '12–20');
  const draft = buildWorkoutTemplateDraft('legs', () => 'id', [], new Date(2026, 8, 24), templates);
  assert.equal(draft.exercises[1].name, 'Standing Calf Raise');
  assert.equal(draft.exercises[1].targetReps, '10–15');
  assert.ok(draft.exercises[1].sets.every(set => set.weight === '' && set.reps === ''));
  assert.match(logScreen, /applyWorkoutPlanOverrides\(planOverrides\)/);
  assert.match(logScreen, /buildWorkoutTemplateDraft\(templateId, generateId, sessions, new Date\(\), activeTemplates\)/);
});

test('next week prioritizes learnable chest presses with same-role crowded-gym options', () => {
  const push = PLANET_FITNESS_TEMPLATES.find(template => template.id === 'push');
  const upper = PLANET_FITNESS_TEMPLATES.find(template => template.id === 'upper');

  assert.deepEqual(push.exercises.slice(0, 2).map(exercise => exercise.name), [
    'Smith Machine Bench Press',
    'Incline Dumbbell Bench Press',
  ]);
  assert.deepEqual(push.exercises[0].substitutions, [
    'Machine Chest Press',
    'Dumbbell Bench Press',
  ]);
  assert.deepEqual(push.exercises[1].substitutions, [
    'Smith Machine Incline Bench Press',
    'Incline Chest Press Machine',
  ]);
  assert.equal(upper.exercises[0].name, 'Incline Dumbbell Bench Press');
  assert.match(push.exercises[1].cue, /15–30°/);
});

test('every lifting exercise offers two same-role crowded-gym substitutions', () => {
  const liftingTemplates = PLANET_FITNESS_TEMPLATES.filter(template => template.id !== 'recovery');

  for (const template of liftingTemplates) {
    for (const exercise of template.exercises) {
      assert.equal(exercise.substitutions?.length, 2, `${template.id}: ${exercise.name}`);
      assert.equal(new Set([exercise.name, ...exercise.substitutions]).size, 3);
    }
  }
});

test('template draft creates blank strength sets and an optional cardio finisher', () => {
  let nextId = 0;
  const draft = buildWorkoutTemplateDraft('push', () => `id-${++nextId}`);

  assert.equal(draft.template.id, 'push');
  assert.equal(draft.exercises[0].name, 'Smith Machine Bench Press');
  assert.equal(draft.exercises[0].sets.length, 3);
  assert.deepEqual(draft.exercises[0].sets[0], {
    id: 'id-2',
    weight: '',
    reps: '',
  });
  assert.equal(
    draft.exercises[0].prescription,
    'Establish a clean baseline · 3 × 8–12 · rest 2 min · keep 2 good reps in reserve',
  );
  assert.deepEqual(draft.exercises[0].substitutionOptions, [
    'Smith Machine Bench Press',
    'Machine Chest Press',
    'Dumbbell Bench Press',
  ]);

  const cardio = draft.exercises.at(-1);
  assert.equal(cardio.kind, 'cardio');
  assert.equal(cardio.name, 'Elliptical');
  assert.equal(cardio.cardioDurationMinutes, '');
  assert.match(cardio.prescription, /Optional/);
});

test('crowded-gym swap clears entered sets and uses only exact substitute history', () => {
  const history = [
    workout('machine-older', '2026-08-17T06:00:00-04:00', 'Machine Chest Press', [
      { id: 'o1', weight: 80, reps: 12 },
      { id: 'o2', weight: 80, reps: 10 },
      { id: 'o3', weight: 80, reps: 9 },
    ], { templateId: 'push', effort: 'right', notes: 'Clean controlled reps.' }),
    workout('machine-latest', '2026-08-24T06:00:00-04:00', 'Machine Chest Press', [
      { id: 'l1', weight: 85, reps: 16 },
      { id: 'l2', weight: 85, reps: 13 },
      { id: 'l3', weight: 85, reps: 10 },
    ], { templateId: 'push', effort: 'right', notes: 'Clean controlled reps.' }),
  ];
  let nextId = 0;
  const draft = buildWorkoutTemplateDraft(
    'push',
    () => `id-${++nextId}`,
    history,
    new Date('2026-08-31T06:00:00-04:00'),
  );
  const started = {
    ...draft.exercises[0],
    sets: draft.exercises[0].sets.map(set => ({ ...set, weight: '35', reps: '8' })),
  };
  const swapped = substituteWorkoutTemplateExercise(
    started,
    'Machine Chest Press',
    'push',
    history,
    new Date('2026-08-31T06:00:00-04:00'),
  );

  assert.equal(swapped.name, 'Machine Chest Press');
  assert.equal(swapped.recommendedWeight, '85');
  assert.match(swapped.prescription, /Hold 85 lb/);
  assert.ok(swapped.sets.every(set => set.weight === '' && set.reps === ''));
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

test('weekly recommendations freeze at Monday and use the latest earlier workout', () => {
  const history = [
    workout('prior', '2026-08-03T06:00:00-04:00', 'Smith Machine Bench Press', [
      { id: 'p1', weight: 85, reps: 10 },
      { id: 'p2', weight: 85, reps: 9 },
      { id: 'p3', weight: 85, reps: 8 },
    ]),
    workout('same-week', '2026-08-10T06:00:00-04:00', 'Smith Machine Bench Press', [
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

test('optimizer keeps shared exercises isolated to the selected workout template', () => {
  const history = [
    workout('push', '2026-08-03T06:00:00-04:00', 'Machine Shoulder Press', [
      { id: 'p1', weight: 60, reps: 10 },
      { id: 'p2', weight: 60, reps: 9 },
      { id: 'p3', weight: 60, reps: 8 },
    ], { templateId: 'push', effort: 'right', notes: 'Clean Push session.' }),
    workout('upper', '2026-08-07T06:00:00-04:00', 'Machine Shoulder Press', [
      { id: 'u1', weight: 70, reps: 10 },
      { id: 'u2', weight: 70, reps: 9 },
    ], { templateId: 'upper', effort: 'right', notes: 'Clean Upper session.' }),
  ];

  const draft = buildWorkoutTemplateDraft(
    'push',
    () => crypto.randomUUID(),
    history,
    new Date('2026-08-10T06:00:00-04:00'),
  );
  const shoulderPress = draft.exercises.find(exercise => exercise.name === 'Machine Shoulder Press');

  assert.equal(shoulderPress.recommendedWeight, '60');
  assert.match(shoulderPress.prescription, /Hold 60 lb/);
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

test('optimizer uses an available load-step instruction instead of assuming machine hardware', () => {
  const history = [
    workout('older-push', '2026-07-27T06:00:00-04:00', 'Smith Machine Bench Press', [
      { id: 'o1', weight: 50, reps: 10 },
      { id: 'o2', weight: 50, reps: 9 },
      { id: 'o3', weight: 50, reps: 8 },
    ]),
    workout('push', '2026-08-03T06:00:00-04:00', 'Smith Machine Bench Press', [
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
  assert.match(draft.exercises[0].prescription, /one available load step below 70 lb/i);
});

test('optimizer describes an earned free-weight increase as one available load step', () => {
  const topSets = suffix => [
    { id: `${suffix}1`, weight: 80, reps: 12 },
    { id: `${suffix}2`, weight: 80, reps: 12 },
    { id: `${suffix}3`, weight: 80, reps: 12 },
  ];
  const history = [
    workout('older', '2026-07-27T06:00:00-04:00', 'Smith Machine Bench Press', topSets('o'), {
      effort: 'right', notes: 'Clean controlled reps.',
    }),
    workout('latest', '2026-08-03T06:00:00-04:00', 'Smith Machine Bench Press', topSets('l'), {
      effort: 'easy', notes: 'Strong controlled reps.',
    }),
  ];

  const draft = buildWorkoutTemplateDraft(
    'push',
    () => crypto.randomUUID(),
    history,
    new Date('2026-08-10T06:00:00-04:00'),
  );

  assert.equal(draft.exercises[0].recommendedWeight, '↑ 1 step');
  assert.match(draft.exercises[0].prescription, /next available load step above 80 lb/i);
});

test('optimizer requires two complete top-of-range sessions at the same load', () => {
  const completeHistory = [
    workout('baseline', '2026-07-20T06:00:00-04:00', 'Smith Machine Bench Press', [
      { id: 'b1', weight: 75, reps: 10 },
      { id: 'b2', weight: 75, reps: 10 },
      { id: 'b3', weight: 75, reps: 10 },
    ]),
    workout('complete-older', '2026-07-27T06:00:00-04:00', 'Smith Machine Bench Press', [
      { id: 'o1', weight: 80, reps: 12 },
      { id: 'o2', weight: 80, reps: 12 },
      { id: 'o3', weight: 80, reps: 12 },
    ], { effort: 'right', notes: 'Clean form and controlled reps.' }),
    workout('complete', '2026-08-03T06:00:00-04:00', 'Smith Machine Bench Press', [
      { id: '1', weight: 80, reps: 12 },
      { id: '2', weight: 80, reps: 12 },
      { id: '3', weight: 80, reps: 12 },
    ], { effort: 'easy', notes: 'Felt strong with clean form.' }),
  ];
  const incompleteHistory = [
    workout('incomplete', '2026-08-03T06:00:00-04:00', 'Smith Machine Bench Press', [
      { id: '1', weight: 80, reps: 14 },
      { id: '2', weight: 80, reps: 12 },
      { id: '3', weight: 80, reps: 10 },
    ]),
  ];
  const mixedWeightHistory = [
    workout('older-75', '2026-07-27T06:00:00-04:00', 'Smith Machine Bench Press', [
      { id: 'm1', weight: 75, reps: 12 },
      { id: 'm2', weight: 75, reps: 12 },
      { id: 'm3', weight: 75, reps: 12 },
    ]),
    workout('latest-80', '2026-08-03T06:00:00-04:00', 'Smith Machine Bench Press', [
      { id: 'm4', weight: 80, reps: 12 },
      { id: 'm5', weight: 80, reps: 12 },
      { id: 'm6', weight: 80, reps: 12 },
    ], { effort: 'right', notes: 'Felt good.' }),
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

test('optimizer counts duplicate same-name entries as one prior session', () => {
  const completeSets = suffix => [
    { id: `${suffix}1`, weight: 80, reps: 12 },
    { id: `${suffix}2`, weight: 80, reps: 12 },
    { id: `${suffix}3`, weight: 80, reps: 12 },
  ];
  const duplicateSession = workout(
    'duplicate',
    '2026-08-03T06:00:00-04:00',
    'Smith Machine Bench Press',
    completeSets('a'),
    { effort: 'easy', notes: 'Felt strong with clean form.' },
  );
  duplicateSession.exercises.push({
    id: 'duplicate-exercise-2',
    name: 'Smith Machine Bench Press',
    kind: 'strength',
    sets: [{ id: 'b1', weight: 80, reps: 12 }, { id: 'b2', weight: 80, reps: 12 }, { id: 'b3', weight: 80, reps: 11 }],
  });
  const history = [
    workout('baseline', '2026-07-27T06:00:00-04:00', 'Smith Machine Bench Press', [
      { id: 'b1', weight: 75, reps: 10 },
      { id: 'b2', weight: 75, reps: 10 },
      { id: 'b3', weight: 75, reps: 10 },
    ], { effort: 'right', notes: 'Clean baseline.' }),
    duplicateSession,
  ];

  const chestPress = buildWorkoutTemplateDraft(
    'push',
    () => crypto.randomUUID(),
    history,
    new Date('2026-08-10T06:00:00-04:00'),
  ).exercises[0];

  assert.equal(chestPress.recommendedWeight, '80');
  assert.match(chestPress.prescription, /Hold 80 lb/);

  const duplicateIdHistory = [
    workout('baseline-id', '2026-07-20T06:00:00-04:00', 'Smith Machine Bench Press', [
      { id: 'id-b1', weight: 75, reps: 10 },
      { id: 'id-b2', weight: 75, reps: 10 },
      { id: 'id-b3', weight: 75, reps: 10 },
    ], { effort: 'right', notes: 'Clean baseline.' }),
    workout('same-session', '2026-07-27T06:00:00-04:00', 'Smith Machine Bench Press', completeSets('same-a'), {
      effort: 'right', notes: 'Clean controlled reps.',
    }),
    workout('same-session', '2026-08-03T06:00:00-04:00', 'Smith Machine Bench Press', completeSets('same-b'), {
      effort: 'easy', notes: 'Strong controlled reps.',
    }),
  ];
  const duplicateIdChestPress = buildWorkoutTemplateDraft(
    'push',
    () => crypto.randomUUID(),
    duplicateIdHistory,
    new Date('2026-08-10T06:00:00-04:00'),
  ).exercises[0];
  assert.equal(duplicateIdChestPress.recommendedWeight, '80');
  assert.match(duplicateIdChestPress.prescription, /Hold 80 lb/);
});

test('optimizer increases with complete performance and safe feedback, not older feedback', () => {
  const topSets = suffix => [
    { id: `${suffix}1`, weight: 80, reps: 12 },
    { id: `${suffix}2`, weight: 80, reps: 12 },
    { id: `${suffix}3`, weight: 80, reps: 12 },
  ];
  const build = history => buildWorkoutTemplateDraft(
    'push',
    () => crypto.randomUUID(),
    history,
    new Date('2026-08-10T06:00:00-04:00'),
  ).exercises[0];
  const cleanFeedback = [
    workout('baseline', '2026-07-20T06:00:00-04:00', 'Smith Machine Bench Press', [
      { id: 'b1', weight: 75, reps: 10 },
      { id: 'b2', weight: 75, reps: 10 },
      { id: 'b3', weight: 75, reps: 10 },
    ], { effort: 'right', notes: 'Clean baseline.' }),
    workout('older', '2026-07-27T06:00:00-04:00', 'Smith Machine Bench Press', topSets('o'), {
      effort: 'right',
      notes: 'Clean form with a couple reps left.',
    }),
    workout('latest', '2026-08-03T06:00:00-04:00', 'Smith Machine Bench Press', topSets('l'), {
      effort: 'easy',
      notes: 'Felt strong and controlled.',
    }),
  ];
  const missingEffort = cleanFeedback.map(session => ({ ...session, effort: undefined }));
  const concerningNotes = cleanFeedback.map((session, index) => index === 2
    ? { ...session, notes: 'Form broke down and the weight felt too heavy.' }
    : session);

  assert.equal(build(cleanFeedback).recommendedWeight, '85');
  assert.match(build(cleanFeedback).prescription, /Increase to 85 lb/);
  assert.equal(build(missingEffort).recommendedWeight, '80');
  assert.match(build(missingEffort).prescription, /Hold 80 lb/);
  assert.equal(build(concerningNotes).recommendedWeight, '80');
  assert.match(build(concerningNotes).prescription, /Hold 80 lb/);
});

test('optimizer recognizes natural concern notes without rejecting clearly safe notes', () => {
  const topSets = suffix => [
    { id: `${suffix}1`, weight: 80, reps: 12 },
    { id: `${suffix}2`, weight: 80, reps: 12 },
    { id: `${suffix}3`, weight: 80, reps: 12 },
  ];
  const build = notes => buildWorkoutTemplateDraft(
    'push',
    () => crypto.randomUUID(),
    [
      workout('baseline', '2026-07-20T06:00:00-04:00', 'Smith Machine Bench Press', [
        { id: 'b1', weight: 75, reps: 10 },
        { id: 'b2', weight: 75, reps: 10 },
        { id: 'b3', weight: 75, reps: 10 },
      ], { effort: 'right', notes: 'Clean baseline.' }),
      workout('older', '2026-07-27T06:00:00-04:00', 'Smith Machine Bench Press', topSets('o'), {
        effort: 'right',
        notes: 'No pain or issues; form felt good and controlled.',
      }),
      workout('latest', '2026-08-03T06:00:00-04:00', 'Smith Machine Bench Press', topSets('l'), {
        effort: 'easy',
        notes,
      }),
    ],
    new Date('2026-08-10T06:00:00-04:00'),
  ).exercises[0];

  for (const notes of [
    'Shoulder discomfort during the final set.',
    'My joint bothered me on the press.',
    'The movement felt off today.',
    'I noticed instability and shakiness.',
    'The last reps were grinding and I was struggling.',
    'Poor sleep last night.',
  ]) {
    assert.equal(build(notes).recommendedWeight, '80', notes);
    assert.match(build(notes).prescription, /Hold 80 lb/, notes);
  }
  for (const notes of [
    'No pain and no issues; clean, controlled form.',
    'Shoulders felt stable and form felt good.',
  ]) {
    assert.equal(build(notes).recommendedWeight, '85', notes);
    assert.match(build(notes).prescription, /Increase to 85 lb/, notes);
  }
});

test('optimizer vetoes clear safety concerns but accepts neutral notes', () => {
  const topSets = suffix => [
    { id: `${suffix}1`, weight: 80, reps: 12 },
    { id: `${suffix}2`, weight: 80, reps: 12 },
    { id: `${suffix}3`, weight: 80, reps: 12 },
  ];
  const build = notes => buildWorkoutTemplateDraft(
    'push',
    () => crypto.randomUUID(),
    [
      workout('baseline', '2026-07-20T06:00:00-04:00', 'Smith Machine Bench Press', [
        { id: 'b1', weight: 75, reps: 10 },
        { id: 'b2', weight: 75, reps: 10 },
        { id: 'b3', weight: 75, reps: 10 },
      ], { effort: 'right', notes: 'Clean baseline.' }),
      workout('older', '2026-07-27T06:00:00-04:00', 'Smith Machine Bench Press', topSets('o'), {
        effort: 'right',
        notes: 'Strong, clean, controlled reps.',
      }),
      workout('latest', '2026-08-03T06:00:00-04:00', 'Smith Machine Bench Press', topSets('l'), {
        effort: 'easy',
        notes,
      }),
    ],
    new Date('2026-08-10T06:00:00-04:00'),
  ).exercises[0];
  const notesThatMustHold = [
    'My shoulder was sore after the final set.',
    'Shoulder was tired during the last reps.',
    'I felt a pinch in my elbow.',
    'My wrist felt stiff afterward.',
    'Reps were clean and controlled, but my shoulder hurts.',
    'Strong, controlled reps. My shoulder is bothering me.',
    'Strong, controlled reps. My shoulder bothers me.',
    'Strong, controlled reps. My elbow acted up afterward.',
    'Strong, controlled reps.My elbow acted up afterward.',
    'Strong, controlled reps;My elbow acted up afterward.',
    'Strong, controlled reps:My elbow acted up afterward.',
    'Strong and controlled\nMy elbow acted up afterward.',
    'The reps were not controlled.',
    'I was not strong today.',
    'I do not feel strong today.',
    'Strong controlled reps, my elbow acted up afterward.',
    'Reps were clean and controlled, but my shoulder was sore after the final set.',
    'The movement was smooth, but shoulder fatigue set in during the last reps.',
    'The reps felt solid, but I felt pinching in my elbow.',
    'Form was stable, but my wrist had stiffness afterward.',
  ];

  assert.deepEqual(
    notesThatMustHold.map(notes => ({
      notes,
      weight: build(notes).recommendedWeight,
    })),
    notesThatMustHold.map(notes => ({ notes, weight: '80' })),
  );
  for (const notes of ['Workout complete', 'Felt good.', 'Good workout.', 'Trying to keep progressing.', 'Nothing special.', '']) {
    assert.equal(build(notes).recommendedWeight, '85', notes);
  }
});

test('double progression requires two qualifying sessions and keeps safety vetoes', () => {
  const draft = (exerciseName, reps, feedback = {}, weights = reps.map(() => 90)) => {
    const sets = reps.map((count, i) => ({ id: `set-${i}`, weight: weights[i], reps: count }));
    return buildWorkoutTemplateDraft('pull', () => crypto.randomUUID(), [
      workout('older', '2026-07-27T06:00:00-04:00', exerciseName, [
        { id: 'old-1', weight: 85, reps: 10 }, { id: 'old-2', weight: 85, reps: 10 }, { id: 'old-3', weight: 85, reps: 10 },
      ], { templateId: 'pull' }),
      workout('latest', '2026-08-03T06:00:00-04:00', exerciseName, sets,
        { templateId: 'pull', effort: 'right', notes: 'Felt good.', ...feedback }),
    ], new Date('2026-08-10T06:00:00-04:00')).exercises.find(ex => ex.name === exerciseName);
  };
  const row = 'Chest-Supported Row Machine'; // 10–15
  for (const notes of ['Felt good.', 'Good workout.', 'Trying to keep progressing.', 'Nothing special.', '']) {
    assert.match(draft(row, [17, 20, 16], { notes }).prescription, /Hold 90 lb/, notes);
  }
  assert.match(draft(row, [15, 15, 15], { effort: 'easy' }).prescription, /Hold 90 lb/);
  assert.match(draft('Reverse Pec Deck', [20, 21, 20]).prescription, /Hold 90 lb/); // 12–20
  assert.match(draft('Seated Cable Row', [12, 13, 12]).prescription, /Hold 90 lb/); // 8–12
  for (const feedback of [{ pain: true }, { pain: undefined }, { effort: 'hard' }, { effort: undefined },
    { notes: 'Shoulder hurt.' }, { notes: 'Form broke down.' }, { notes: 'Weight felt too heavy.' },
    { notes: "Couldn't control the reps." }, { notes: 'No pain, but my elbow hurt.' },
    { notes: 'Bad form on last set.' }, { notes: 'Lost control of the reps.' },
    { notes: 'Technique slipped near the end.' }]) {
    assert.match(draft(row, [17, 20, 16], feedback).prescription, /Hold 90 lb/, JSON.stringify(feedback));
  }
  assert.match(draft(row, [15, 15, 15], {}, [90, 85, 90]).prescription, /Hold 90 lb/);
  assert.match(draft(row, [6, 12, 12], {}, [50, 80, 80]).prescription, /Hold 80 lb/);
  assert.match(draft(row, [15, 15]).prescription, /Hold 90 lb/);
  assert.match(draft(row, [15, 14, 15]).prescription, /Hold 90 lb/);
  assert.match(draft(row, [9, 12, 11]).prescription, /Hold 90 lb/); // one slightly low set
  assert.match(draft(row, [9, 9, 11]).prescription, /Reduce to 85 lb/);
  assert.match(draft(row, [8, 12, 11]).prescription, /Reduce to 85 lb/);
  assert.match(draft(row, [9, 12, 11], { effort: 'hard' }).prescription, /Reduce to 85 lb/);
  assert.match(draft(row, [15, 41, 15]).prescription, /Hold 90 lb/);
  assert.match(draft(row, [15, 15, 15], { notes: 'No form issues. Not bad form.' }).prescription, /Hold 90 lb/);
});

test('the weekly prescription freezes performance but same-week pain vetoes an increase', () => {
  const row = 'Chest-Supported Row Machine';
  const top = [15, 17, 16].map((reps, i) => ({ id: `t${i}`, weight: 90, reps }));
  const base = [
    workout('baseline', '2026-07-26T06:00:00-04:00', row,
      [10, 11, 12].map((reps, i) => ({ id: `b${i}`, weight: 85, reps })), { templateId: 'pull' }),
    workout('older', '2026-08-02T06:00:00-04:00', row, top,
      { templateId: 'pull', effort: 'right', pain: false, notes: 'Felt good.' }),
    workout('qualifying', '2026-08-09T08:00:00-04:00', row, top,
      { templateId: 'pull', effort: 'right', pain: false, notes: 'Felt good.' }),
  ];
  const planDate = new Date('2026-08-11T08:00:00-04:00');
  const recommendation = extra => buildWorkoutTemplateDraft('pull', () => crypto.randomUUID(),
    [...base, ...extra], planDate).exercises.find(ex => ex.name === row).prescription;
  assert.match(recommendation([]), /Increase to 95 lb/);
  const offsetBoundary = [base[0], base[1], { ...base[2], date: '2026-08-10T00:30:00+09:00' }];
  assert.match(buildWorkoutTemplateDraft('pull', () => crypto.randomUUID(), offsetBoundary, planDate)
    .exercises.find(ex => ex.name === row).prescription, /Increase to 95 lb/);
  assert.match(buildWorkoutTemplateDraft('pull', () => crypto.randomUUID(),
    [base[0], base[1], { ...base[2], date: '2026-08-10T00:30:00-04:00' }], planDate)
    .exercises.find(ex => ex.name === row).prescription, /Hold 90 lb/);
  assert.match(recommendation([workout('safe-same-week', '2026-08-10T07:00:00-04:00', row, top,
    { templateId: 'pull', effort: 'right', pain: false })]), /Increase to 95 lb/);
  for (const feedback of [{ pain: true }, { effort: 'hard' }, { notes: 'Bad form on last set.' }]) {
    assert.match(recommendation([workout('concern', '2026-08-10T07:00:00-04:00', row, top,
      { templateId: 'pull', ...feedback })]), /Hold 90 lb/);
  }
  assert.match(recommendation([workout('other-template', '2026-08-10T07:00:00-04:00', row, top,
    { templateId: 'upper', pain: true })]), /Increase to 95 lb/);
  assert.match(recommendation([workout('future', '2026-08-11T09:00:00-04:00', row, top,
    { templateId: 'pull', pain: true })]), /Increase to 95 lb/);
});

test('unknown template ids fail clearly', () => {
  assert.throws(
    () => buildWorkoutTemplateDraft('bench-every-day', () => 'id'),
    /Unknown workout template/,
  );
});
