import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  deleteRecordsByUuids,
  getGrantedPermissions,
  initialize,
  insertRecords,
  requestPermission,
} from 'react-native-health-connect';
import { API_URL } from '../constants/api';
import type { WorkoutSession } from '../types/workout';
import { createSerialTaskRunner } from './healthConnectChangeSync';
import {
  buildHealthConnectWorkoutRecord,
  healthConnectWorkoutClientRecordId,
  parseExportedWorkouts,
  planWorkoutExport,
} from './healthConnectWorkouts';
import type { WorkoutExportResult } from './healthConnectWorkoutExport';

const ENABLED_KEY = 'gainlog.healthConnect.workoutExportEnabled';
const STATE_KEY = 'gainlog.healthConnect.exportedWorkouts.v1';
const workoutWritePermission = [
  { accessType: 'write' as const, recordType: 'ExerciseSession' as const },
];

export async function isWorkoutExportEnabled(): Promise<boolean> {
  return (await AsyncStorage.getItem(ENABLED_KEY)) === 'true';
}

export async function hasWorkoutWriteAccess(): Promise<boolean> {
  if (!await initialize()) return false;
  const permissions = await getGrantedPermissions();
  return permissions.some(permission => (
    'accessType' in permission
    && permission.accessType === 'write'
    && 'recordType' in permission
    && permission.recordType === 'ExerciseSession'
  ));
}

export async function setWorkoutExportEnabled(enabled: boolean): Promise<void> {
  if (enabled) {
    if (!await initialize()) throw new Error('Health Connect is unavailable on this device.');
    await requestPermission(workoutWritePermission);
    if (!await hasWorkoutWriteAccess()) {
      throw new Error('GainLog needs Health Connect exercise write permission.');
    }
  }
  await AsyncStorage.setItem(ENABLED_KEY, enabled ? 'true' : 'false');
}

async function fetchWorkouts(): Promise<WorkoutSession[]> {
  const response = await fetch(`${API_URL}/workouts/`);
  if (!response.ok) {
    throw new Error(`Workout sync failed: ${response.status} ${response.statusText}`);
  }
  return response.json() as Promise<WorkoutSession[]>;
}

async function runWorkoutExport(): Promise<WorkoutExportResult> {
  if (!await isWorkoutExportEnabled()) return { written: 0, deleted: 0, skipped: true };
  if (!await hasWorkoutWriteAccess()) {
    throw new Error('GainLog needs Health Connect exercise write permission.');
  }
  const sessions = await fetchWorkouts();
  const exported = parseExportedWorkouts(await AsyncStorage.getItem(STATE_KEY));
  const plan = planWorkoutExport({ sessions, exported, nowMs: Date.now() });

  for (let index = 0; index < plan.upserts.length; index += 50) {
    await insertRecords(plan.upserts.slice(index, index + 50).map(({ session, clientRecordVersion }) => (
      buildHealthConnectWorkoutRecord(session, clientRecordVersion)
    )));
  }
  if (plan.deleteWorkoutIds.length > 0) {
    await deleteRecordsByUuids(
      'ExerciseSession',
      [],
      plan.deleteWorkoutIds.map(healthConnectWorkoutClientRecordId),
    );
  }
  // Saved only after Health Connect accepted every write, so a failed run retries.
  await AsyncStorage.setItem(STATE_KEY, JSON.stringify(plan.nextState));
  return { written: plan.upserts.length, deleted: plan.deleteWorkoutIds.length, skipped: false };
}

const runSerialized = createSerialTaskRunner((_: void) => runWorkoutExport());

export async function syncWorkoutsToHealthConnect(): Promise<WorkoutExportResult> {
  return runSerialized(undefined);
}
