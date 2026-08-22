import type { NutritionEntry } from '../types/health';
import type { HealthConnectNutritionSyncResult } from './healthConnectNutritionBridge';

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
