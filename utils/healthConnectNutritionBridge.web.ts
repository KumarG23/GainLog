import type { NutritionSyncPlan } from './healthConnectNutrition';

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
