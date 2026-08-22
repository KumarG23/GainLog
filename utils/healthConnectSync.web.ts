import type {
  HealthConnectSyncOptions,
  HealthConnectSyncResult,
} from './healthConnectSync';

export async function syncHealthConnect(
  _options: HealthConnectSyncOptions = {},
): Promise<HealthConnectSyncResult> {
  throw new Error('Health Connect sync is available only in the Android GainLog app.');
}

export async function hasHealthConnectBackgroundAccess(): Promise<boolean> {
  return false;
}
