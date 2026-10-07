/**
 * How long to wait before the next check, based on the last successful report.
 * 0 means run now: no previous report, the last one is a full interval old,
 * or the stored time is unparseable or in the future (clock change).
 */
export function getInitialDelayMs({
  lastReportedAt,
  now,
  intervalMs,
}: {
  lastReportedAt: string | null;
  now: Date;
  intervalMs: number;
}): number {
  if (!lastReportedAt) return 0;
  const last = Date.parse(lastReportedAt);
  if (Number.isNaN(last)) return 0;
  const elapsed = now.getTime() - last;
  if (elapsed < 0 || elapsed >= intervalMs) return 0;
  return intervalMs - elapsed;
}
