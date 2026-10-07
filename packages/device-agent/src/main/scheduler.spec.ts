import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHECK_INTERVAL_MS } from '../shared/constants';
import type { CheckResult } from '../shared/types';
import type { LastReport } from './store';

const runAllChecksMock = vi.fn();
const reportCheckResultsMock = vi.fn();
const getLastReportMock = vi.fn();
const setLastReportMock = vi.fn();
const setLastCheckResultsMock = vi.fn();
let authEpoch = 0;

const STORED_RESULTS: CheckResult[] = [
  {
    checkType: 'disk_encryption',
    passed: true,
    details: { method: 'test', raw: '', message: '' },
    checkedAt: '2026-10-06T09:00:00.000Z',
  },
];

vi.mock('../checks', () => ({ runAllChecks: () => runAllChecksMock() }));
vi.mock('./reporter', () => ({ reportCheckResults: (r: unknown) => reportCheckResultsMock(r) }));
vi.mock('./logger', () => ({ log: vi.fn() }));
vi.mock('./store', () => ({
  getAuth: () => ({ sessionToken: 't', cookieName: 'c', userId: 'u', organizations: [] }),
  getAuthEpoch: () => authEpoch,
  getLastCheckResults: () => STORED_RESULTS,
  setLastCheckResults: (r: CheckResult[]) => setLastCheckResultsMock(r),
  getLastReport: () => getLastReportMock(),
  setLastReport: (r: LastReport) => setLastReportMock(r),
}));

import { handleSystemResume, runChecksNow, startScheduler, stopScheduler } from './scheduler';

const HOUR = 60 * 60 * 1000;

function reportedHoursAgo(hours: number, isCompliant = true): LastReport {
  return { reportedAt: new Date(Date.now() - hours * HOUR).toISOString(), isCompliant };
}

function mockReport({ allSucceeded }: { allSucceeded: boolean }) {
  reportCheckResultsMock.mockResolvedValue({
    allSucceeded,
    isCompliant: allSucceeded,
    sessionExpired: false,
    allDevicesNotFound: false,
  });
}

describe('startScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-06T12:00:00.000Z'));
    runAllChecksMock.mockReset().mockResolvedValue([]);
    reportCheckResultsMock.mockReset();
    mockReport({ allSucceeded: true });
    getLastReportMock.mockReset().mockReturnValue(null);
    setLastReportMock.mockReset();
  });

  afterEach(() => {
    stopScheduler();
    vi.useRealTimers();
  });

  it('uses an 8 hour interval', () => {
    expect(CHECK_INTERVAL_MS).toBe(8 * HOUR);
  });

  it('runs immediately when there is no previous report', async () => {
    startScheduler(vi.fn());
    await vi.advanceTimersByTimeAsync(0);
    expect(runAllChecksMock).toHaveBeenCalledTimes(1);
  });

  it('runs immediately when the last report is older than the interval', async () => {
    getLastReportMock.mockReturnValue(reportedHoursAgo(9));
    startScheduler(vi.fn());
    await vi.advanceTimersByTimeAsync(0);
    expect(runAllChecksMock).toHaveBeenCalledTimes(1);
  });

  it('waits for the remainder when the last report is recent, then repeats', async () => {
    getLastReportMock.mockReturnValue(reportedHoursAgo(3));
    startScheduler(vi.fn());

    await vi.advanceTimersByTimeAsync(5 * HOUR - 1);
    expect(runAllChecksMock).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(runAllChecksMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS);
    expect(runAllChecksMock).toHaveBeenCalledTimes(2);
  });

  it('shows stored results right away when the first check is delayed', () => {
    getLastReportMock.mockReturnValue(reportedHoursAgo(1, false));
    const onCheckComplete = vi.fn();
    startScheduler(onCheckComplete);
    expect(onCheckComplete).toHaveBeenCalledWith(STORED_RESULTS, false);
  });

  it('records the report time only when every org accepted the check-in', async () => {
    startScheduler(vi.fn());
    await vi.advanceTimersByTimeAsync(0);
    expect(setLastReportMock).toHaveBeenCalledWith({
      reportedAt: '2026-10-06T12:00:00.000Z',
      isCompliant: true,
    });
  });

  it('does not record the report time when the check-in failed', async () => {
    mockReport({ allSucceeded: false });
    startScheduler(vi.fn());
    await vi.advanceTimersByTimeAsync(0);
    expect(runAllChecksMock).toHaveBeenCalledTimes(1);
    expect(setLastReportMock).not.toHaveBeenCalled();
  });

  it('runs now when a check after the last report failed to report', async () => {
    // Report succeeded at 08:00, but STORED_RESULTS (checkedAt 09:00, now 12:00)
    // come from a later run whose check-in failed.
    getLastReportMock.mockReturnValue({
      reportedAt: '2026-10-06T08:00:00.000Z',
      isCompliant: true,
    });
    const onCheckComplete = vi.fn();
    startScheduler(onCheckComplete);
    await vi.advanceTimersByTimeAsync(0);
    expect(runAllChecksMock).toHaveBeenCalledTimes(1);
    expect(onCheckComplete).not.toHaveBeenCalledWith(STORED_RESULTS, true);
  });

  it('cancels a pending first check when stopped', async () => {
    getLastReportMock.mockReturnValue(reportedHoursAgo(3));
    startScheduler(vi.fn());
    stopScheduler();
    await vi.advanceTimersByTimeAsync(24 * HOUR);
    expect(runAllChecksMock).not.toHaveBeenCalled();
  });
});

