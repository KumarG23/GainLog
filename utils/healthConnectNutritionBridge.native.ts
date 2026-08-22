import {
  deleteRecordsByUuids,
  initialize,
  insertRecords,
  requestPermission,
} from 'react-native-health-connect';
import type { NutritionEntry } from '../types/health';
import {
  buildHealthConnectNutritionRecord,
  healthConnectNutritionClientRecordId,
} from './healthConnectNutrition';
import type { HealthConnectNutritionSyncResult } from './healthConnectNutritionBridge';

const nutritionWritePermission = [{ accessType: 'write' as const, recordType: 'Nutrition' as const }];

async function ensureNutritionWriteAccess(): Promise<void> {
  if (!await initialize()) {
    throw new Error('Health Connect is unavailable on this device.');
  }
  await requestPermission(nutritionWritePermission);
}

export async function writeNutritionEntryToHealthConnect(
  entry: NutritionEntry,
): Promise<void> {
  await ensureNutritionWriteAccess();
  await insertRecords([buildHealthConnectNutritionRecord(entry, Date.now())]);
}

export async function deleteNutritionEntryFromHealthConnect(
  entryId: string,
): Promise<void> {
  await ensureNutritionWriteAccess();
  await deleteRecordsByUuids(
    'Nutrition',
    [],
    [healthConnectNutritionClientRecordId(entryId)],
  );
}

export async function syncNutritionEntriesToHealthConnect(
  entries: NutritionEntry[],
): Promise<HealthConnectNutritionSyncResult> {
  await ensureNutritionWriteAccess();
  const batchSize = 100;
  const syncVersion = Date.now();
  for (let index = 0; index < entries.length; index += batchSize) {
    await insertRecords(
      entries
        .slice(index, index + batchSize)
        .map((entry, batchIndex) => buildHealthConnectNutritionRecord(
          entry,
          syncVersion + index + batchIndex,
        )),
    );
  }
  return { written: entries.length };
}
