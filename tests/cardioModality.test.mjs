import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { cardioSwapChoices, isTreadmill, swapCardioModality } from '../utils/cardioModality.ts';
import { buildWorkoutTemplateDraft } from '../utils/workoutTemplates.ts';

test('cardio swaps work in both directions without matching other activities or strength', () => {
  assert.deepEqual(cardioSwapChoices('Elliptical', 'cardio'), ['Treadmill']);
  assert.deepEqual(cardioSwapChoices('Treadmill', 'cardio'), ['Elliptical']);
  assert.deepEqual(cardioSwapChoices('Bike', 'cardio'), []);
  assert.deepEqual(cardioSwapChoices('Elliptical', 'strength'), []);
  assert.equal(isTreadmill(' treadmill '), true);
});

test('cardio correction preserves actual minutes/miles and prescription, clears machine settings', () => {
  const original = { id: 'test', name: 'Elliptical', kind: 'cardio', cardioDurationMinutes: '32', distanceMiles: '1.8', resistanceLevel: '4', inclinePercent: '', prescription: 'Easy', sets: [] };
  const treadmill = swapCardioModality(original, 'Treadmill');
  assert.deepEqual(treadmill, { ...original, name: 'Treadmill', resistanceLevel: '' });
  const elliptical = swapCardioModality({ ...treadmill, inclinePercent: '2.5' }, 'Elliptical');
  assert.deepEqual(elliptical, { ...original, resistanceLevel: '' });
  assert.equal(original.resistanceLevel, '4');
  assert.equal(swapCardioModality(original, 'Bike'), original);
});

test('recovery and optional finisher drafts can swap without changing plan identity or filling actuals', () => {
  for (const template of ['recovery', 'push', 'pull', 'legs', 'upper']) {
    const draft = buildWorkoutTemplateDraft(template, () => 'test', [], new Date('2026-09-09T12:00:00Z'));
    const cardio = draft.exercises.find(ex => ex.kind === 'cardio');
    const swapped = swapCardioModality(cardio, 'Treadmill');
    assert.equal(swapped.name, 'Treadmill');
    assert.equal(swapped.cardioDurationMinutes, '');
    assert.equal(swapped.inclinePercent, '');
    assert.equal(draft.template.id, template);
  }
});

test('Log and history wire separate incline storage and cardio swaps outside strength template guard', () => {
  const log = readFileSync(new URL('../app/(tabs)/index.tsx', import.meta.url), 'utf8');
  const history = readFileSync(new URL('../app/session/[id].tsx', import.meta.url), 'utf8');
  assert.match(log, /cardioSwapChoices\(exercise.name, exercise.kind\)/);
  assert.match(log, /current.kind === 'cardio'[\s\S]*swapCardioModality[\s\S]*if \(!selectedTemplateId\) return/);
  assert.match(log, /'INCLINE \(%\)' : 'RESISTANCE'/);
  assert.match(log, /inclinePercent: e.kind === 'cardio' && isTreadmill\(e.name\)/);
  assert.match(log, /resistanceLevel: e.kind === 'cardio' && !isTreadmill\(e.name\)/);
  assert.match(history, /Incline \$\{exercise.inclinePercent\}%/);
});
