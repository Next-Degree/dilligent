import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHECK_INTERVAL_MS } from '../shared/constants';
import type { CheckResult } from '../shared/types';
import type { LastReport } from './store';

const runAllChecksMock = vi.fn();
const reportCheckResultsMock = vi.fn();
const getLastReportMock = vi.fn();
const setLastReportMock = vi.fn();

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
  getLastCheckResults: () => STORED_RESULTS,
  setLastCheckResults: vi.fn(),
  getLastReport: () => getLastReportMock(),
  setLastReport: (r: LastReport) => setLastReportMock(r),
}));

import { handleSystemResume, startScheduler, stopScheduler } from './scheduler';

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
