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

export async function syncIncrementalNutritionToHealthConnect(): Promise<NutritionAutoSyncResult> {
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
    saveCursor: cursor => AsyncStorage.setItem(CURSOR_KEY, String(cursor)),
  });
}

export async function repairAllNutritionToHealthConnect(): Promise<number> {
  await requestNutritionWriteAccess();
  const currentCursor = parseCursor(await AsyncStorage.getItem(CURSOR_KEY));
  const result = await reconcileFullNutritionRepair({
    currentCursor,
    today: localDateKey(),
    fetchBootstrap,
    fetchPage,
    applyUpserts: applyNutritionUpsertsToHealthConnect,
    applyDeletes: applyNutritionDeletesToHealthConnect,
    saveCursor: cursor => AsyncStorage.setItem(CURSOR_KEY, String(cursor)),
  });
  return result.snapshotWritten;
}
