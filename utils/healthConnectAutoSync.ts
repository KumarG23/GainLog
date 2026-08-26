export const AUTO_SYNC_INTERVAL_MS = 60 * 60 * 1000;

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
