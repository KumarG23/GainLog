import type { HealthConnectRecord } from 'react-native-health-connect';
import type { Exercise, WorkoutSession, WorkoutTemplateId } from '../types/workout';

// Values from react-native-health-connect's ExerciseType constants. Duplicated here so this
// module stays pure (no native imports) and testable under plain Node.
export const HC_EXERCISE_TYPE = {
  OTHER_WORKOUT: 0,
  BIKING_STATIONARY: 9,
  ELLIPTICAL: 25,
  ROWING_MACHINE: 54,
  RUNNING_TREADMILL: 57,
  STAIR_CLIMBING_MACHINE: 69,
  STRENGTH_TRAINING: 70,
  WALKING: 79,
} as const;

const RECORDING_METHOD_MANUAL_ENTRY = 3;
/** Only recent workouts are reconciled each run; older exports are left alone. */
export const WORKOUT_EXPORT_WINDOW_DAYS = 14;
const TREADMILL_RUN_MPH = 4.5;

const TEMPLATE_TITLES: Record<WorkoutTemplateId, string> = {
  push: 'Push',
  pull: 'Pull',
  legs: 'Legs',
  upper: 'Upper',
  recovery: 'Recovery',
};

export function healthConnectWorkoutClientRecordId(workoutId: string): string {
  return `gainlog:workout:${workoutId}`;
}

function isCardio(exercise: Exercise): boolean {
  return exercise.kind === 'cardio';
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
}

function formatStrengthSets(exercise: Exercise): string {
  const sets = exercise.sets.map(set => {
    if (set.measure === 'seconds') {
      const seconds = set.seconds ?? 0;
      return set.weight > 0 ? `${formatNumber(set.weight)} lb × ${seconds}s` : `${seconds}s`;
    }
    return set.weight > 0 ? `${formatNumber(set.weight)}×${set.reps}` : `${set.reps} reps`;
  });
  const allWeighted = exercise.sets.length > 0
    && exercise.sets.every(set => set.measure !== 'seconds' && set.weight > 0);
  return `${sets.join(', ')}${allWeighted ? ' lb' : ''}`;
}

function formatCardio(exercise: Exercise): string {
  const parts: string[] = [];
  if (exercise.cardioDurationMinutes) parts.push(`${exercise.cardioDurationMinutes} min`);
  if (exercise.distanceMiles) parts.push(`${formatNumber(exercise.distanceMiles)} mi`);
  if (exercise.inclinePercent != null) parts.push(`${formatNumber(exercise.inclinePercent)}% incline`);
  if (exercise.resistanceLevel != null) parts.push(`level ${formatNumber(exercise.resistanceLevel)}`);
  return parts.join(', ');
}

/** Human-readable set-by-set notes; Health Connect has no per-set weight field. */
export function buildWorkoutNotes(session: WorkoutSession): string {
  const lines = session.exercises.map(exercise => {
    const detail = isCardio(exercise) ? formatCardio(exercise) : formatStrengthSets(exercise);
    return detail ? `${exercise.name}: ${detail}` : exercise.name;
  });
  const summary: string[] = [];
  if (session.avgHeartRate) summary.push(`avg HR ${session.avgHeartRate}`);
  if (session.effort) summary.push(`effort ${session.effort}`);
  if (summary.length > 0) lines.push(summary.join(' · '));
  const note = session.notes?.trim();
  if (note) lines.push(`Notes: ${note}`);
  return lines.join('\n');
}

export function workoutTitle(session: WorkoutSession): string {
  const template = session.templateId ? TEMPLATE_TITLES[session.templateId] : null;
  return template ? `GainLog · ${template}` : 'GainLog workout';
}

export function workoutExerciseType(session: WorkoutSession): number {
  if (session.exercises.some(exercise => !isCardio(exercise))) {
    return HC_EXERCISE_TYPE.STRENGTH_TRAINING;
  }
  const cardio = session.exercises.filter(isCardio);
  const name = cardio.map(exercise => exercise.name.toLowerCase()).join(' ');
  if (name.includes('treadmill')) {
    const minutes = cardio.reduce((sum, exercise) => sum + (exercise.cardioDurationMinutes ?? 0), 0);
    const miles = cardio.reduce((sum, exercise) => sum + (exercise.distanceMiles ?? 0), 0);
    const mph = minutes > 0 ? miles / (minutes / 60) : 0;
    return mph >= TREADMILL_RUN_MPH ? HC_EXERCISE_TYPE.RUNNING_TREADMILL : HC_EXERCISE_TYPE.WALKING;
  }
  if (name.includes('elliptical')) return HC_EXERCISE_TYPE.ELLIPTICAL;
  if (name.includes('bike') || name.includes('cycle')) return HC_EXERCISE_TYPE.BIKING_STATIONARY;
  if (name.includes('row')) return HC_EXERCISE_TYPE.ROWING_MACHINE;
  if (name.includes('stair')) return HC_EXERCISE_TYPE.STAIR_CLIMBING_MACHINE;
  if (name.includes('walk')) return HC_EXERCISE_TYPE.WALKING;
  return HC_EXERCISE_TYPE.OTHER_WORKOUT;
}