describe('handleSystemResume', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-06T12:00:00.000Z'));
    runAllChecksMock.mockReset().mockResolvedValue([]);
    reportCheckResultsMock.mockReset();
    mockReport({ allSucceeded: true });
    getLastReportMock.mockReset();
    setLastReportMock.mockReset();
  });

  afterEach(() => {
    stopScheduler();
    vi.useRealTimers();
  });

  it('runs a check on wake when the machine slept past the interval', async () => {
    getLastReportMock.mockReturnValue(reportedHoursAgo(3));
    startScheduler(vi.fn());
    expect(runAllChecksMock).not.toHaveBeenCalled();

    // Simulate sleep: wall clock jumps 10h while the pending timer has not fired.
    vi.setSystemTime(new Date('2026-10-06T22:00:00.000Z'));
    handleSystemResume(vi.fn());
    await vi.advanceTimersByTimeAsync(0);
    expect(runAllChecksMock).toHaveBeenCalledTimes(1);
  });

  it('does nothing when the scheduler is not running', async () => {
    handleSystemResume(vi.fn());
    await vi.advanceTimersByTimeAsync(0);
    expect(runAllChecksMock).not.toHaveBeenCalled();
  });
});

describe('sign-out during a check run', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-06T12:00:00.000Z'));
    authEpoch = 0;
    runAllChecksMock.mockReset().mockResolvedValue([]);
    reportCheckResultsMock.mockReset();
    mockReport({ allSucceeded: true });
    getLastReportMock.mockReset().mockReturnValue(null);
    setLastReportMock.mockReset();
    setLastCheckResultsMock.mockReset();
  });

  afterEach(() => {
    stopScheduler();
    vi.useRealTimers();
  });

  it('persists nothing and skips the callback when sign-out lands mid-report', async () => {
    reportCheckResultsMock.mockImplementationOnce(async () => {
      authEpoch++; // user signs out while the check-in is in flight
      return {
        allSucceeded: true,
        isCompliant: true,
        sessionExpired: false,
        allDevicesNotFound: false,
      };
    });
    const onCheckComplete = vi.fn();

    await runChecksNow(onCheckComplete);

    expect(setLastReportMock).not.toHaveBeenCalled();
    expect(onCheckComplete).not.toHaveBeenCalled();
  });

  it('does not save results when sign-out lands while checks run', async () => {
    runAllChecksMock.mockImplementationOnce(async () => {
      authEpoch++;
      return [];
    });
    const onCheckComplete = vi.fn();

    await runChecksNow(onCheckComplete);

    expect(setLastCheckResultsMock).not.toHaveBeenCalled();
    expect(reportCheckResultsMock).not.toHaveBeenCalled();
    expect(onCheckComplete).not.toHaveBeenCalled();
  });

  it('lets the next session run while a stale run is still in flight', async () => {
    let finishStaleRun: (value: never[]) => void = () => undefined;
    runAllChecksMock.mockImplementationOnce(
      () => new Promise((resolve) => (finishStaleRun = resolve)),
    );

    const staleRun = runChecksNow(vi.fn());
    authEpoch++; // sign out, then sign in again

    const onCheckComplete = vi.fn();
    await runChecksNow(onCheckComplete);
    expect(runAllChecksMock).toHaveBeenCalledTimes(2);
    expect(onCheckComplete).toHaveBeenCalledTimes(1);

    finishStaleRun([]);
    await staleRun;
    expect(setLastReportMock).toHaveBeenCalledTimes(1);
  });

  it('still skips an overlapping run within the same session', async () => {
    let finishRun: (value: never[]) => void = () => undefined;
    runAllChecksMock.mockImplementationOnce(() => new Promise((resolve) => (finishRun = resolve)));

    const firstRun = runChecksNow(vi.fn());
    await runChecksNow(vi.fn());
    expect(runAllChecksMock).toHaveBeenCalledTimes(1);

    finishRun([]);
    await firstRun;
  });
});
