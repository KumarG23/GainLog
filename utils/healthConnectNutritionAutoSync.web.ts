import type { NutritionAutoSyncResult } from './healthConnectNutritionAutoSync';

export async function hasNutritionAutoSyncAccess(): Promise<boolean> {
  return false;
}

export async function syncIncrementalNutritionToHealthConnect(): Promise<NutritionAutoSyncResult> {
  return { bootstrapped: false, written: 0, deleted: 0, cursor: 0 };
}

export async function repairAllNutritionToHealthConnect(): Promise<number> {
  return 0;
}
