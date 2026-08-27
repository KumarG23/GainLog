export interface HealthConnectRecordIndexEntry {
  recordType: string;
  dates: string[];
}

export interface HealthConnectSyncState {
  version: 1;
  changesToken: string;
  records: Record<string, HealthConnectRecordIndexEntry>;
}

export interface HealthConnectChangeRecord {
  recordType: string;
  metadata?: { id?: string };
  time?: string;
  startTime?: string;
  endTime?: string;
}

export interface HealthConnectChangePage {
  upsertionChanges: Array<{ record: HealthConnectChangeRecord }>;
  deletionChanges: Array<{ recordId: string }>;
  nextChangesToken: string;
  changesTokenExpired: boolean;
  hasMore: boolean;
}

export interface HealthConnectChangePlan {
  changedDates: string[];
  deletedWeightRecordIds: string[];
  requiresRepair: boolean;
  nextState: HealthConnectSyncState;
}

export function createSerialTaskRunner<Argument, Result>(
  task: (argument: Argument) => Promise<Result>,
): (argument: Argument) => Promise<Result> {
  let tail: Promise<void> = Promise.resolve();
  return argument => {
    const result = tail.then(
      () => task(argument),
      () => task(argument),
    );
    tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
}

function isCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
}

export function parseHealthConnectSyncState(
  raw: string | null,
): HealthConnectSyncState | null {
  if (raw == null) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const candidate = parsed as Record<string, unknown>;
    if (
      candidate.version !== 1
      || typeof candidate.changesToken !== 'string'
      || candidate.changesToken.length === 0
      || !candidate.records
      || typeof candidate.records !== 'object'
      || Array.isArray(candidate.records)
    ) {
      return null;
    }

    const records: Record<string, HealthConnectRecordIndexEntry> = {};
    for (const [recordId, rawEntry] of Object.entries(
      candidate.records as Record<string, unknown>,
    )) {
      if (!recordId || !rawEntry || typeof rawEntry !== 'object' || Array.isArray(rawEntry)) {
        return null;
      }
      const entry = rawEntry as Record<string, unknown>;
      if (
        typeof entry.recordType !== 'string'
        || entry.recordType.length === 0
        || !Array.isArray(entry.dates)
        || entry.dates.length === 0
        || !entry.dates.every(isCalendarDate)
      ) {
        return null;
      }
      records[recordId] = {
        recordType: entry.recordType,
        dates: [...entry.dates] as string[],
      };
    }
    return {
      version: 1,
      changesToken: candidate.changesToken,
      records,
    };
  } catch {
    return null;
  }
}

function localDateKey(timestamp: string): string {
  const value = new Date(timestamp);
  if (!Number.isFinite(value.getTime())) {
    throw new Error('Health Connect change record has an invalid timestamp.');
  }
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function calendarDatesBetween(startTimestamp: string, endTimestamp: string): string[] {
  const start = new Date(startTimestamp);
  const end = new Date(endTimestamp);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end < start) {
    throw new Error('Health Connect change record has an invalid interval.');
  }

  const endKey = localDateKey(endTimestamp);
  const cursor = new Date(
    start.getFullYear(),
    start.getMonth(),
    start.getDate(),
    12,
  );
  const dates: string[] = [];
  for (let count = 0; count < 367; count += 1) {
    const key = localDateKey(cursor.toISOString());
    dates.push(key);
    if (key === endKey) return dates;
    cursor.setDate(cursor.getDate() + 1);
  }
  throw new Error('Health Connect change interval exceeds the safety limit.');
}

function affectedDates(record: HealthConnectChangeRecord): string[] {
  if (record.time) return [localDateKey(record.time)];
  if (record.startTime && record.endTime) {
    return calendarDatesBetween(record.startTime, record.endTime);
  }
  throw new Error('Health Connect change record has no usable timestamp.');
}

export function indexHealthConnectRecords(
  records: HealthConnectChangeRecord[],
): Record<string, HealthConnectRecordIndexEntry> {
  const index: Record<string, HealthConnectRecordIndexEntry> = {};
  for (const record of records) {
    const recordId = record.metadata?.id;
    if (!recordId) throw new Error('Health Connect record is missing its record ID.');
    const existing = index[recordId];
    if (existing && existing.recordType !== record.recordType) {
      throw new Error('Health Connect record ID changed record type.');
    }
    index[recordId] = {
      recordType: record.recordType,
      dates: [...new Set([
        ...(existing?.dates ?? []),
        ...affectedDates(record),
      ])].sort(),
    };
  }
  return index;
}

export function stampHealthConnectRecordType<
  T extends Omit<HealthConnectChangeRecord, 'recordType'>,
>(recordType: string, records: T[]): Array<T & { recordType: string }> {
  return records.map(record => ({ ...record, recordType }));
}

