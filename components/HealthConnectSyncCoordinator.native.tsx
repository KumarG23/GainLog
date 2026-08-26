import AsyncStorage from '@react-native-async-storage/async-storage';
import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import { useCallback, useEffect } from 'react';
import { AppState, Platform } from 'react-native';
import { useHealth } from '../context/HealthContext';
import {
  AUTO_SYNC_INTERVAL_MS,
  runIndependentAutoSyncLanes,
  type AutoSyncLaneResult,
} from '../utils/healthConnectAutoSync';
import {
  hasNutritionAutoSyncAccess,
  syncIncrementalNutritionToHealthConnect,
} from '../utils/healthConnectNutritionAutoSync';
import {
  hasHealthConnectBackgroundAccess,
  syncHealthConnect,
} from '../utils/healthConnectSync';

const TASK_NAME = 'gainlog-health-connect-auto-sync';
const HEALTH_SUCCESS_KEY = 'gainlog.healthConnect.lastSuccessfulAutoSync';
const NUTRITION_SUCCESS_KEY = 'gainlog.healthConnect.lastSuccessfulNutritionAutoSync';
const SUCCESS_KEYS: Record<string, string> = {
  health: HEALTH_SUCCESS_KEY,
  nutrition: NUTRITION_SUCCESS_KEY,
};
const BACKGROUND_INTERVAL_MINUTES = AUTO_SYNC_INTERVAL_MS / 60_000;

let activeSync: Promise<AutoSyncLaneResult> | null = null;

async function performAutoSync({
  requestPermissions,
  force = false,
}: {
  requestPermissions: boolean;
  force?: boolean;
}): Promise<AutoSyncLaneResult> {
  if (Platform.OS !== 'android') {
    return { attempted: [], succeeded: [], failed: [] };
  }
  if (activeSync) return activeSync;

  activeSync = (async () => {
    const [hasHealthAccess, hasNutritionAccess] = await Promise.all([
      requestPermissions ? Promise.resolve(true) : hasHealthConnectBackgroundAccess(),
      hasNutritionAutoSyncAccess(),
    ]);
    const laneNames = [
      ...(hasHealthAccess ? ['health'] : []),
      ...(hasNutritionAccess ? ['nutrition'] : []),
    ];
    const lastSuccessValues = await Promise.all(
      laneNames.map(name => AsyncStorage.getItem(SUCCESS_KEYS[name])),
    );
    const lastSuccessByName = new Map(
      laneNames.map((name, index) => {
        const value = lastSuccessValues[index];
        return [name, value == null ? null : Number(value)] as const;
      }),
    );

    return runIndependentAutoSyncLanes({
      nowMs: Date.now(),
      force,
      lanes: [
        ...(hasHealthAccess ? [{
          name: 'health',
          lastSuccessMs: lastSuccessByName.get('health') ?? null,
          run: async () => {
            await syncHealthConnect({
              requestPermissions,
              requestBackgroundAccess: requestPermissions,
              days: 2,
            });
          },
        }] : []),
        ...(hasNutritionAccess ? [{
          name: 'nutrition',
          lastSuccessMs: lastSuccessByName.get('nutrition') ?? null,
          run: async () => { await syncIncrementalNutritionToHealthConnect(); },
        }] : []),
      ],
      saveSuccess: (name, nowMs) => AsyncStorage.setItem(SUCCESS_KEYS[name], String(nowMs)),
    });
  })();

  try {
    return await activeSync;
  } finally {
    activeSync = null;
  }
}

if (Platform.OS === 'android' && !TaskManager.isTaskDefined(TASK_NAME)) {
  TaskManager.defineTask(TASK_NAME, async () => {
    try {
      const result = await performAutoSync({ requestPermissions: false });
      return result.failed.length > 0
        ? BackgroundTask.BackgroundTaskResult.Failed
        : BackgroundTask.BackgroundTaskResult.Success;
    } catch (error) {
      console.warn('Background Health Connect sync failed', error);
      return BackgroundTask.BackgroundTaskResult.Failed;
    }
  });
}

async function registerBackgroundSyncIfAllowed() {
  if (Platform.OS !== 'android') return;
  if (!await TaskManager.isAvailableAsync()) return;
  if (await BackgroundTask.getStatusAsync() !== BackgroundTask.BackgroundTaskStatus.Available) return;
  const [hasHealthAccess, hasNutritionAccess] = await Promise.all([
    hasHealthConnectBackgroundAccess(),
    hasNutritionAutoSyncAccess(),
  ]);
  if (!hasHealthAccess && !hasNutritionAccess) return;
  await BackgroundTask.registerTaskAsync(TASK_NAME, {
    minimumInterval: BACKGROUND_INTERVAL_MINUTES,
  });
}

export function HealthConnectSyncCoordinator() {
  const { refresh } = useHealth();

  const syncWhenActive = useCallback(async () => {
    if (Platform.OS !== 'android') return;
    try {
      const result = await performAutoSync({ requestPermissions: true });
      if (result.succeeded.includes('health')) await refresh();
      if (result.failed.length > 0) {
        console.warn('Automatic Health Connect sync lanes failed', result.failed);
      }
      try {
        await registerBackgroundSyncIfAllowed();
      } catch (error) {
        console.warn('Unable to register background Health Connect sync', error);
      }
    } catch (error) {
      // Manual Sync now remains available on the Health screen as recovery.
      console.warn('Automatic Health Connect sync failed', error);
    }
  }, [refresh]);

  useEffect(() => {
    void syncWhenActive();
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') void syncWhenActive();
    });
    return () => subscription.remove();
  }, [syncWhenActive]);

  return null;
}
