export interface HealthConnectDailyInput {
  stepsTotal?: number;
  distancesMeters?: number[];
  activeCalories?: number[];
  totalCalories?: number[];
  sleepDurationSeconds?: number;
  sleepStages?: Array<{ stage: number; durationMinutes: number }>;
  restingHeartRates?: number[];
  hrvMs?: number[];
  exerciseDurationsMinutes?: number[];
}

export interface HealthConnectDailyPayload {
  date: string;
  source: 'health-connect';
  sleepMinutes?: number;
  deepSleepMinutes?: number;
  lightSleepMinutes?: number;
  remSleepMinutes?: number;
  awakeMinutes?: number;
  restingHeartRateBpm?: number;
  hrvMs?: number;
  steps?: number;
  distanceMiles?: number;
  activeCalories?: number;
  totalCalories?: number;
  exerciseMinutes?: number;
}

const sum = (values: number[] | undefined) =>
  values?.length ? values.reduce((total, value) => total + value, 0) : undefined;
const average = (values: number[] | undefined) => {
  const total = sum(values);
  return total == null || !values?.length ? undefined : total / values.length;
};
const rounded = (value: number | undefined, digits = 2) =>
  value == null ? undefined : Number(value.toFixed(digits));

export function stepTotalFromAggregate(aggregate: {
  COUNT_TOTAL: number;
  dataOrigins: string[];
}): number | undefined {
  return aggregate.dataOrigins.length ? aggregate.COUNT_TOTAL : undefined;
}

export const FITBIT_DATA_ORIGIN = 'com.fitbit.FitbitMobile';

export function preferredFitbitDataOriginFilter(
  records: Array<{ metadata?: { dataOrigin?: string } }>,
): string[] | undefined {
  return records.some(record => record.metadata?.dataOrigin === FITBIT_DATA_ORIGIN)
    ? [FITBIT_DATA_ORIGIN]
    : undefined;
}

export async function collectPaginatedRecords<T>(
  readPage: (pageToken?: string) => Promise<{ records: T[]; pageToken?: string }>,
): Promise<T[]> {
  const collected: T[] = [];
  let pageToken: string | undefined;
  do {
    const page = await readPage(pageToken);
    collected.push(...page.records);
    pageToken = page.pageToken;
  } while (pageToken);
  return collected;
}

interface SleepSessionCandidate {
  startTime: string;
  endTime: string;
  metadata?: { dataOrigin?: string };
  stages?: Array<{ stage: number; durationMinutes: number }>;
}

export function selectBestSleepSession<T extends SleepSessionCandidate>(sessions: T[]): T | undefined {
  const asleepMinutes = (session: T) => sum(
    session.stages
      ?.filter(stage => stage.stage === 2 || stage.stage === 4 || stage.stage === 5 || stage.stage === 6)
      .map(stage => stage.durationMinutes),
  ) ?? 0;
  const sessionMinutes = (session: T) => Math.max(
    0,
    (Date.parse(session.endTime) - Date.parse(session.startTime)) / 60_000,
  );
  const usableSessions = sessions.filter(session => asleepMinutes(session) > 0);
  const fallbackCandidates = usableSessions.length ? usableSessions : sessions;
  const preferredOrigin = preferredFitbitDataOriginFilter(fallbackCandidates);
  const candidates = preferredOrigin
    ? fallbackCandidates.filter(session => session.metadata?.dataOrigin === preferredOrigin[0])
    : fallbackCandidates;

  return candidates.reduce<T | undefined>((best, session) => {
    if (!best) return session;
    const asleepDifference = asleepMinutes(session) - asleepMinutes(best);
    if (asleepDifference !== 0) return asleepDifference > 0 ? session : best;
    const durationDifference = sessionMinutes(session) - sessionMinutes(best);
    if (durationDifference !== 0) return durationDifference > 0 ? session : best;
    return Date.parse(session.endTime) > Date.parse(best.endTime) ? session : best;
  }, undefined);
}

