import type { NutritionEntry } from '../types/health';
import type { NutritionSyncPlan } from './healthConnectNutrition';
import type { HealthConnectNutritionSyncResult } from './healthConnectNutritionBridge';

export async function hasNutritionWriteAccess(): Promise<boolean> {
  return false;
}

export async function requestNutritionWriteAccess(): Promise<void> {}

export async function applyNutritionUpsertsToHealthConnect(
  _upserts: NutritionSyncPlan['upserts'],
): Promise<void> {}

export async function applyNutritionDeletesToHealthConnect(
  _entryIds: string[],
): Promise<void> {}

export async function writeNutritionEntryToHealthConnect(
  _entry: NutritionEntry,
): Promise<void> {}

export async function deleteNutritionEntryFromHealthConnect(
  _entryId: string,
): Promise<void> {}

export async function syncNutritionEntriesToHealthConnect(
  _entries: NutritionEntry[],
): Promise<HealthConnectNutritionSyncResult> {
  return { written: 0 };
}
