import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildHealthConnectNutritionRecord,
  healthConnectNutritionClientRecordId,
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
