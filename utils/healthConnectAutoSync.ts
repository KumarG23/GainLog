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