/**
 * GainLog stamps a workout when it is saved, after the last exercise, so the saved
 * time is treated as the end. Recorded cardio timer windows widen the interval.
 */
export function workoutInterval(session: WorkoutSession): { start: Date; end: Date } {
  const saved = new Date(session.date);
  if (!Number.isFinite(saved.getTime())) {
    throw new Error('Workout requires a valid timestamp.');
  }
  const minutes = Math.max(1, Math.round(session.durationMinutes || 0));
  let start = new Date(saved.getTime() - minutes * 60_000);
  let end = saved;
  for (const exercise of session.exercises) {
    const cardioStart = exercise.cardioStartedAt ? new Date(exercise.cardioStartedAt) : null;
    const cardioEnd = exercise.cardioEndedAt ? new Date(exercise.cardioEndedAt) : null;
    if (cardioStart && Number.isFinite(cardioStart.getTime()) && cardioStart < start) start = cardioStart;
    if (cardioEnd && Number.isFinite(cardioEnd.getTime()) && cardioEnd > end) end = cardioEnd;
  }
  return { start, end };
}

export function buildHealthConnectWorkoutRecord(
  session: WorkoutSession,
  clientRecordVersion: number,
): Extract<HealthConnectRecord, { recordType: 'ExerciseSession' }> {
  const { start, end } = workoutInterval(session);
  return {
    recordType: 'ExerciseSession',
    startTime: start.toISOString(),
    endTime: end.toISOString(),
    exerciseType: workoutExerciseType(session),
    title: workoutTitle(session),
    notes: buildWorkoutNotes(session),
    metadata: {
      clientRecordId: healthConnectWorkoutClientRecordId(session.id),
      clientRecordVersion,
      recordingMethod: RECORDING_METHOD_MANUAL_ENTRY,
    },
  } as Extract<HealthConnectRecord, { recordType: 'ExerciseSession' }>;
}

/** Stable 32-bit FNV-1a hash of everything that ends up in the Health Connect record. */
export function workoutFingerprint(session: WorkoutSession): string {
  const { start, end } = workoutInterval(session);
  const source = JSON.stringify([
    start.toISOString(),
    end.toISOString(),
    workoutExerciseType(session),
    workoutTitle(session),
    buildWorkoutNotes(session),
  ]);
  let hash = 0x811c9dc5;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

export interface ExportedWorkoutState {
  fingerprint: string;
  version: number;
  date: string;
}

export type ExportedWorkouts = Record<string, ExportedWorkoutState>;

export interface WorkoutExportPlan {
  upserts: Array<{ session: WorkoutSession; clientRecordVersion: number }>;
  deleteWorkoutIds: string[];
  nextState: ExportedWorkouts;
}

export function parseExportedWorkouts(raw: string | null): ExportedWorkouts {
  if (raw == null) return {};
  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const state: ExportedWorkouts = {};
    for (const [id, entry] of Object.entries(value as Record<string, unknown>)) {
      const candidate = entry as Partial<ExportedWorkoutState> | null;
      if (
        candidate
        && typeof candidate.fingerprint === 'string'
        && typeof candidate.version === 'number'
        && Number.isFinite(candidate.version)
        && typeof candidate.date === 'string'
      ) {
        state[id] = { fingerprint: candidate.fingerprint, version: candidate.version, date: candidate.date };
      }
    }
    return state;
  } catch {
    return {};
  }
}

/**
 * Decides which recent workouts to (re)write and which earlier exports to remove.
 * Versions only ever increase per workout, so Health Connect always accepts an edit.
 */
export function planWorkoutExport({
  sessions,
  exported,
  nowMs,
  windowDays = WORKOUT_EXPORT_WINDOW_DAYS,
}: {
  sessions: WorkoutSession[];
  exported: ExportedWorkouts;
  nowMs: number;
  windowDays?: number;
}): WorkoutExportPlan {
  const cutoffMs = nowMs - windowDays * 24 * 60 * 60_000;
  const inWindow = (date: string) => {
    const time = Date.parse(date);
    return Number.isFinite(time) && time >= cutoffMs;
  };
  const nextState: ExportedWorkouts = {};
  const upserts: WorkoutExportPlan['upserts'] = [];
  const seen = new Set<string>();

  for (const session of sessions) {
    if (!inWindow(session.date) || session.exercises.length === 0) continue;
    seen.add(session.id);
    const fingerprint = workoutFingerprint(session);
    const previous = exported[session.id];
    if (previous && previous.fingerprint === fingerprint) {
      nextState[session.id] = previous;
      continue;
    }
    const version = Math.max(nowMs, (previous?.version ?? 0) + 1);
    upserts.push({ session, clientRecordVersion: version });
    nextState[session.id] = { fingerprint, version, date: session.date };
  }

  const deleteWorkoutIds: string[] = [];
  for (const [id, state] of Object.entries(exported)) {
    if (seen.has(id)) continue;
    if (inWindow(state.date)) {
      // Exported recently but no longer in GainLog: it was deleted.
      deleteWorkoutIds.push(id);
    } else {
      // Aged out of the window: forget it without touching Health Connect.
    }
  }
  return { upserts, deleteWorkoutIds, nextState };
}