export function indexHealthConnectWeightRecords(
  records: Omit<HealthConnectChangeRecord, 'recordType'>[],
): Record<string, HealthConnectRecordIndexEntry> {
  return indexHealthConnectRecords(stampHealthConnectRecordType('Weight', records));
}

export function buildHealthConnectWeightReconcilePayload(
  records: Record<string, HealthConnectRecordIndexEntry>,
  startTime: string,
  endTime: string,
  observedRecordCount: number,
) {
  return {
    startTime,
    endTime,
    observedRecordCount,
    sourceRecordIds: Object.entries(records)
      .filter(([, entry]) => entry.recordType === 'Weight')
      .map(([recordId]) => `health-connect:weight:${recordId}`)
      .sort(),
  };
}

export function prepareHealthConnectWeightReconciliation<
  T extends Omit<HealthConnectChangeRecord, 'recordType'>,
>(observedRecords: T[], startTime: string, endTime: string) {
  const records = observedRecords.filter(
    (record): record is T & { metadata: { id: string } } => (
      typeof record.metadata?.id === 'string' && record.metadata.id.length > 0
    ),
  );
  return {
    records,
    payload: buildHealthConnectWeightReconcilePayload(
      indexHealthConnectWeightRecords(records),
      startTime,
      endTime,
      observedRecords.length,
    ),
  };
}

export function planHealthConnectChangePage(
  state: HealthConnectSyncState,
  page: HealthConnectChangePage,
  allowUnknownTombstones = false,
): HealthConnectChangePlan {
  if (page.changesTokenExpired) {
    return {
      changedDates: [],
      deletedWeightRecordIds: [],
      requiresRepair: true,
      nextState: state,
    };
  }

  const records = Object.fromEntries(
    Object.entries(state.records).map(([recordId, entry]) => [
      recordId,
      { recordType: entry.recordType, dates: [...entry.dates] },
    ]),
  );
  const changedDates = new Set<string>();
  const deletedWeightRecordIds = new Set<string>();
  let requiresRepair = false;

  for (const change of page.upsertionChanges) {
    const recordId = change.record.metadata?.id;
    if (!recordId) {
      throw new Error('Health Connect upsertion is missing its record ID.');
    }
    for (const day of records[recordId]?.dates ?? []) changedDates.add(day);
    const dates = affectedDates(change.record);
    for (const day of dates) changedDates.add(day);
    records[recordId] = {
      recordType: change.record.recordType,
      dates,
    };
  }

  for (const change of page.deletionChanges) {
    const existing = records[change.recordId];
    if (!existing) {
      if (!allowUnknownTombstones) requiresRepair = true;
      continue;
    }
    for (const day of existing.dates) changedDates.add(day);
    if (existing.recordType === 'Weight') {
      deletedWeightRecordIds.add(change.recordId);
    }
    delete records[change.recordId];
  }

  return {
    changedDates: [...changedDates].sort(),
    deletedWeightRecordIds: [...deletedWeightRecordIds].sort(),
    requiresRepair,
    nextState: {
      version: 1,
      changesToken: page.nextChangesToken,
      records,
    },
  };
}

export class HealthConnectRepairRequiredError extends Error {
  constructor() {
    super('Health Connect full repair is required before cursor advancement.');
    this.name = 'HealthConnectRepairRequiredError';
  }
}

interface HealthConnectRepairFallbackOptions {
  repair?: boolean;
  repairIfRequired?: boolean;
  days?: number;
}

export async function runHealthConnectRepairFallback<
  Result,
  Options extends HealthConnectRepairFallbackOptions,
>(
  options: Options,
  run: (nextOptions: Options) => Promise<Result>,
): Promise<Result> {
  try {
    return await run(options);
  } catch (error) {
    if (
      options.repairIfRequired
      && !options.repair
      && error instanceof HealthConnectRepairRequiredError
    ) {
      return run({
        ...options,
        days: 90,
        repair: true,
        repairIfRequired: false,
      });
    }
    throw error;
  }
}

export function loadHealthConnectSyncState(
  raw: string | null,
): HealthConnectSyncState | null {
  if (raw == null) return null;
  const state = parseHealthConnectSyncState(raw);
  if (!state) throw new HealthConnectRepairRequiredError();
  return state;
}

interface ReconcileHealthConnectChangePagesDependencies {
  initialState: HealthConnectSyncState;
  fetchPage: (changesToken: string) => Promise<HealthConnectChangePage>;
  reconcileDates: (dates: string[]) => Promise<void>;
  deleteWeightRecords: (recordIds: string[]) => Promise<void>;
  saveState: (state: HealthConnectSyncState) => Promise<void>;
  allowUnknownTombstones?: boolean;
}

