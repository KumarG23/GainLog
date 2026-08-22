import AsyncStorage from '@react-native-async-storage/async-storage';
import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import { useCallback, useEffect } from 'react';
import { AppState, Platform } from 'react-native';
import { useHealth } from '../context/HealthContext';
import {
  AUTO_SYNC_INTERVAL_MS,
  shouldAttemptHealthConnectAutoSync,
} from '../utils/healthConnectAutoSync';
import {
  hasHealthConnectBackgroundAccess,
  syncHealthConnect,
} from '../utils/healthConnectSync';

const TASK_NAME = 'gainlog-health-connect-auto-sync';
const LAST_SUCCESS_KEY = 'gainlog.healthConnect.lastSuccessfulAutoSync';
const BACKGROUND_INTERVAL_MINUTES = AUTO_SYNC_INTERVAL_MS / 60_000;

let activeSync: Promise<boolean> | null = null;

async function performAutoSync({
  requestPermissions,
  force = false,
}: {
  requestPermissions: boolean;
  force?: boolean;
}): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  if (activeSync) return activeSync;

  activeSync = (async () => {
    const lastSuccessValue = await AsyncStorage.getItem(LAST_SUCCESS_KEY);
    const lastSuccessMs = lastSuccessValue == null ? null : Number(lastSuccessValue);
    if (!force && !shouldAttemptHealthConnectAutoSync({
      nowMs: Date.now(),
      lastSuccessMs,
    })) return false;

    await syncHealthConnect({
      requestPermissions,
      requestBackgroundAccess: requestPermissions,
      days: 2,
    });
    await AsyncStorage.setItem(LAST_SUCCESS_KEY, String(Date.now()));
    return true;
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
      if (!await hasHealthConnectBackgroundAccess()) {
        return BackgroundTask.BackgroundTaskResult.Success;
      }
      await performAutoSync({ requestPermissions: false });
      return BackgroundTask.BackgroundTaskResult.Success;
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
  if (!await hasHealthConnectBackgroundAccess()) return;
  await BackgroundTask.registerTaskAsync(TASK_NAME, {
    minimumInterval: BACKGROUND_INTERVAL_MINUTES,
  });
}

export function HealthConnectSyncCoordinator() {
  const { refresh } = useHealth();

  const syncWhenActive = useCallback(async () => {
    if (Platform.OS !== 'android') return;
    try {
      const synced = await performAutoSync({ requestPermissions: true });
      if (synced) await refresh();
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
