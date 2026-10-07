import { runAllChecks } from '../checks';
import { CHECK_INTERVAL_MS } from '../shared/constants';
import type { CheckResult } from '../shared/types';
import { log } from './logger';
import { reportCheckResults } from './reporter';
import { getInitialDelayMs, hasUnreportedResults } from './schedule-timing';
import {
  getAuth,
  getAuthEpoch,
  getLastCheckResults,
  getLastReport,
  setLastCheckResults,
  setLastReport,
} from './store';

let checkTimer: ReturnType<typeof setInterval> | null = null;
let firstCheckTimer: ReturnType<typeof setTimeout> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
/** Auth epoch of the run in progress, or null when idle. */
let runningEpoch: number | null = null;

/** Wait before retrying a check-in that didn't reach every org. */
export const RETRY_DELAY_MS = 15 * 60 * 1000;

type CheckCallback = (results: CheckResult[], isCompliant: boolean) => void;
type SessionExpiredCallback = () => void;
type DevicesNotFoundCallback = () => void;

let onSessionExpired: SessionExpiredCallback | null = null;
let onDevicesNotFound: DevicesNotFoundCallback | null = null;

/**
 * Registers a callback for when the session token is rejected (401).
 */
export function setSessionExpiredHandler(handler: SessionExpiredCallback): void {
  onSessionExpired = handler;
}

/**
 * Registers a callback for when all device IDs return 404 (stale registrations).
 */
export function setDevicesNotFoundHandler(handler: DevicesNotFoundCallback): void {
  onDevicesNotFound = handler;
}

/**
 * Starts the periodic compliance check scheduler.
 * Runs a check now unless the last successful report is less than one interval
 * old and covers the stored results; then it shows them and waits out the rest.
 */
export function startScheduler(onCheckComplete: CheckCallback): void {
  clearTimers();

  const lastReport = getLastReport();
  const delay = getInitialDelayMs({
    lastReportedAt: lastReport?.reportedAt ?? null,
    now: new Date(),
    intervalMs: CHECK_INTERVAL_MS,
  });

  const startRepeating = () => {
    firstCheckTimer = null;
    runChecksAndReport(onCheckComplete);
    checkTimer = setInterval(() => {
      runChecksAndReport(onCheckComplete);
    }, CHECK_INTERVAL_MS);
  };

  const storedResults = getLastCheckResults();
  // A newer local run than the last successful report means that check-in
  // failed: retry now rather than show its results under an older status.
  if (
    !lastReport ||
    delay === 0 ||
    hasUnreportedResults({ results: storedResults, lastReportedAt: lastReport.reportedAt })
  ) {
    startRepeating();
  } else {
    onCheckComplete(storedResults, lastReport.isCompliant);
    firstCheckTimer = setTimeout(startRepeating, delay);
    log(`Last check-in was recent, next check in ${Math.round(delay / 1000 / 60)} minutes`);
  }

  log(`Scheduler started: checks every ${CHECK_INTERVAL_MS / 1000 / 60} minutes`);
}

/**
 * Re-evaluates the schedule after the system wakes. Timers pause during sleep,
 * so a laptop that slept past the interval would otherwise wait even longer.
 * No-op when the scheduler isn't running (e.g. signed out).
 */
export function handleSystemResume(onCheckComplete: CheckCallback): void {
  if (!firstCheckTimer && !checkTimer) return;
  log('System resumed, re-evaluating check schedule');
  startScheduler(onCheckComplete);
}

/**
 * Stops the periodic scheduler.
 */
export function stopScheduler(): void {
  clearTimers();
  log('Scheduler stopped');
}

function cancelRetry(): void {
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
}

function clearTimers(): void {
  cancelRetry();
  if (firstCheckTimer) {
    clearTimeout(firstCheckTimer);
    firstCheckTimer = null;
  }
  if (checkTimer) {
    clearInterval(checkTimer);
    checkTimer = null;
  }
}

/**
 * Triggers an immediate check run outside the normal schedule.
 */
export async function runChecksNow(onCheckComplete: CheckCallback): Promise<void> {
  await runChecksAndReport(onCheckComplete);
}

/**
 * Runs all checks and reports results to ALL registered organizations.
 */
async function runChecksAndReport(onCheckComplete: CheckCallback): Promise<void> {
  const epoch = getAuthEpoch();
  // Skip only overlap within this session; a run left over from a signed-out
  // session must not block the new one.
  if (runningEpoch === epoch) {
    log('Check already in progress, skipping');
    return;
  }

  const auth = getAuth();
  if (!auth) {
    log('Not authenticated, skipping check');
    return;
  }

  runningEpoch = epoch;
  // True once the user has signed out since this run started.
  const isStale = () => getAuthEpoch() !== epoch;

  try {
    log(`Running compliance checks (reporting to ${auth.organizations.length} org(s))...`);
    const results = await runAllChecks();
    if (isStale()) return discardStaleRun();
    setLastCheckResults(results);

    // Report to all organizations
    const { allSucceeded, isCompliant, sessionExpired, allDevicesNotFound, retryable } =
      await reportCheckResults(results);
    if (isStale()) return discardStaleRun();

    // Only a check-in every org accepted counts toward the next scheduled run.
    // A transient failure is retried after RETRY_DELAY_MS, and any failed one
    // leaves results newer than lastReport so startScheduler retries on start.
    if (allSucceeded) {
      setLastReport({ reportedAt: new Date().toISOString(), isCompliant });
      cancelRetry(); // e.g. a manual check succeeded before the retry fired
    }

    if (sessionExpired) {
      log('Session expired during check-in, triggering re-authentication');
      onSessionExpired?.();
      return;
    }

    if (allDevicesNotFound) {
      log('All device IDs returned 404, triggering re-registration');
      onDevicesNotFound?.();
      return;
    }

    if (retryable) scheduleRetry(onCheckComplete);

    log(`Check complete: ${isCompliant ? 'COMPLIANT' : 'NON-COMPLIANT'}`);
    onCheckComplete(results, isCompliant);
  } catch (error) {
    log(`Error during check cycle: ${error}`, 'ERROR');
    const results: CheckResult[] = [
      {
        checkType: 'disk_encryption' as const,
        passed: false,
        details: { method: 'error', raw: String(error), message: 'Check cycle failed' },
        checkedAt: new Date().toISOString(),
      },
    ];
    if (isStale()) return discardStaleRun();
    onCheckComplete(results, false);
  } finally {
    if (runningEpoch === epoch) runningEpoch = null;
  }
}

/**
 * Retries a check-in that failed for a transient reason (network, 5xx, 429)
 * soon instead of waiting a full interval, so a brief blip on a machine that
 * never sleeps or restarts doesn't leave the server stale for hours. Permanent
 * failures (e.g. one org's 404) wait for the regular interval. Only while the
 * scheduler runs; one at a time.
 */
function scheduleRetry(onCheckComplete: CheckCallback): void {
  if (retryTimer || (!firstCheckTimer && !checkTimer)) return;
  log(`Check-in failed transiently, retrying in ${RETRY_DELAY_MS / 1000 / 60} minutes`);
  retryTimer = setTimeout(() => {
    retryTimer = null;
    runChecksAndReport(onCheckComplete);
  }, RETRY_DELAY_MS);
}

function discardStaleRun(): void {
  log('Signed out during check run, discarding its results');
}