export interface HealthConnectChangeReconcileResult {
  pages: number;
  reconciledDates: number;
  deletedWeightRecords: number;
  state: HealthConnectSyncState;
}

export async function reconcileHealthConnectChangePages(
  dependencies: ReconcileHealthConnectChangePagesDependencies,
): Promise<HealthConnectChangeReconcileResult> {
  let state = dependencies.initialState;
  let pages = 0;
  let reconciledDates = 0;
  let deletedWeightRecords = 0;
  let hasMore = false;

  do {
    const page = await dependencies.fetchPage(state.changesToken);
    const plan = planHealthConnectChangePage(
      state,
      page,
      dependencies.allowUnknownTombstones,
    );
    if (plan.requiresRepair) throw new HealthConnectRepairRequiredError();
    if (plan.deletedWeightRecordIds.length > 0) {
      await dependencies.deleteWeightRecords(plan.deletedWeightRecordIds);
    }
    if (plan.changedDates.length > 0) {
      await dependencies.reconcileDates(plan.changedDates);
    }
    await dependencies.saveState(plan.nextState);
    state = plan.nextState;
    pages += 1;
    reconciledDates += plan.changedDates.length;
    deletedWeightRecords += plan.deletedWeightRecordIds.length;
    hasMore = page.hasMore;
    if (hasMore && pages >= 1_000) {
      throw new Error('Health Connect change sync exceeded the page safety limit.');
    }
  } while (hasMore);

  return {
    pages,
    reconciledDates,
    deletedWeightRecords,
    state,
  };
}

interface BootstrapHealthConnectChangeSyncDependencies {
  fetchInitialPage: () => Promise<HealthConnectChangePage>;
  fetchPage: (changesToken: string) => Promise<HealthConnectChangePage>;
  reconcileBaseline: () => Promise<Record<string, HealthConnectRecordIndexEntry>>;
  reconcileDates: (dates: string[]) => Promise<void>;
  deleteWeightRecords: (recordIds: string[]) => Promise<void>;
  saveState: (state: HealthConnectSyncState) => Promise<void>;
  allowUnknownTombstonesAfterBaseline?: boolean;
}

export async function bootstrapHealthConnectChangeSync(
  dependencies: BootstrapHealthConnectChangeSyncDependencies,
): Promise<HealthConnectChangeReconcileResult> {
  const page = await dependencies.fetchInitialPage();
  const baselineRecords = await dependencies.reconcileBaseline();
  const baselineState: HealthConnectSyncState = {
    version: 1,
    changesToken: page.nextChangesToken,
    records: baselineRecords,
  };
  const plan = planHealthConnectChangePage(
    baselineState,
    page,
    dependencies.allowUnknownTombstonesAfterBaseline,
  );
  if (plan.requiresRepair) throw new HealthConnectRepairRequiredError();
  if (plan.deletedWeightRecordIds.length > 0) {
    await dependencies.deleteWeightRecords(plan.deletedWeightRecordIds);
  }
  if (plan.changedDates.length > 0) {
    await dependencies.reconcileDates(plan.changedDates);
  }
  await dependencies.saveState(plan.nextState);
  const firstResult = {
    pages: 1,
    reconciledDates: plan.changedDates.length,
    deletedWeightRecords: plan.deletedWeightRecordIds.length,
    state: plan.nextState,
  };
  if (!page.hasMore) return firstResult;

  const continuation = await reconcileHealthConnectChangePages({
    initialState: plan.nextState,
    fetchPage: dependencies.fetchPage,
    reconcileDates: dependencies.reconcileDates,
    deleteWeightRecords: dependencies.deleteWeightRecords,
    saveState: dependencies.saveState,
    allowUnknownTombstones: dependencies.allowUnknownTombstonesAfterBaseline,
  });
  return {
    pages: firstResult.pages + continuation.pages,
    reconciledDates: firstResult.reconciledDates + continuation.reconciledDates,
    deletedWeightRecords:
      firstResult.deletedWeightRecords + continuation.deletedWeightRecords,
    state: continuation.state,
  };
}

interface RunHealthConnectChangeSyncDependencies
  extends BootstrapHealthConnectChangeSyncDependencies {
  currentState: HealthConnectSyncState | null;
  forceBootstrap?: boolean;
}

export async function runHealthConnectChangeSync(
  dependencies: RunHealthConnectChangeSyncDependencies,
): Promise<HealthConnectChangeReconcileResult> {
  if (dependencies.currentState && !dependencies.forceBootstrap) {
    return reconcileHealthConnectChangePages({
      initialState: dependencies.currentState,
      fetchPage: dependencies.fetchPage,
      reconcileDates: dependencies.reconcileDates,
      deleteWeightRecords: dependencies.deleteWeightRecords,
      saveState: dependencies.saveState,
    });
  }
  return bootstrapHealthConnectChangeSync(dependencies);
}
