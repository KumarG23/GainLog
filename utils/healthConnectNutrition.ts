import type { HealthConnectRecord } from 'react-native-health-connect';
import type { NutritionEntry } from '../types/health';

export const NUTRITION_SYNC_VERSION_BASE = 9_000_000_000_000;
const NUTRITION_BOOTSTRAP_DAYS = 7;

export interface NutritionSyncEvent {
  cursor: number;
  operation: 'upsert' | 'delete';
  entryId: string;
  entry?: NutritionEntry | null;
}

export interface NutritionSyncPlan {
  upserts: Array<{ entry: NutritionEntry; clientRecordVersion: number }>;
  deleteEntryIds: string[];
  nextCursor: number;
}

export function nutritionClientRecordVersion(cursor: number): number {
  if (!Number.isSafeInteger(cursor) || cursor < 0) {
    throw new Error('Nutrition sync cursor must be a non-negative safe integer.');
  }
  return NUTRITION_SYNC_VERSION_BASE + cursor;
}

export function nutritionBootstrapSince(today: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) {
    throw new Error('Nutrition bootstrap requires a calendar date.');
  }
  const [year, month, day] = today.split('-').map(Number);
  const since = new Date(Date.UTC(year, month - 1, day - (NUTRITION_BOOTSTRAP_DAYS - 1)));
  return since.toISOString().slice(0, 10);
}

export function buildNutritionSyncPlan(
  events: NutritionSyncEvent[],
  currentCursor: number,
): NutritionSyncPlan {
  const latestByEntry = new Map<string, NutritionSyncEvent>();
  let nextCursor = currentCursor;
  for (const event of events) {
    if (!Number.isSafeInteger(event.cursor) || event.cursor <= currentCursor) {
      throw new Error('Nutrition sync events must advance beyond the current cursor.');
    }
    const existing = latestByEntry.get(event.entryId);
    if (!existing || event.cursor > existing.cursor) latestByEntry.set(event.entryId, event);
    nextCursor = Math.max(nextCursor, event.cursor);
  }

  const finalEvents = [...latestByEntry.values()].sort((a, b) => a.cursor - b.cursor);
  const upserts: NutritionSyncPlan['upserts'] = [];
  const deleteEntryIds: string[] = [];
  for (const event of finalEvents) {
    if (event.operation === 'delete') {
      deleteEntryIds.push(event.entryId);
    } else {
      if (!event.entry) throw new Error('Nutrition upsert event is missing its entry.');
      upserts.push({
        entry: event.entry,
        clientRecordVersion: nutritionClientRecordVersion(event.cursor),
      });
    }
  }
  return { upserts, deleteEntryIds, nextCursor };
}

export interface NutritionSyncBootstrap {
  entries: NutritionEntry[];
  latestCursor: number;
}

export interface NutritionSyncFeed {
  events: NutritionSyncEvent[];
  nextCursor: number;
  latestCursor: number;
  hasMore: boolean;
}

interface ReconcileNutritionDependencies {
  currentCursor: number | null;
  today: string;
  fetchBootstrap: (since: string) => Promise<NutritionSyncBootstrap>;
  fetchPage: (cursor: number) => Promise<NutritionSyncFeed>;
  applyUpserts: (upserts: NutritionSyncPlan['upserts']) => Promise<void>;
  applyDeletes: (entryIds: string[]) => Promise<void>;
  saveCursor: (cursor: number) => Promise<void>;
}

export interface NutritionReconcileResult {
  bootstrapped: boolean;
  written: number;
  deleted: number;
  cursor: number;
}

export async function reconcileIncrementalNutrition({
  currentCursor,
  today,
  fetchBootstrap,
  fetchPage,
  applyUpserts,
  applyDeletes,
  saveCursor,
}: ReconcileNutritionDependencies): Promise<NutritionReconcileResult> {
  let cursor = currentCursor;
  let written = 0;
  let deleted = 0;
  let bootstrapped = false;

  if (cursor == null) {
    const bootstrap = await fetchBootstrap(nutritionBootstrapSince(today));
    const upserts = bootstrap.entries.map(entry => ({
      entry,
      clientRecordVersion: nutritionClientRecordVersion(bootstrap.latestCursor),
    }));
    if (upserts.length > 0) await applyUpserts(upserts);
    await saveCursor(bootstrap.latestCursor);
    cursor = bootstrap.latestCursor;
    written += upserts.length;
    bootstrapped = true;
    return { bootstrapped, written, deleted, cursor };
  }

  for (let pageNumber = 0; pageNumber < 1_000; pageNumber += 1) {
    const feed = await fetchPage(cursor);
    const plan = buildNutritionSyncPlan(feed.events, cursor);
    if (plan.nextCursor !== feed.nextCursor) {
      throw new Error('Nutrition sync feed returned an inconsistent cursor.');
    }
    if (plan.upserts.length > 0) await applyUpserts(plan.upserts);
    if (plan.deleteEntryIds.length > 0) await applyDeletes(plan.deleteEntryIds);
    if (plan.nextCursor !== cursor) {
      await saveCursor(plan.nextCursor);
      cursor = plan.nextCursor;
    }
    written += plan.upserts.length;
    deleted += plan.deleteEntryIds.length;
    if (!feed.hasMore) {
      return { bootstrapped, written, deleted, cursor };
    }
  }

  throw new Error('Nutrition sync exceeded the page safety limit.');
}

export interface NutritionFullRepairResult {
  snapshotWritten: number;
  replayedUpserts: number;
  deleted: number;
  cursor: number;
}

export async function reconcileFullNutritionRepair(
  dependencies: ReconcileNutritionDependencies,
): Promise<NutritionFullRepairResult> {
  const bootstrap = await dependencies.fetchBootstrap('0001-01-01');
  const snapshotUpserts = bootstrap.entries.map(entry => ({
    entry,
    clientRecordVersion: nutritionClientRecordVersion(bootstrap.latestCursor),
  }));
  if (snapshotUpserts.length > 0) {
    await dependencies.applyUpserts(snapshotUpserts);
  }

  const startingCursor = dependencies.currentCursor ?? 0;
  const incremental = await reconcileIncrementalNutrition({
    ...dependencies,
    currentCursor: startingCursor,
  });
  if (incremental.cursor === startingCursor) {
    await dependencies.saveCursor(incremental.cursor);
  }
  return {
    snapshotWritten: snapshotUpserts.length,
    replayedUpserts: incremental.written,
    deleted: incremental.deleted,
    cursor: incremental.cursor,
  };
}

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