/** Maps Android stage codes: awake=1, sleeping/unspecified=2, light=4, deep=5, REM=6. */
export function buildHealthConnectDailyPayload(
  date: string,
  input: HealthConnectDailyInput,
): HealthConnectDailyPayload {
  const stages = input.sleepStages ?? [];
  const stageMinutes = (stage: number) => sum(stages.filter(item => item.stage === stage).map(item => item.durationMinutes));
  const unspecifiedSleepMinutes = stageMinutes(2);
  const deepSleepMinutes = stageMinutes(5);
  const lightSleepMinutes = stageMinutes(4);
  const remSleepMinutes = stageMinutes(6);
  const awakeMinutes = stageMinutes(1);
  const stagedSleepMinutes = sum([
    unspecifiedSleepMinutes,
    deepSleepMinutes,
    lightSleepMinutes,
    remSleepMinutes,
  ].filter((value): value is number => value != null));
  const sleepMinutes = input.sleepDurationSeconds == null
    ? stagedSleepMinutes
    : Math.round(input.sleepDurationSeconds / 60);

  const payload: HealthConnectDailyPayload = {
    date,
    source: 'health-connect',
    steps: input.stepsTotal,
    distanceMiles: rounded(sum(input.distancesMeters)?.valueOf() ? sum(input.distancesMeters)! / 1609.344 : undefined),
    activeCalories: rounded(sum(input.activeCalories)),
    totalCalories: rounded(sum(input.totalCalories)),
    sleepMinutes,
    deepSleepMinutes,
    lightSleepMinutes,
    remSleepMinutes,
    awakeMinutes,
    restingHeartRateBpm: rounded(average(input.restingHeartRates)),
    hrvMs: rounded(average(input.hrvMs)),
    exerciseMinutes: sum(input.exerciseDurationsMinutes),
  };
  return Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined),
  ) as unknown as HealthConnectDailyPayload;
}

export interface HealthConnectWeightInput {
  id: string;
  time: string;
  weightKg: number;
  bodyFatPercent?: number;
  leanMassKg?: number;
  heightMeters?: number;
}

export function nearestRecordWithin<T extends { time: string }>(
  items: T[],
  time: string,
  toleranceMinutes: number,
): T | undefined {
  const target = Date.parse(time);
  const toleranceMs = toleranceMinutes * 60_000;
  return items.reduce<T | undefined>((best, item) => {
    const distance = Math.abs(Date.parse(item.time) - target);
    if (!Number.isFinite(distance) || distance > toleranceMs) return best;
    if (!best) return item;
    return distance < Math.abs(Date.parse(best.time) - target) ? item : best;
  }, undefined);
}

export function buildHealthConnectWeightPayload(record: HealthConnectWeightInput) {
  const bodyFatFraction = record.bodyFatPercent == null
    ? undefined
    : record.bodyFatPercent / 100;
  const leanMassKg = record.leanMassKg ?? (
    bodyFatFraction == null ? undefined : record.weightKg * (1 - bodyFatFraction)
  );
  const bmi = record.heightMeters == null || record.heightMeters <= 0
    ? undefined
    : record.weightKg / (record.heightMeters ** 2);
  return {
    date: record.time,
    weightLbs: rounded(record.weightKg * 2.2046226218, 3)!,
    bodyFatPercent: rounded(record.bodyFatPercent, 2),
    leanBodyMassLbs: leanMassKg == null ? undefined : rounded(leanMassKg * 2.2046226218, 3),
    bmi: rounded(bmi, 2),
    ...(record.leanMassKg == null && leanMassKg != null ? { leanBodyMassDerived: true } : {}),
    source: 'health-connect' as const,
    sourceRecordId: `health-connect:weight:${record.id}`,
  };
}

export function sleepSessionsEndingOnDate<T extends { endTime: string }>(
  sessions: T[],
  date: string,
): T[] {
  return sessions.filter(session => {
    const end = new Date(session.endTime);
    const year = end.getFullYear();
    const month = String(end.getMonth() + 1).padStart(2, '0');
    const day = String(end.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}` === date;
  });
}

export function recentLocalDateKeys(now = new Date(), count = 2): string[] {
  if (!Number.isInteger(count) || count < 1) return [];
  const dates: string[] = [];
  for (let offset = count - 1; offset >= 0; offset -= 1) {
    const date = new Date(now);
    date.setHours(12, 0, 0, 0);
    date.setDate(date.getDate() - offset);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    dates.push(`${year}-${month}-${day}`);
  }
  return dates;
}
