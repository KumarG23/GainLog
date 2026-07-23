import type { NutritionEntry } from '../types/health';

export interface QuickAddFood {
  meal: string;
  name: string;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  notes?: string;
  lastLoggedAt: string;
  timesLogged: number;
}

export interface DailyMacroSummary {
  date: string;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  entryCount: number;
}

function normalizedKey(entry: NutritionEntry): string {
  const meal = entry.meal.trim().toLowerCase();
  const name = entry.name.trim().replace(/\s+/g, ' ').toLowerCase();
  return `${meal}:${name}`;
}

function timestampValue(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function buildQuickAddFoods(
  entries: NutritionEntry[],
  limit = 6,
): QuickAddFood[] {
  const remembered = new Map<string, QuickAddFood>();

  for (const entry of entries) {
    const key = normalizedKey(entry);
    const existing = remembered.get(key);
    const isNewer =
      !existing || timestampValue(entry.date) > timestampValue(existing.lastLoggedAt);

    remembered.set(key, {
      meal: isNewer ? entry.meal.trim().toLowerCase() : existing.meal,
      name: isNewer ? entry.name.trim().replace(/\s+/g, ' ') : existing.name,
      calories: isNewer ? entry.calories : existing.calories,
      proteinG: isNewer ? entry.proteinG : existing.proteinG,
      carbsG: isNewer ? entry.carbsG : existing.carbsG,
      fatG: isNewer ? entry.fatG : existing.fatG,
      notes: isNewer ? entry.notes : existing.notes,
      lastLoggedAt: isNewer ? entry.date : existing.lastLoggedAt,
      timesLogged: (existing?.timesLogged ?? 0) + 1,
    });
  }

  return Array.from(remembered.values())
    .filter(food => food.timesLogged >= 2)
    .sort(
      (a, b) =>
        b.timesLogged - a.timesLogged ||
        timestampValue(b.lastLoggedAt) - timestampValue(a.lastLoggedAt),
    )
    .slice(0, Math.max(0, limit));
}

function shiftDateKey(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split('-').map(Number);
  const date = new Date(year, month - 1, day, 12);
  date.setDate(date.getDate() + days);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function buildDailyMacroHistory(
  entries: NutritionEntry[],
  endDate: string,
  days = 7,
): DailyMacroSummary[] {
  const totals = new Map<string, DailyMacroSummary>();

  for (const entry of entries) {
    const date = entry.date.slice(0, 10);
    const summary = totals.get(date) ?? {
      date,
      calories: 0,
      proteinG: 0,
      carbsG: 0,
      fatG: 0,
      entryCount: 0,
    };
    summary.calories += entry.calories;
    summary.proteinG += entry.proteinG;
    summary.carbsG += entry.carbsG;
    summary.fatG += entry.fatG;
    summary.entryCount += 1;
    totals.set(date, summary);
  }

  return Array.from({ length: Math.max(0, days) }, (_, index) => {
    const date = shiftDateKey(endDate, -index);
    return totals.get(date) ?? {
      date,
      calories: 0,
      proteinG: 0,
      carbsG: 0,
      fatG: 0,
      entryCount: 0,
    };
  });
}
