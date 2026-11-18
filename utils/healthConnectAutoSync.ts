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
  /** Readable failure message per failed lane. */
  errors?: Record<string, string>;
}

export interface AutoSyncFailure {
  atMs: number;
  message: string;
}

/** Foreground retry delays after a failed lane (e.g. Tailscale still reconnecting). */
export const AUTO_SYNC_RETRY_DELAYS_MS = [30_000, 2 * 60_000, 5 * 60_000] as const;

export function autoSyncRetryDelayMs(attempt: number): number | null {
  if (!Number.isSafeInteger(attempt) || attempt < 0) return null;
  return AUTO_SYNC_RETRY_DELAYS_MS[attempt] ?? null;
}

const NETWORK_ERROR_PATTERN = /network request failed|failed to fetch|networkerror|timed? ?out|aborted|ECONNREFUSED|ENOTFOUND|EAI_AGAIN/i;

/**
 * Turns a thrown sync error into one short sentence for Settings.
 * The GainLog API is only reachable over Tailscale, so a network failure is
 * almost always the phone's VPN being disconnected or asleep.
 */
export function describeAutoSyncError(error: unknown): string {
  let message = '';
  if (error instanceof Error) message = error.message;
  else if (typeof error === 'string') message = error;
  else if (error && typeof error === 'object' && 'message' in error) {
    const value = (error as { message?: unknown }).message;
    if (typeof value === 'string') message = value;
  }
  message = message.trim();
  if (!message || NETWORK_ERROR_PATTERN.test(message)) {
    return 'Could not reach the GainLog server. Check that Tailscale is connected.';
  }
  return message.length > 160 ? `${message.slice(0, 157)}...` : message;
}

export function parseAutoSyncFailure(raw: string | null): AutoSyncFailure | null {
  if (raw == null) return null;
  try {
    const value = JSON.parse(raw) as Partial<AutoSyncFailure>;
    if (typeof value.atMs !== 'number' || !Number.isFinite(value.atMs)) return null;
    if (typeof value.message !== 'string' || !value.message) return null;
    return { atMs: value.atMs, message: value.message };
  } catch {
    return null;
  }
}

export function formatSyncAge(nowMs: number, thenMs: number | null): string {
  if (thenMs == null || !Number.isFinite(thenMs)) return 'never';
  const minutes = Math.max(0, Math.round((nowMs - thenMs) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
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
  saveFailure,
}: {
  nowMs: number;
  force: boolean;
  lanes: AutoSyncLane[];
  saveSuccess: (name: string, nowMs: number) => Promise<void>;
  saveFailure?: (name: string, failure: AutoSyncFailure) => Promise<void>;
}): Promise<AutoSyncLaneResult> {
  const result: AutoSyncLaneResult = { attempted: [], succeeded: [], failed: [], errors: {} };
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
    } catch (error) {
      const message = describeAutoSyncError(error);
      result.failed.push(lane.name);
      result.errors![lane.name] = message;
      if (saveFailure) {
        try {
          await saveFailure(lane.name, { atMs: nowMs, message });
        } catch {
          // Status bookkeeping must never mask the sync result itself.
        }
      }
    }
  }
  return result;
}
