import type { CheckResult } from '../shared/types';

/**
 * Returns the newest `checkedAt` across stored results, or null when there are
 * none or none parse as a valid date.
 */
export function getLastCheckedAt(results: CheckResult[]): Date | null {
  let newest: number | null = null;
  for (const result of results) {
    const time = Date.parse(result.checkedAt);
    if (Number.isNaN(time)) continue;
    if (newest === null || time > newest) newest = time;
  }
  return newest === null ? null : new Date(newest);
}

/**
 * How long to wait before the first scheduled check on startup.
 * 0 means run now: no previous run, the last run is a full interval old, or
 * the stored time is in the future (clock change), which we don't trust.
 */
export function getInitialDelayMs({
  lastCheckedAt,
  now,
  intervalMs,
}: {
  lastCheckedAt: Date | null;
  now: Date;
  intervalMs: number;
}): number {
  if (!lastCheckedAt) return 0;
  const elapsed = now.getTime() - lastCheckedAt.getTime();
  if (elapsed < 0 || elapsed >= intervalMs) return 0;
  return intervalMs - elapsed;
}
