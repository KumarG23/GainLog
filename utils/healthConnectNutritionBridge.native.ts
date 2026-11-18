import {
  deleteRecordsByUuids,
  getGrantedPermissions,
  initialize,
  insertRecords,
  requestPermission,
} from 'react-native-health-connect';
import {
  buildHealthConnectNutritionRecord,
  healthConnectNutritionClientRecordId,
  type NutritionSyncPlan,
} from './healthConnectNutrition';

const nutritionWritePermission = [{ accessType: 'write' as const, recordType: 'Nutrition' as const }];

export async function hasNutritionWriteAccess(): Promise<boolean> {
  if (!await initialize()) return false;
  const permissions = await getGrantedPermissions();
  return permissions.some(permission => (
    'accessType' in permission
    && permission.accessType === 'write'
    && 'recordType' in permission
    && permission.recordType === 'Nutrition'
  ));
}

async function ensureNutritionWriteAccess(requestPermissions = true): Promise<void> {
  if (!await initialize()) {
    throw new Error('Health Connect is unavailable on this device.');
  }
  if (requestPermissions) {
    await requestPermission(nutritionWritePermission);
  }
  if (!await hasNutritionWriteAccess()) {
    throw new Error('GainLog needs Health Connect nutrition write permission.');
  }
}

export async function requestNutritionWriteAccess(): Promise<void> {
  await ensureNutritionWriteAccess(true);
}

export async function applyNutritionUpsertsToHealthConnect(
  upserts: NutritionSyncPlan['upserts'],
): Promise<void> {
  if (upserts.length === 0) return;
  await ensureNutritionWriteAccess(false);
  const batchSize = 100;
  for (let index = 0; index < upserts.length; index += batchSize) {
    await insertRecords(
      upserts.slice(index, index + batchSize).map(({ entry, clientRecordVersion }) => (
        buildHealthConnectNutritionRecord(entry, clientRecordVersion)
      )),
    );
  }
}

export async function applyNutritionDeletesToHealthConnect(
  entryIds: string[],
): Promise<void> {
  if (entryIds.length === 0) return;
  await ensureNutritionWriteAccess(false);
  await deleteRecordsByUuids(
    'Nutrition',
    [],
    entryIds.map(healthConnectNutritionClientRecordId),
  );
}
