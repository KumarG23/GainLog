import type { NutritionEntry } from '../types/health';
import type { NutritionSyncPlan } from './healthConnectNutrition';

export interface HealthConnectNutritionSyncResult {
  written: number;
}

// Metro resolves .native.ts on Android and .web.ts in browsers.
export declare function hasNutritionWriteAccess(): Promise<boolean>;
export declare function requestNutritionWriteAccess(): Promise<void>;
export declare function applyNutritionUpsertsToHealthConnect(
  upserts: NutritionSyncPlan['upserts'],
): Promise<void>;
export declare function applyNutritionDeletesToHealthConnect(
  entryIds: string[],
): Promise<void>;
export declare function writeNutritionEntryToHealthConnect(
  entry: NutritionEntry,
): Promise<void>;
export declare function deleteNutritionEntryFromHealthConnect(
  entryId: string,
): Promise<void>;
export declare function syncNutritionEntriesToHealthConnect(
  entries: NutritionEntry[],
): Promise<HealthConnectNutritionSyncResult>;
