import AsyncStorage from '@react-native-async-storage/async-storage';
import { parseAutoSyncFailure, type AutoSyncFailure } from './healthConnectAutoSync';

export type AutoSyncLaneName = 'health' | 'nutrition' | 'workouts';

export const AUTO_SYNC_LANE_LABELS: Record<AutoSyncLaneName, string> = {
  health: 'Health data import',
  nutrition: 'Meals to Health Connect',
  workouts: 'Workouts to Health Connect',
};

// Success keys predate this module; keep them so existing throttling state survives updates.
export const AUTO_SYNC_SUCCESS_KEYS: Record<AutoSyncLaneName, string> = {
  health: 'gainlog.healthConnect.lastSuccessfulAutoSync',
  nutrition: 'gainlog.healthConnect.lastSuccessfulNutritionAutoSync',
  workouts: 'gainlog.healthConnect.lastSuccessfulWorkoutAutoSync',
};

const FAILURE_KEY_PREFIX = 'gainlog.healthConnect.lastAutoSyncFailure.';

export function autoSyncFailureKey(lane: AutoSyncLaneName): string {
  return `${FAILURE_KEY_PREFIX}${lane}`;
}

export interface AutoSyncLaneStatus {
  lane: AutoSyncLaneName;
  label: string;
  lastSuccessMs: number | null;
  /** Only set when the most recent attempt failed (cleared by the next success). */
  lastFailure: AutoSyncFailure | null;
}

function parseMs(value: string | null): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function saveAutoSyncSuccess(lane: AutoSyncLaneName, nowMs: number): Promise<void> {
  await AsyncStorage.multiSet([[AUTO_SYNC_SUCCESS_KEYS[lane], String(nowMs)]]);
  await AsyncStorage.removeItem(autoSyncFailureKey(lane));
}

export async function saveAutoSyncFailure(
  lane: AutoSyncLaneName,
  failure: AutoSyncFailure,
): Promise<void> {
  await AsyncStorage.setItem(autoSyncFailureKey(lane), JSON.stringify(failure));
}

export async function readAutoSyncLastSuccess(lane: AutoSyncLaneName): Promise<number | null> {
  return parseMs(await AsyncStorage.getItem(AUTO_SYNC_SUCCESS_KEYS[lane]));
}

export async function readAutoSyncStatuses(): Promise<AutoSyncLaneStatus[]> {
  const lanes = Object.keys(AUTO_SYNC_LANE_LABELS) as AutoSyncLaneName[];
  return Promise.all(lanes.map(async lane => {
    const [success, failure] = await Promise.all([
      AsyncStorage.getItem(AUTO_SYNC_SUCCESS_KEYS[lane]),
      AsyncStorage.getItem(autoSyncFailureKey(lane)),
    ]);
    return {
      lane,
      label: AUTO_SYNC_LANE_LABELS[lane],
      lastSuccessMs: parseMs(success),
      lastFailure: parseAutoSyncFailure(failure),
    };
  }));
}
