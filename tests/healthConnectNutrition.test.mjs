import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildHealthConnectNutritionRecord,
  buildNutritionSyncPlan,
  healthConnectNutritionClientRecordId,
  nutritionBootstrapSince,
  nutritionClientRecordVersion,
  NUTRITION_SYNC_VERSION_BASE,
} from '../utils/healthConnectNutrition.ts';

test('maps a GainLog meal to a complete Health Connect Nutrition record', () => {
  const record = buildHealthConnectNutritionRecord({
    id: 'meal-123',
    date: '2026-08-21T12:15:00-04:00',
    meal: 'lunch',
    name: 'Chicken rice bowl',
    calories: 640,
    proteinG: 52,
    carbsG: 71,
    fatG: 18,
    fiberG: 9,
  });

  assert.deepEqual(record, {
    recordType: 'Nutrition',
    startTime: '2026-08-21T16:15:00.000Z',
    endTime: '2026-08-21T16:16:00.000Z',
    mealType: 2,
    name: 'Chicken rice bowl',
    energy: { value: 640, unit: 'kilocalories' },
    protein: { value: 52, unit: 'grams' },
    totalCarbohydrate: { value: 71, unit: 'grams' },
    totalFat: { value: 18, unit: 'grams' },
    dietaryFiber: { value: 9, unit: 'grams' },
    metadata: {
      clientRecordId: 'gainlog:nutrition:meal-123',
      clientRecordVersion: 2,
      recordingMethod: 3,
    },
  });
});

test('uses stable client identities and maps every supported meal type', () => {
  assert.equal(healthConnectNutritionClientRecordId('abc'), 'gainlog:nutrition:abc');
  assert.equal(buildHealthConnectNutritionRecord({
    id: 'b', date: '2026-08-21T08:00:00Z', meal: 'breakfast', name: 'B',
    calories: 1, proteinG: 0, carbsG: 0, fatG: 0, fiberG: 0,
  }).mealType, 1);
  assert.equal(buildHealthConnectNutritionRecord({
    id: 'd', date: '2026-08-21T18:00:00Z', meal: 'dinner', name: 'D',
    calories: 1, proteinG: 0, carbsG: 0, fatG: 0, fiberG: 0,
  }).mealType, 3);
  assert.equal(buildHealthConnectNutritionRecord({
    id: 's', date: '2026-08-21T15:00:00Z', meal: 'snack', name: 'S',
    calories: 1, proteinG: 0, carbsG: 0, fatG: 0, fiberG: 0,
  }).mealType, 4);
});

test('accepts a newer client record version for corrected meal data', () => {
  const corrected = buildHealthConnectNutritionRecord({
    id: 'meal-123', date: '2026-08-21T12:15:00-04:00', meal: 'lunch', name: 'Corrected',
    calories: 495, proteinG: 33, carbsG: 3, fatG: 37, fiberG: 0,
  }, 1_700_000_000_123);

  assert.equal(corrected.metadata.clientRecordId, 'gainlog:nutrition:meal-123');
  assert.equal(corrected.metadata.clientRecordVersion, 1_700_000_000_123);
});

test('rejects an invalid nutrition timestamp instead of writing a malformed record', () => {
  assert.throws(() => buildHealthConnectNutritionRecord({
    id: 'bad', date: 'not-a-date', meal: 'snack', name: 'Bad',
    calories: 1, proteinG: 0, carbsG: 0, fatG: 0, fiberG: 0,
  }), /valid timestamp/);
});

test('keeps date-only meals on the intended Eastern calendar day', () => {
  const record = buildHealthConnectNutritionRecord({
    id: 'breakfast-date-only',
    date: '2026-08-21',
    meal: 'breakfast',
    name: 'Breakfast',
    calories: 410,
    proteinG: 42,
    carbsG: 26,
    fatG: 14,
    fiberG: 4,
  });

  assert.equal(record.startTime, '2026-08-21T12:00:00.000Z');
  assert.equal(record.endTime, '2026-08-21T12:01:00.000Z');
});

test('incremental nutrition sync keeps only the newest event for each meal', () => {
  const original = {
    id: 'meal-a', date: '2026-08-26T08:00:00-04:00', meal: 'breakfast', name: 'Original',
    calories: 400, proteinG: 40, carbsG: 30, fatG: 10, fiberG: 5,
  };
  const corrected = { ...original, name: 'Corrected', calories: 432 };
  const other = { ...original, id: 'meal-b', name: 'Other' };

  const plan = buildNutritionSyncPlan([
    { cursor: 1, operation: 'upsert', entryId: original.id, entry: original },
    { cursor: 2, operation: 'upsert', entryId: corrected.id, entry: corrected },
    { cursor: 3, operation: 'delete', entryId: corrected.id, entry: null },
    { cursor: 4, operation: 'upsert', entryId: other.id, entry: other },
  ], 0);

  assert.deepEqual(plan, {
    upserts: [{ entry: other, clientRecordVersion: NUTRITION_SYNC_VERSION_BASE + 4 }],
    deleteEntryIds: ['meal-a'],
    nextCursor: 4,
  });
});

test('incremental nutrition versions supersede legacy epoch-millisecond versions', () => {
  const legacyVersion = Date.parse('2026-08-26T09:15:00-04:00');
  assert.ok(nutritionClientRecordVersion(1) > legacyVersion);
  assert.equal(nutritionClientRecordVersion(42), NUTRITION_SYNC_VERSION_BASE + 42);
});

test('nutrition bootstrap covers only the newest seven calendar days', () => {
  assert.equal(nutritionBootstrapSince('2026-08-26'), '2026-08-20');
});

test('empty incremental pages preserve the current cursor', () => {
  assert.deepEqual(buildNutritionSyncPlan([], 27), {
    upserts: [],
    deleteEntryIds: [],
    nextCursor: 27,
  });
});
