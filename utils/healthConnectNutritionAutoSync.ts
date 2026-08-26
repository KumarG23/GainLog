export interface NutritionAutoSyncResult {
  bootstrapped: boolean;
  written: number;
  deleted: number;
  cursor: number;
}

export declare function hasNutritionAutoSyncAccess(): Promise<boolean>;
export declare function syncIncrementalNutritionToHealthConnect(): Promise<NutritionAutoSyncResult>;
export declare function repairAllNutritionToHealthConnect(): Promise<number>;
