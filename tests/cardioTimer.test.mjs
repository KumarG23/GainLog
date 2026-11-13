import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { cardioTimingValid, elapsedCardioSeconds, formatElapsed, isCardioRunning, parseLocalCardioClock, startCardio, stopCardio } from '../utils/cardioTimer.ts';
import { serializeWorkoutDraft, parseWorkoutDraft } from '../utils/workoutDraftCodec.ts';

test('start, elapsed wall time after remount/background, and atomic stop derive actual minutes', () => {
  const start = Date.parse('2026-11-13T12:00:00Z');
  const started = startCardio(start);
  assert.equal(started.cardioDurationMinutes, '');
  assert.equal(isCardioRunning(started), true);
  assert.equal(formatElapsed(elapsedCardioSeconds(started.cardioStartedAt, start + 3_661_000)), '01:01:01');
  const ended = { ...started, ...stopCardio(started.cardioStartedAt, start + 3_661_000) };
  assert.equal(ended.cardioDurationMinutes, '61');
  assert.equal(isCardioRunning(ended), false);
  assert.equal(cardioTimingValid(ended), true);
  assert.equal(stopCardio(started.cardioStartedAt, start), null);
  assert.equal(stopCardio(started.cardioStartedAt, start + 1000).cardioDurationMinutes, '1');
});

test('local clocks validate dates, spring gaps, and overnight windows', () => {
  assert.equal(parseLocalCardioClock('2026-02-30', '23:55'), null);
  assert.equal(parseLocalCardioClock('2026-11-13', '24:00'), null);
  assert.equal(parseLocalCardioClock('2026-03-08', '02:30'), null);
  const start = parseLocalCardioClock('2026-11-13', '23:55');
  const end = parseLocalCardioClock('2026-11-14', '00:05');
  assert.equal((Date.parse(end) - Date.parse(start)) / 60000, 10);
  assert.equal(cardioTimingValid({ cardioStartedAt: start, cardioEndedAt: end, cardioDurationMinutes: '10' }), true);
  assert.equal(cardioTimingValid({ cardioStartedAt: end, cardioEndedAt: start, cardioDurationMinutes: '10' }), false);
  assert.equal(cardioTimingValid({ cardioStartedAt: start, cardioDurationMinutes: '' }), false);
  assert.equal(cardioTimingValid({ cardioDurationMinutes: '10' }), true);
});

test('running timer survives persisted workout draft and blocks save even with blank minutes', () => {
  const started = startCardio(Date.parse('2026-11-13T12:00:00Z'));
  const draft = { exercises: [{ id: 'fixture', kind: 'cardio', name: 'Bike', ...started }], strengthDuration: '', strengthHeartRate: '', strengthCalories: '', cardioHeartRate: '', cardioCalories: '', notes: '', effort: null, pain: false, selectedTemplateId: null };
  const restored = parseWorkoutDraft(serializeWorkoutDraft(draft, Date.parse('2026-11-13T12:01:00Z')), Date.parse('2026-11-13T12:05:00Z'));
  assert.equal(isCardioRunning(restored.exercises[0]), true);
  assert.equal(elapsedCardioSeconds(restored.exercises[0].cardioStartedAt, Date.parse('2026-11-13T12:05:00Z')), 300);
  const screen = readFileSync(new URL('../app/(tabs)/index.tsx', import.meta.url), 'utf8');
  const component = readFileSync(new URL('../components/CardioTimer.tsx', import.meta.url), 'utf8');
  assert.match(screen, /<CardioTimer timing=\{exercise\} onChange=\{onUpdateCardioTiming\}/);
  assert.match(screen, /exercises\.some\(e => e\.kind === 'cardio' && isCardioRunning\(e\)\)[\s\S]*const validExercises/);
  assert.match(screen, /setExercises\(prev => prev\.map\(e => e\.id === exerciseId \? \{ \.\.\.e, \.\.\.patch \} : e\)\)/);
  assert.match(component, /window\.confirm\(message\)/);
  assert.match(component, /AppState\.addEventListener/);
  assert.doesNotMatch(screen, /ACTUAL START · ISO/);
});
