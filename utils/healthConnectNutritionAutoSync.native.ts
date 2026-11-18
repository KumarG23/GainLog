import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_URL } from '../constants/api';
import { localDateKey } from './date';
import {
  reconcileFullNutritionRepair,
  reconcileIncrementalNutrition,
  type NutritionSyncBootstrap,
  type NutritionSyncFeed,
} from './healthConnectNutrition';
import {
  applyNutritionDeletesToHealthConnect,
  applyNutritionUpsertsToHealthConnect,
  hasNutritionWriteAccess,
  requestNutritionWriteAccess,
} from './healthConnectNutritionBridge';
import type { NutritionAutoSyncResult } from './healthConnectNutritionAutoSync';
import { createSerialTaskRunner } from './healthConnectChangeSync';

const CURSOR_KEY = 'gainlog.healthConnect.nutritionSyncCursor';

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(`${API_URL}${path}`);
  if (!response.ok) {
    throw new Error(`Nutrition sync failed: ${response.status} ${response.statusText}`);
  }
  return response.json() as Promise<T>;
}

async function fetchBootstrap(since: string): Promise<NutritionSyncBootstrap> {
  return fetchJson<NutritionSyncBootstrap>(
    `/nutrition/sync/bootstrap?since=${encodeURIComponent(since)}`,
  );
}

async function fetchPage(cursor: number): Promise<NutritionSyncFeed> {
  return fetchJson<NutritionSyncFeed>(
    `/nutrition/sync?after=${encodeURIComponent(cursor)}&limit=100`,
  );
}

function parseCursor(value: string | null): number | null {
  if (value == null) return null;
  const cursor = Number(value);
  return Number.isSafeInteger(cursor) && cursor >= 0 ? cursor : null;
}

export async function hasNutritionAutoSyncAccess(): Promise<boolean> {
  return hasNutritionWriteAccess();
}

const saveCursor = (cursor: number) => AsyncStorage.setItem(CURSOR_KEY, String(cursor));

// Every Health Connect meal write goes through this one serialized lane. Writes
// always use the server's sync cursor as clientRecordVersion, so a later edit
// always carries a higher version than the copy already in Health Connect.
// (Mixing Date.now() versions with cursor versions made Health Connect silently
// ignore edits.) Serializing also stops two runs from saving cursors out of order.
const runSerialized = createSerialTaskRunner(
  async (task: () => Promise<NutritionAutoSyncResult | number>) => task(),
);

async function runIncremental(): Promise<NutritionAutoSyncResult> {
  if (!await hasNutritionWriteAccess()) {
    throw new Error('GainLog needs Health Connect nutrition write permission.');
  }
  const currentCursor = parseCursor(await AsyncStorage.getItem(CURSOR_KEY));
  return reconcileIncrementalNutrition({
    currentCursor,
    today: localDateKey(),
    fetchBootstrap,
    fetchPage,
    applyUpserts: applyNutritionUpsertsToHealthConnect,
    applyDeletes: applyNutritionDeletesToHealthConnect,
    saveCursor,
  });
}

export async function syncIncrementalNutritionToHealthConnect(): Promise<NutritionAutoSyncResult> {
  return runSerialized(runIncremental) as Promise<NutritionAutoSyncResult>;
}

export async function exportNutritionChangesToHealthConnect(): Promise<NutritionAutoSyncResult> {
  await requestNutritionWriteAccess();
  return syncIncrementalNutritionToHealthConnect();
}

export async function repairAllNutritionToHealthConnect(): Promise<number> {
  return runSerialized(async () => {
    await requestNutritionWriteAccess();
    const currentCursor = parseCursor(await AsyncStorage.getItem(CURSOR_KEY));
    const result = await reconcileFullNutritionRepair({
      currentCursor,
      today: localDateKey(),
      fetchBootstrap,
      fetchPage,
      applyUpserts: applyNutritionUpsertsToHealthConnect,
      applyDeletes: applyNutritionDeletesToHealthConnect,
      saveCursor,
    });
    return result.snapshotWritten;
  }) as Promise<number>;
}
