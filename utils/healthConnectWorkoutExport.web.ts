import type { WorkoutExportResult } from './healthConnectWorkoutExport';

export async function isWorkoutExportEnabled(): Promise<boolean> {
  return false;
}

export async function hasWorkoutWriteAccess(): Promise<boolean> {
  return false;
}

export async function setWorkoutExportEnabled(_enabled: boolean): Promise<void> {}

export async function syncWorkoutsToHealthConnect(): Promise<WorkoutExportResult> {
  return { written: 0, deleted: 0, skipped: true };
}
