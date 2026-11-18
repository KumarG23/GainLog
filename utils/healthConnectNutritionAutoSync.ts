export interface NutritionAutoSyncResult {
  bootstrapped: boolean;
  written: number;
  deleted: number;
  cursor: number;
}

export declare function hasNutritionAutoSyncAccess(): Promise<boolean>;
export declare function syncIncrementalNutritionToHealthConnect(): Promise<NutritionAutoSyncResult>;
/** Exports pending GainLog meal changes (after a save/delete), asking for permission if needed. */
export declare function exportNutritionChangesToHealthConnect(): Promise<NutritionAutoSyncResult>;
export declare function repairAllNutritionToHealthConnect(): Promise<number>;
