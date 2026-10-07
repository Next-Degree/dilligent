import { runAllChecks } from '../checks';
import { CHECK_INTERVAL_MS } from '../shared/constants';
import type { CheckResult } from '../shared/types';
import { log } from './logger';
import { reportCheckResults } from './reporter';
import { getInitialDelayMs } from './schedule-timing';
import {
  getAuth,
  getLastCheckResults,
  getLastReport,
  setLastCheckResults,
  setLastReport,
} from './store';

let checkTimer: ReturnType<typeof setInterval> | null = null;
let firstCheckTimer: ReturnType<typeof setTimeout> | null = null;
let isRunning = false;

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
 * old; then it shows the stored results and waits for the remainder.
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

  if (delay === 0 || !lastReport) {
    startRepeating();
  } else {
    onCheckComplete(getLastCheckResults(), lastReport.isCompliant);
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

function clearTimers(): void {
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
  if (isRunning) {
    log('Check already in progress, skipping');
    return;
  }

  const auth = getAuth();
  if (!auth) {
    log('Not authenticated, skipping check');
    return;
  }

  isRunning = true;

  try {
    log(`Running compliance checks (reporting to ${auth.organizations.length} org(s))...`);
    const results = await runAllChecks();
    setLastCheckResults(results);

    // Report to all organizations
    const { allSucceeded, isCompliant, sessionExpired, allDevicesNotFound } =
      await reportCheckResults(results);

    // Only a check-in every org accepted counts toward the next scheduled run,
    // so a failed report (offline, API down) is retried on the next start.
    if (allSucceeded) {
      setLastReport({ reportedAt: new Date().toISOString(), isCompliant });
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
    onCheckComplete(results, false);
  } finally {
    isRunning = false;
  }
}
