import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHECK_INTERVAL_MS } from '../shared/constants';
import type { CheckResult } from '../shared/types';

const runAllChecksMock = vi.fn();
const reportCheckResultsMock = vi.fn();
const getLastCheckResultsMock = vi.fn();

vi.mock('../checks', () => ({ runAllChecks: () => runAllChecksMock() }));
vi.mock('./reporter', () => ({ reportCheckResults: (r: unknown) => reportCheckResultsMock(r) }));
vi.mock('./logger', () => ({ log: vi.fn() }));
vi.mock('./store', () => ({
  getAuth: () => ({ sessionToken: 't', cookieName: 'c', userId: 'u', organizations: [] }),
  getLastCheckResults: () => getLastCheckResultsMock(),
  setLastCheckResults: vi.fn(),
}));

import { startScheduler, stopScheduler } from './scheduler';

const HOUR = 60 * 60 * 1000;

function storedRunAt(date: Date): CheckResult[] {
  const details = { method: 'test', raw: '', message: '' };
  return [{ checkType: 'disk_encryption', passed: true, details, checkedAt: date.toISOString() }];
}

describe('startScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-06T12:00:00.000Z'));
    runAllChecksMock.mockReset().mockResolvedValue([]);
    reportCheckResultsMock.mockReset().mockResolvedValue({
      isCompliant: true,
      sessionExpired: false,
      allDevicesNotFound: false,
    });
    getLastCheckResultsMock.mockReset();
  });

  afterEach(() => {
    stopScheduler();
    vi.useRealTimers();
  });

  it('uses an 8 hour interval', () => {
    expect(CHECK_INTERVAL_MS).toBe(8 * HOUR);
  });

  it('runs immediately when there is no previous run', async () => {
    getLastCheckResultsMock.mockReturnValue([]);
    startScheduler(vi.fn());
    await vi.advanceTimersByTimeAsync(0);
    expect(runAllChecksMock).toHaveBeenCalledTimes(1);
  });

  it('runs immediately when the last run is older than the interval', async () => {
    getLastCheckResultsMock.mockReturnValue(storedRunAt(new Date(Date.now() - 9 * HOUR)));
    startScheduler(vi.fn());
    await vi.advanceTimersByTimeAsync(0);
    expect(runAllChecksMock).toHaveBeenCalledTimes(1);
  });

  it('waits for the remainder when the last run is recent, then repeats', async () => {
    getLastCheckResultsMock.mockReturnValue(storedRunAt(new Date(Date.now() - 3 * HOUR)));
    startScheduler(vi.fn());

    await vi.advanceTimersByTimeAsync(5 * HOUR - 1);
    expect(runAllChecksMock).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(runAllChecksMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS);
    expect(runAllChecksMock).toHaveBeenCalledTimes(2);
  });

  it('cancels a pending first check when stopped', async () => {
    getLastCheckResultsMock.mockReturnValue(storedRunAt(new Date(Date.now() - 3 * HOUR)));
    startScheduler(vi.fn());
    stopScheduler();
    await vi.advanceTimersByTimeAsync(24 * HOUR);
    expect(runAllChecksMock).not.toHaveBeenCalled();
  });
});
