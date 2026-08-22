import type { NutritionEntry } from '../types/health';

export interface HealthConnectNutritionSyncResult {
  written: number;
}

// Metro resolves .native.ts on Android and .web.ts in browsers.
export declare function writeNutritionEntryToHealthConnect(
  entry: NutritionEntry,
): Promise<void>;
export declare function deleteNutritionEntryFromHealthConnect(
  entryId: string,
): Promise<void>;
export declare function syncNutritionEntriesToHealthConnect(
  entries: NutritionEntry[],
): Promise<HealthConnectNutritionSyncResult>;
