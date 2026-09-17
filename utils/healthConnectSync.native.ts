import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  aggregateRecord,
  getChanges,
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
  FITBIT_DATA_ORIGIN,
  healthConnectInitialBootstrapRequiresRepair,
  healthConnectRepairDateKeys,
  nearestRecordWithin,
  preferredDataOriginRecords,
  preferredFitbitDataOriginFilter,
  recentLocalDateKeys,
  RENPHO_DATA_ORIGIN,
  selectBestSleepSession,
  sleepSessionsEndingOnDate,
  stepTotalFromAggregate,
  type HealthConnectRepairState,
} from './healthConnect';
import {
  combineHealthConnectStateShards,
  createSerialTaskRunner,
  HealthConnectRepairRequiredError,
  indexHealthConnectRecords,
  parseHealthConnectSyncState,
  prepareHealthConnectWeightReconciliation,
  runHealthConnectChangeSync,
  runHealthConnectRepairFallback,
  shardHealthConnectSyncState,
  stampHealthConnectRecordType,
  type HealthConnectChangePage,
  type HealthConnectChangeRecord,
  type HealthConnectSyncState,
} from './healthConnectChangeSync';

export interface HealthConnectSyncResult {
  dailyImported: boolean;
  dailyImports: number;
  bodyMeasurements: number;
}

