import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  WORKOUT_DRAFT_MAX_AGE_MS,
  draftHasContent,
  parseWorkoutDraft,
  serializeWorkoutDraft,
} from '../utils/workoutDraftCodec.ts';

const fields = {
  exercises: [{ id: 'e1', name: 'Chest Press', kind: 'strength', sets: [{ id: 's1', weight: '90', reps: '10' }] }],
  strengthDuration: '45', strengthHeartRate: '', strengthCalories: '', cardioHeartRate: '', cardioCalories: '',
  notes: 'felt good', effort: 'right', pain: false, selectedTemplateId: 'push',
};

test('draft round-trips exactly, including typed set values', () => {
  const now = 1_000_000_000;
  const parsed = parseWorkoutDraft(serializeWorkoutDraft(fields, now), now + 60_000);
  assert.deepEqual({ ...parsed, version: undefined, savedAt: undefined }, { ...fields, version: undefined, savedAt: undefined });
});

test('stale, future, corrupt, wrong-version and empty drafts are rejected', () => {
  const now = 1_000_000_000;
  const raw = serializeWorkoutDraft(fields, now);
  assert.equal(parseWorkoutDraft(raw, now + WORKOUT_DRAFT_MAX_AGE_MS + 1), null);
  assert.equal(parseWorkoutDraft(raw, now - 10 * 60_000), null);
  assert.equal(parseWorkoutDraft('{nope', now), null);
  assert.equal(parseWorkoutDraft(null, now), null);
  assert.equal(parseWorkoutDraft(JSON.stringify({ ...JSON.parse(raw), version: 2 }), now), null);
  const empty = serializeWorkoutDraft({ ...fields, exercises: [], notes: ' ' }, now);
  assert.equal(parseWorkoutDraft(empty, now), null);
  assert.equal(draftHasContent({ ...fields, exercises: [], notes: ' ' }), false);
});

test('Log screen restores before persisting, and clears on save and reset', () => {
  const log = readFileSync(new URL('../app/(tabs)/index.tsx', import.meta.url), 'utf8');
  assert.match(log, /loadWorkoutDraft<DraftExercise>\(\)[\s\S]*setDraftHydrated\(true\)/);
  assert.match(log, /if \(!draftHydrated \|\| saved\) return undefined/);
  assert.match(log, /setSaved\(true\);\s*clearWorkoutDraft\(\)/);
  assert.match(log, /celebratedRecordKeys\.current\.clear\(\);\s*clearWorkoutDraft\(\)/);
});
