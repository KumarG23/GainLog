export const AUTO_SYNC_INTERVAL_MS = 60 * 60 * 1000;

export interface AutoSyncLane {
  name: string;
  lastSuccessMs: number | null;
  run: () => Promise<void>;
}

export interface AutoSyncLaneResult {
  attempted: string[];
  succeeded: string[];
  failed: string[];
}

export function createForceAwareTaskRunner<
  Options extends { force?: boolean },
  Result,
>(task: (options: Options) => Promise<Result>): (options: Options) => Promise<Result> {
  let active: Promise<Result> | null = null;
  let activeIsForced = false;
  let pendingForced: Promise<Result> | null = null;

  const clearActive = (current: Promise<Result>) => {
    if (active !== current) return;
    active = null;
    activeIsForced = false;
  };
  const start = (options: Options): Promise<Result> => {
    let current: Promise<Result>;
    try {
      current = Promise.resolve(task(options));
    } catch (error) {
      current = Promise.reject(error);
    }
    active = current;
    activeIsForced = options.force === true;
    current.then(
      () => clearActive(current),
      () => clearActive(current),
    );
    return current;
  };

  return (options: Options): Promise<Result> => {
    if (!active) return start(options);
    if (options.force !== true || activeIsForced) return active;
    if (pendingForced) return pendingForced;

    const current = active;
    const queued = current.then(
      () => start(options),
      () => start(options),
    );
    pendingForced = queued;
    queued.then(
      () => { if (pendingForced === queued) pendingForced = null; },
      () => { if (pendingForced === queued) pendingForced = null; },
    );
    return queued;
  };
}

export function shouldAttemptHealthConnectAutoSync({
  nowMs,
  lastSuccessMs,
  intervalMs = AUTO_SYNC_INTERVAL_MS,
}: {
  nowMs: number;
  lastSuccessMs: number | null;
  intervalMs?: number;
}): boolean {
  if (!Number.isFinite(nowMs)) return false;
  if (lastSuccessMs == null || !Number.isFinite(lastSuccessMs)) return true;
  return nowMs - lastSuccessMs >= intervalMs;
}

export async function runIndependentAutoSyncLanes({
  nowMs,
  force,
  lanes,
  saveSuccess,
}: {
  nowMs: number;
  force: boolean;
  lanes: AutoSyncLane[];
  saveSuccess: (name: string, nowMs: number) => Promise<void>;
}): Promise<AutoSyncLaneResult> {
  const result: AutoSyncLaneResult = { attempted: [], succeeded: [], failed: [] };
  for (const lane of lanes) {
    if (!force && !shouldAttemptHealthConnectAutoSync({
      nowMs,
      lastSuccessMs: lane.lastSuccessMs,
    })) continue;

    result.attempted.push(lane.name);
    try {
      await lane.run();
      await saveSuccess(lane.name, nowMs);
      result.succeeded.push(lane.name);
    } catch {
      result.failed.push(lane.name);
    }
  }
  return result;
}
