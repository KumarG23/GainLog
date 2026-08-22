export interface HealthConnectSyncResult {
  dailyImported: boolean;
  dailyImports: number;
  bodyMeasurements: number;
}

export interface HealthConnectSyncOptions {
  requestPermissions?: boolean;
  requestBackgroundAccess?: boolean;
  days?: number;
}

// Metro resolves healthConnectSync.native.ts on Android and .web.ts in browsers.
export declare function syncHealthConnect(
  options?: HealthConnectSyncOptions,
): Promise<HealthConnectSyncResult>;
export declare function hasHealthConnectBackgroundAccess(): Promise<boolean>;
