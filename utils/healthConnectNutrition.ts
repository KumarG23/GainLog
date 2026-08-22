import type { HealthConnectRecord } from 'react-native-health-connect';
import type { NutritionEntry } from '../types/health';

const MEAL_TYPES: Record<string, number> = {
  breakfast: 1,
  lunch: 2,
  dinner: 3,
  snack: 4,
};

const DEFAULT_MEAL_HOURS: Record<string, number> = {
  breakfast: 8,
  lunch: 12,
  dinner: 18,
  snack: 15,
};

function nutritionStartTime(date: string, meal: string): Date {
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const [year, month, day] = date.split('-').map(Number);
    return new Date(
      year,
      month - 1,
      day,
      DEFAULT_MEAL_HOURS[meal.toLowerCase()] ?? 12,
      0,
      0,
      0,
    );
  }
  return new Date(date);
}

export function healthConnectNutritionClientRecordId(entryId: string): string {
  return `gainlog:nutrition:${entryId}`;
}

export function buildHealthConnectNutritionRecord(
  entry: NutritionEntry,
  clientRecordVersion = 2,
): Extract<HealthConnectRecord, { recordType: 'Nutrition' }> {
  const start = nutritionStartTime(entry.date, entry.meal);
  if (!Number.isFinite(start.getTime())) {
    throw new Error('Nutrition entry requires a valid timestamp.');
  }
  const end = new Date(start.getTime() + 60_000);

  return {
    recordType: 'Nutrition',
    startTime: start.toISOString(),
    endTime: end.toISOString(),
    mealType: MEAL_TYPES[entry.meal.toLowerCase()] ?? 0,
    name: entry.name,
    energy: { value: entry.calories, unit: 'kilocalories' },
    protein: { value: entry.proteinG, unit: 'grams' },
    totalCarbohydrate: { value: entry.carbsG, unit: 'grams' },
    totalFat: { value: entry.fatG, unit: 'grams' },
    dietaryFiber: { value: entry.fiberG, unit: 'grams' },
    metadata: {
      clientRecordId: healthConnectNutritionClientRecordId(entry.id),
      clientRecordVersion,
      recordingMethod: 3,
    },
  };
}