export interface HealthConnectSyncOptions {
  requestPermissions?: boolean;
  requestBackgroundAccess?: boolean;
  days?: number;
  repair?: boolean;
  repairIfRequired?: boolean;
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
const historyPermission = {
  accessType: 'read' as const,
  recordType: 'ReadHealthDataHistory' as const,
};
const CHANGE_STATE_KEY = 'gainlog.healthConnect.healthSyncState.v1';
const CHANGE_STATE_META_KEY = 'gainlog.healthConnect.healthSyncState.v2.meta';
const CHANGE_STATE_SHARD_PREFIX = 'gainlog.healthConnect.healthSyncState.v2.shard.';
const CHANGE_STATE_SHARD_COUNT = 128;
const changeRecordTypes = readPermissions.map(permission => permission.recordType) as any[];

const changeStateShardKey = (index: number) => (
  `${CHANGE_STATE_SHARD_PREFIX}${index.toString().padStart(3, '0')}`
);

async function loadPersistedHealthConnectState(): Promise<HealthConnectSyncState | null> {
  const rawMetadata = await AsyncStorage.getItem(CHANGE_STATE_META_KEY);
  if (rawMetadata) {
    try {
      const metadata = JSON.parse(rawMetadata);
      const shardCount = metadata?.shardCount;
      if (!Number.isSafeInteger(shardCount) || shardCount < 1 || shardCount > 1_024) return null;
      const values = await AsyncStorage.multiGet(
        Array.from({ length: shardCount }, (_, index) => changeStateShardKey(index)),
      );
      if (values.some(([, value]) => value == null)) return null;
      return combineHealthConnectStateShards(
        metadata,
        values.map(([, value]) => value as string),
      );
    } catch {
      return null;
    }
  }

  try {
    return parseHealthConnectSyncState(await AsyncStorage.getItem(CHANGE_STATE_KEY));
  } catch (error) {
    if (error instanceof Error && error.message.includes('CursorWindow')) return null;
    throw error;
  }
}

async function savePersistedHealthConnectState(state: HealthConnectSyncState): Promise<void> {
  const sharded = shardHealthConnectSyncState(state, CHANGE_STATE_SHARD_COUNT);
  await AsyncStorage.multiSet([
    [CHANGE_STATE_META_KEY, JSON.stringify(sharded.metadata)],
    ...sharded.shards.map((value, index) => [changeStateShardKey(index), value] as [string, string]),
  ]);
  await AsyncStorage.removeItem(CHANGE_STATE_KEY);
}

const requestInit = (body: unknown) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});
const post = async (path: string, body: unknown) => {
  const response = await fetch(`${API_URL}${path}`, requestInit(body));
  if (!response.ok) throw new Error(`Health Connect import failed: ${response.status} ${response.statusText}`);
};
const getJson = async <T>(path: string): Promise<T> => {
  const response = await fetch(`${API_URL}${path}`);
  if (!response.ok) throw new Error(`Health Connect request failed: ${response.status} ${response.statusText}`);
  return response.json() as Promise<T>;
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
    return {
      records: stampHealthConnectRecordType(recordType, page.records as any[]),
      pageToken: page.pageToken,
    };
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

async function syncDate(day: string): Promise<{
  bodyMeasurements: number;
  records: HealthConnectChangeRecord[];
}> {
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
  const fitbitDistance = preferredDataOriginRecords(distance, FITBIT_DATA_ORIGIN);
  const fitbitActiveCalories = preferredDataOriginRecords(calories, FITBIT_DATA_ORIGIN);
  const fitbitTotalCalories = preferredDataOriginRecords(totalCalories, FITBIT_DATA_ORIGIN);
  const fitbitRestingHr = preferredDataOriginRecords(restingHr, FITBIT_DATA_ORIGIN);
  const fitbitHrv = preferredDataOriginRecords(hrv, FITBIT_DATA_ORIGIN);
  const fitbitExercise = preferredDataOriginRecords(exercise, FITBIT_DATA_ORIGIN);
  const observedRenphoWeights = preferredDataOriginRecords(weights, RENPHO_DATA_ORIGIN);
  const reconcileStart = new Date(`${day}T00:00:00`);
  const reconcileEnd = new Date(reconcileStart);
  reconcileEnd.setDate(reconcileEnd.getDate() + 1);
  const weightReconciliation = prepareHealthConnectWeightReconciliation(
    observedRenphoWeights,
    reconcileStart.toISOString(),
    reconcileEnd.toISOString(),
  );
  const renphoWeights = weightReconciliation.records;
  const daily = buildHealthConnectDailyPayload(day, {
    stepsTotal: stepTotalFromAggregate(stepsAggregate),
    distancesMeters: fitbitDistance.map(item => item.distance.inMeters),
    activeCalories: fitbitActiveCalories.map(item => item.energy.inKilocalories),
    totalCalories: fitbitTotalCalories.map(item => item.energy.inKilocalories),
    sleepStages: selectedSleep?.stages,
    restingHeartRates: fitbitRestingHr.map(item => item.beatsPerMinute),
    hrvMs: fitbitHrv.map(item => item.heartRateVariabilityMillis),
    exerciseDurationsMinutes: fitbitExercise.map(item => minutesBetween(item.startTime, item.endTime)),
  });
  await post('/health-connect/daily/import', daily);
  for (const weight of renphoWeights) {
    const weightOrigin = weight.metadata?.dataOrigin;
    const matchingBodyFat = weightOrigin
      ? bodyFat.filter(item => item.metadata?.dataOrigin === weightOrigin)
      : bodyFat;
    const matchingLeanMass = weightOrigin
      ? leanMass.filter(item => item.metadata?.dataOrigin === weightOrigin)
      : leanMass;
    const fat = nearestRecordWithin(matchingBodyFat, weight.time, 15);
    const lean = nearestRecordWithin(matchingLeanMass, weight.time, 15);
    const height = nearestRecordWithin(heights, weight.time, 24 * 60);
    await post('/body-weight/import', buildHealthConnectWeightPayload({
      id: weight.metadata.id,
      time: weight.time,
      weightKg: weight.weight.inKilograms,
      bodyFatPercent: fat?.percentage,
      leanMassKg: lean?.mass?.inKilograms,
      heightMeters: height?.height?.inMeters,
    }));
  }
  await post(
    '/health-connect/body-weight/reconcile',
    weightReconciliation.payload,
  );
  return {
    bodyMeasurements: renphoWeights.length,
    records: [
      stepRecords,
      distance,
      calories,
      totalCalories,
      sleepRecords,
      restingHr,
      hrv,
      exercise,
      renphoWeights,
      bodyFat,
      leanMass,
      heights,
    ].flat() as HealthConnectChangeRecord[],
  };
}

async function deleteHealthConnectWeightRecords(recordIds: string[]): Promise<void> {
  for (const recordId of recordIds) {
    const sourceRecordId = `health-connect:weight:${recordId}`;
    const response = await fetch(
      `${API_URL}/health-connect/body-weight/${encodeURIComponent(sourceRecordId)}`,
      { method: 'DELETE' },
    );
    if (!response.ok) {
      throw new Error(
        `Health Connect weight deletion failed: ${response.status} ${response.statusText}`,
      );
    }
  }
}

/**
 * Reconciles durable Health Connect changes. First use bootstraps a bounded
 * local-date window; explicit repair replaces the cursor from a full baseline.
 */
async function syncHealthConnectUnsafe(
  options: HealthConnectSyncOptions = {},
): Promise<HealthConnectSyncResult> {
  if (!await initialize()) throw new Error('Health Connect is unavailable on this device.');
  if (options.requestPermissions !== false) {
    // react-native-health-connect 4.1.3 omits special history access from the
    // returned grant list. The first historical read is the authoritative gate.
    await requestPermission([
      ...permissions,
      ...(options.requestBackgroundAccess ? [backgroundPermission] : []),
      ...(options.repair ? [historyPermission] : []),
    ]);
  }

  const persistedState = await loadPersistedHealthConnectState();
  const currentState = persistedState;
  const repairState = options.repair || persistedState === null
    ? await getJson<HealthConnectRepairState>('/health-connect/repair-state')
    : null;
  if (
    !options.repair && persistedState === null && healthConnectInitialBootstrapRequiresRepair(
      new Date(),
      repairState as HealthConnectRepairState,
      options.days ?? 2,
    )
  ) {
    throw new HealthConnectRepairRequiredError();
  }
  const baselineDays = options.repair
    ? healthConnectRepairDateKeys(
      new Date(),
      repairState as HealthConnectRepairState,
      options.days ?? 90,
    )
    : recentLocalDateKeys(new Date(), options.days ?? 2);
  let dailyImports = 0;
  let bodyMeasurements = 0;
  const reconcileDates = async (days: string[]) => {
    const observedRecords: HealthConnectChangeRecord[] = [];
    for (const day of days) {
      const result = await syncDate(day);
      dailyImports += 1;
      bodyMeasurements += result.bodyMeasurements;
      observedRecords.push(...result.records);
    }
    return indexHealthConnectRecords(observedRecords);
  };
  await runHealthConnectChangeSync({
    currentState,
    forceBootstrap: options.repair,
    allowUnknownTombstonesAfterBaseline: options.repair,
    fetchInitialPage: async () => getChanges({
      recordTypes: changeRecordTypes,
    }) as Promise<HealthConnectChangePage>,
    reconcileBaseline: () => reconcileDates(baselineDays),
    fetchPage: async changesToken => getChanges({
      changesToken,
    }) as Promise<HealthConnectChangePage>,
    reconcileDates: async days => { await reconcileDates(days); },
    deleteWeightRecords: deleteHealthConnectWeightRecords,
    saveState: savePersistedHealthConnectState,
  });
  return {
    dailyImported: dailyImports > 0,
    dailyImports,
    bodyMeasurements,
  };
}

const runHealthConnectSyncSerially = createSerialTaskRunner(
  (options: HealthConnectSyncOptions) => runHealthConnectRepairFallback(
    options,
    syncHealthConnectUnsafe,
  ),
);

export function syncHealthConnect(
  options: HealthConnectSyncOptions = {},
): Promise<HealthConnectSyncResult> {
  return runHealthConnectSyncSerially(options);
}

export async function repairHealthConnect(days = 90): Promise<HealthConnectSyncResult> {
  return syncHealthConnect({
    days,
    repair: true,
    requestBackgroundAccess: true,
  });
}
