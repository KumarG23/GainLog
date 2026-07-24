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
    ['push', 'pull', 'legs', 'upper', 'lower-arms'],
  );
  assert.ok(PLANET_FITNESS_TEMPLATES.every(template => template.exercises.length >= 5));
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
  assert.equal(draft.exercises[0].prescription, '3 sets · 8–12 reps · rest 2 min');

  const cardio = draft.exercises.at(-1);
  assert.equal(cardio.kind, 'cardio');
  assert.equal(cardio.name, 'Elliptical');
  assert.equal(cardio.cardioDurationMinutes, '');
  assert.match(cardio.prescription, /Optional/);
});

test('suggested template follows Monday through Friday and leaves weekends open', () => {
  assert.equal(getSuggestedTemplateId(1), 'push');
  assert.equal(getSuggestedTemplateId(3), 'legs');
  assert.equal(getSuggestedTemplateId(5), 'lower-arms');
  assert.equal(getSuggestedTemplateId(0), null);
  assert.equal(getSuggestedTemplateId(6), null);
});

test('unknown template ids fail clearly', () => {
  assert.throws(
    () => buildWorkoutTemplateDraft('bench-every-day', () => 'id'),
    /Unknown workout template/,
  );
});
