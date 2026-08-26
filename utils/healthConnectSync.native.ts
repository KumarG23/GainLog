import {
  aggregateRecord,
  getGrantedPermissions,
  initialize,
  readRecords,
  requestPermission,
} from 'react-native-health-connect';
import { API_URL } from '../constants/api';
import {
  buildHealthConnectDailyPayload,
  buildHealthConnectWeightPayload,
  collectPaginatedRecords,
  nearestRecordWithin,
  preferredFitbitDataOriginFilter,
  recentLocalDateKeys,
  selectBestSleepSession,
  sleepSessionsEndingOnDate,
  stepTotalFromAggregate,
} from './healthConnect';

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

const readPermissions = [
  'Steps', 'Distance', 'ActiveCaloriesBurned', 'TotalCaloriesBurned', 'SleepSession', 'RestingHeartRate',
  'HeartRateVariabilityRmssd', 'Weight', 'BodyFat', 'LeanBodyMass', 'Height', 'ExerciseSession',
].map(recordType => ({ accessType: 'read' as const, recordType: recordType as any }));
const permissions = [
  ...readPermissions,
  { accessType: 'write' as const, recordType: 'Nutrition' as const },
];
const backgroundPermission = {
  accessType: 'read' as const,
  recordType: 'BackgroundAccessPermission' as const,
};

const requestInit = (body: unknown) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});
const post = async (path: string, body: unknown) => {
  const response = await fetch(`${API_URL}${path}`, requestInit(body));
  if (!response.ok) throw new Error(`Health Connect import failed: ${response.status} ${response.statusText}`);
};
const localRangeForDate = (day: string) => {
  const start = new Date(`${day}T00:00:00`);
  const end = new Date(`${day}T23:59:59.999`);
  return { operator: 'between' as const, startTime: start.toISOString(), endTime: end.toISOString() };
};
const sleepRangeEndingOnDate = (day: string) => {
  const end = new Date(`${day}T23:59:59.999`);
  const start = new Date(`${day}T12:00:00`);
  start.setDate(start.getDate() - 1);
  return { startTime: start.toISOString(), endTime: end.toISOString() };
};
const records = async (recordType: any, timeRangeFilter: any) => collectPaginatedRecords<any>(
  async pageToken => {
    const page = await readRecords(recordType, {
      timeRangeFilter,
      pageSize: 1000,
      pageToken,
    });
    return { records: page.records as any[], pageToken: page.pageToken };
  },
);
const minutesBetween = (start: string, end: string) => Math.max(
  0,
  Math.round((Date.parse(end) - Date.parse(start)) / 60000),
);

export async function hasHealthConnectBackgroundAccess(): Promise<boolean> {
  if (!await initialize()) return false;
  const granted = await getGrantedPermissions();
  return granted.some(permission => (
    permission.accessType === backgroundPermission.accessType
    && permission.recordType === backgroundPermission.recordType
  ));
}

async function syncDate(day: string): Promise<number> {
  const timeRangeFilter = localRangeForDate(day);
  const [
    stepsAggregateAll,
    stepRecords,
    distance,
    calories,
    totalCalories,
    sleepRecords,
    restingHr,
    hrv,
    exercise,
    weights,
    bodyFat,
    leanMass,
    heights,
  ] = await Promise.all([
    aggregateRecord({ recordType: 'Steps', timeRangeFilter }),
    records('Steps', timeRangeFilter),
    records('Distance', timeRangeFilter),
    records('ActiveCaloriesBurned', timeRangeFilter),
    records('TotalCaloriesBurned', timeRangeFilter),
    records('SleepSession', sleepRangeEndingOnDate(day)),
    records('RestingHeartRate', timeRangeFilter),
    records('HeartRateVariabilityRmssd', timeRangeFilter),
    records('ExerciseSession', timeRangeFilter),
    records('Weight', timeRangeFilter),
    records('BodyFat', timeRangeFilter),
    records('LeanBodyMass', timeRangeFilter),
    records('Height', timeRangeFilter),
  ]);
  const stepOriginFilter = preferredFitbitDataOriginFilter(stepRecords);
  const stepsAggregate = stepOriginFilter
    ? await aggregateRecord({
      recordType: 'Steps',
      timeRangeFilter,
      dataOriginFilter: stepOriginFilter,
    })
    : stepsAggregateAll;
  const sleep = sleepSessionsEndingOnDate(sleepRecords, day).map((session: any) => ({
    ...session,
    stages: (session.stages ?? []).map((stage: any) => ({
      stage: stage.stage,
      durationMinutes: minutesBetween(stage.startTime, stage.endTime),
    })),
  }));
  const selectedSleep = selectBestSleepSession(sleep);
  const selectedSleepOrigin = selectedSleep?.metadata?.dataOrigin;
  const sleepAggregate = selectedSleep && selectedSleepOrigin
    ? await aggregateRecord({
      recordType: 'SleepSession',
      timeRangeFilter: {
        operator: 'between',
        startTime: selectedSleep.startTime,
        endTime: selectedSleep.endTime,
      },
      dataOriginFilter: [selectedSleepOrigin],
    })
    : undefined;
  const sleepDurationSeconds = sleepAggregate?.dataOrigins?.length
    ? sleepAggregate.SLEEP_DURATION_TOTAL
    : undefined;
  const daily = buildHealthConnectDailyPayload(day, {
    stepsTotal: stepTotalFromAggregate(stepsAggregate),
    distancesMeters: distance.map(item => item.distance.inMeters),
    activeCalories: calories.map(item => item.energy.inKilocalories),
    totalCalories: totalCalories.map(item => item.energy.inKilocalories),
    sleepDurationSeconds,
    sleepStages: selectedSleep?.stages,
    restingHeartRates: restingHr.map(item => item.beatsPerMinute),
    hrvMs: hrv.map(item => item.heartRateVariabilityMillis),
    exerciseDurationsMinutes: exercise.map(item => minutesBetween(item.startTime, item.endTime)),
  });
  await post('/health-connect/daily/import', daily);
  for (const weight of weights) {
    const fat = nearestRecordWithin(bodyFat, weight.time, 15);
    const lean = nearestRecordWithin(leanMass, weight.time, 15);
    const height = nearestRecordWithin(heights, weight.time, 24 * 60);
    await post('/body-weight/import', buildHealthConnectWeightPayload({
      id: weight.metadata?.id ?? weight.time,
      time: weight.time,
      weightKg: weight.weight.inKilograms,
      bodyFatPercent: fat?.percentage,
      leanMassKg: lean?.mass?.inKilograms,
      heightMeters: height?.height?.inMeters,
    }));
  }
  return weights.length;
}

/**
 * Imports a rolling local-date window so late-arriving Watch/scale records can
 * correct yesterday as well as today. API upserts make retries idempotent.
 */
export async function syncHealthConnect(
  options: HealthConnectSyncOptions = {},
): Promise<HealthConnectSyncResult> {
  if (!await initialize()) throw new Error('Health Connect is unavailable on this device.');
  if (options.requestPermissions !== false) {
    await requestPermission([
      ...permissions,
      ...(options.requestBackgroundAccess ? [backgroundPermission] : []),
    ]);
  }

  const days = recentLocalDateKeys(new Date(), options.days ?? 2);
  let bodyMeasurements = 0;
  for (const day of days) {
    bodyMeasurements += await syncDate(day);
  }
  return {
    dailyImported: days.length > 0,
    dailyImports: days.length,
    bodyMeasurements,
  };
}
