export interface WorkoutExportResult {
  written: number;
  deleted: number;
  /** True when the user has not turned workout export on. */
  skipped: boolean;
}

// Metro resolves .native.ts on Android and .web.ts in browsers.
export declare function isWorkoutExportEnabled(): Promise<boolean>;
export declare function hasWorkoutWriteAccess(): Promise<boolean>;
export declare function setWorkoutExportEnabled(enabled: boolean): Promise<void>;
export declare function syncWorkoutsToHealthConnect(): Promise<WorkoutExportResult>;
