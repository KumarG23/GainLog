import type { NutritionSyncPlan } from './healthConnectNutrition';

// Metro resolves .native.ts on Android and .web.ts in browsers.
export declare function hasNutritionWriteAccess(): Promise<boolean>;
export declare function requestNutritionWriteAccess(): Promise<void>;
export declare function applyNutritionUpsertsToHealthConnect(
  upserts: NutritionSyncPlan['upserts'],
): Promise<void>;
export declare function applyNutritionDeletesToHealthConnect(
  entryIds: string[],
): Promise<void>;
