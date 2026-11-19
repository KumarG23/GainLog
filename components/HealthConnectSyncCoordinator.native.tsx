import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import { useCallback, useEffect, useRef } from 'react';
import { AppState, Platform } from 'react-native';
import { useHealth } from '../context/HealthContext';
import {
  AUTO_SYNC_INTERVAL_MS,
  autoSyncRetryDelayMs,
  createForceAwareTaskRunner,
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
import {
  readAutoSyncLastSuccess,
  saveAutoSyncFailure,
  saveAutoSyncSuccess,
  type AutoSyncLaneName,
} from '../utils/healthConnectSyncStatus';
import { hasBloodPressureReadAccess, syncRecentBloodPressure } from '../utils/longevityHealthConnect';
import {
  hasWorkoutWriteAccess,
  isWorkoutExportEnabled,
  syncWorkoutsToHealthConnect,
} from '../utils/healthConnectWorkoutExport';

const TASK_NAME = 'gainlog-health-connect-auto-sync';

async function hasWorkoutAutoSyncAccess(): Promise<boolean> {
  return await isWorkoutExportEnabled() && await hasWorkoutWriteAccess();
}

const BACKGROUND_INTERVAL_MINUTES = AUTO_SYNC_INTERVAL_MS / 60_000;

async function performAutoSyncUnsafe({
  requestPermissions,
  force = false,
}: {
  requestPermissions: boolean;
  force?: boolean;
}): Promise<AutoSyncLaneResult> {
  if (Platform.OS !== 'android') {
    return { attempted: [], succeeded: [], failed: [] };
  }

  const [hasHealthAccess, hasNutritionAccess, hasWorkoutAccess, hasBpAccess] = await Promise.all([
    requestPermissions ? Promise.resolve(true) : hasHealthConnectBackgroundAccess(),
    hasNutritionAutoSyncAccess(),
    hasWorkoutAutoSyncAccess(),
    hasBloodPressureReadAccess(),
  ]);
  const laneRunners: { name: AutoSyncLaneName; run: () => Promise<void> }[] = [
    ...(hasHealthAccess ? [{
      name: 'health' as const,
      run: async () => {
        await syncHealthConnect({
          requestPermissions,
          requestBackgroundAccess: requestPermissions,
          repairIfRequired: requestPermissions,
          days: 2,
        });
      },
    }] : []),
    ...(hasNutritionAccess ? [{
      name: 'nutrition' as const,
      run: async () => { await syncIncrementalNutritionToHealthConnect(); },
    }] : []),
    ...(hasWorkoutAccess ? [{
      name: 'workouts' as const,
      run: async () => { await syncWorkoutsToHealthConnect(); },
    }] : []),
    ...(hasBpAccess ? [{
      name: 'bloodPressure' as const,
      run: async () => { await syncRecentBloodPressure(); },
    }] : []),
  ];
  const lastSuccessValues = await Promise.all(
    laneRunners.map(lane => readAutoSyncLastSuccess(lane.name)),
  );

  return runIndependentAutoSyncLanes({
    nowMs: Date.now(),
    force,
    lanes: laneRunners.map((lane, index) => ({
      name: lane.name,
      lastSuccessMs: lastSuccessValues[index],
      run: lane.run,
    })),
    saveSuccess: (name, nowMs) => saveAutoSyncSuccess(name as AutoSyncLaneName, nowMs),
    saveFailure: (name, failure) => saveAutoSyncFailure(name as AutoSyncLaneName, failure),
  });
}

const performAutoSync = createForceAwareTaskRunner(performAutoSyncUnsafe);

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
  const [hasHealthAccess, hasNutritionAccess, hasWorkoutAccess, hasBpAccess] = await Promise.all([
    hasHealthConnectBackgroundAccess(),
    hasNutritionAutoSyncAccess(),
    hasWorkoutAutoSyncAccess(),
    hasBloodPressureReadAccess(),
  ]);
  if (!hasHealthAccess && !hasNutritionAccess && !hasWorkoutAccess && !hasBpAccess) return;
  await BackgroundTask.registerTaskAsync(TASK_NAME, {
    minimumInterval: BACKGROUND_INTERVAL_MINUTES,
  });
}

export function HealthConnectSyncCoordinator() {
  const { refresh } = useHealth();
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryAttempt = useRef(0);

  const clearRetry = useCallback(() => {
    if (retryTimer.current) clearTimeout(retryTimer.current);
    retryTimer.current = null;
  }, []);

  const syncWhenActive = useCallback(async (isRetry = false) => {
    if (Platform.OS !== 'android') return;
    clearRetry();
    if (!isRetry) retryAttempt.current = 0;
    try {
      const result = await performAutoSync({ requestPermissions: !isRetry, force: true });
      if (result.succeeded.includes('health')) await refresh();
      if (result.failed.length > 0) {
        console.warn('Automatic Health Connect sync lanes failed', result.errors ?? result.failed);
        // Usually Tailscale is still reconnecting after the phone wakes. Retry a few
        // times while the app stays open instead of waiting for the next hourly run.
        const delay = autoSyncRetryDelayMs(retryAttempt.current);
        if (delay != null && AppState.currentState === 'active') {
          retryAttempt.current += 1;
          retryTimer.current = setTimeout(() => { void syncWhenActive(true); }, delay);
        }
      } else {
        retryAttempt.current = 0;
      }
      try {
        await registerBackgroundSyncIfAllowed();
      } catch (error) {
        console.warn('Unable to register background Health Connect sync', error);
      }
    } catch (error) {
      // Settings shows per-lane status and keeps explicit sync and repair actions as recovery.
      console.warn('Automatic Health Connect sync failed', error);
    }
  }, [clearRetry, refresh]);

  useEffect(() => {
    void syncWhenActive();
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') void syncWhenActive();
      else clearRetry();
    });
    return () => {
      subscription.remove();
      clearRetry();
    };
  }, [clearRetry, syncWhenActive]);

  return null;
}
