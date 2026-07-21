export type TrackedMeal = 'breakfast' | 'lunch' | 'dinner';

export interface MealReminderPlanItem {
  key: string;
  meal: TrackedMeal;
  trigger: Date;
  title: string;
  body: string;
}

interface NutritionMealRecord {
  date: string;
  meal: string;
}

interface BuildMealReminderPlanOptions {
  now: Date;
  days: number;
  loggedMealKeys: Set<string>;
}

const MEAL_SCHEDULE: Array<{
  meal: TrackedMeal;
  hour: number;
  minute: number;
}> = [
  { meal: 'breakfast', hour: 9, minute: 30 },
  { meal: 'lunch', hour: 13, minute: 30 },
  { meal: 'dinner', hour: 19, minute: 30 },
];

const TRACKED_MEALS = new Set<TrackedMeal>(['breakfast', 'lunch', 'dinner']);

function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function buildLoggedMealKeys(entries: NutritionMealRecord[]): Set<string> {
  const keys = new Set<string>();
  for (const entry of entries) {
    const meal = entry.meal.trim().toLowerCase() as TrackedMeal;
    if (!TRACKED_MEALS.has(meal)) continue;
    keys.add(`${entry.date.slice(0, 10)}:${meal}`);
  }
  return keys;
}

export function buildTestMealReminder(now: Date, delaySeconds = 5) {
  return {
    trigger: new Date(now.getTime() + delaySeconds * 1_000),
    title: 'GainLog test reminder',
    body: 'Meal notifications are working. Log it, feed Luna, profit.',
  };
}

export function buildMealReminderPlan({
  now,
  days,
  loggedMealKeys,
}: BuildMealReminderPlanOptions): MealReminderPlanItem[] {
  const plan: MealReminderPlanItem[] = [];
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);

  for (let offset = 0; offset < days; offset += 1) {
    const date = new Date(start);
    date.setDate(start.getDate() + offset);
    const dateKey = localDateKey(date);

    for (const schedule of MEAL_SCHEDULE) {
      const trigger = new Date(date);
      trigger.setHours(schedule.hour, schedule.minute, 0, 0);
      const key = `${dateKey}:${schedule.meal}`;
      if (trigger <= now || loggedMealKeys.has(key)) continue;

      plan.push({
        key,
        meal: schedule.meal,
        trigger,
        title: `Log ${schedule.meal} in GainLog`,
        body: `A quick ${schedule.meal} log gives Luna the full picture tonight.`,
      });
    }
  }

  return plan;
}
