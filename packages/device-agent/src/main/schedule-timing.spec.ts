import { describe, expect, it } from 'vitest';
import type { CheckResult } from '../shared/types';
import { getInitialDelayMs, getLastCheckedAt } from './schedule-timing';

const HOUR = 60 * 60 * 1000;
const INTERVAL = 8 * HOUR;
const NOW = new Date('2026-10-06T12:00:00.000Z');

function result(checkedAt: string): CheckResult {
  return {
    checkType: 'disk_encryption',
    passed: true,
    details: { method: 'test', raw: '', message: '' },
    checkedAt,
  };
}

describe('getLastCheckedAt', () => {
  it('returns null when there are no results', () => {
    expect(getLastCheckedAt([])).toBeNull();
  });

  it('returns the newest checkedAt', () => {
    const newest = getLastCheckedAt([
      result('2026-10-06T08:00:00.000Z'),
      result('2026-10-06T10:00:00.000Z'),
      result('2026-10-06T09:00:00.000Z'),
    ]);
    expect(newest?.toISOString()).toBe('2026-10-06T10:00:00.000Z');
  });

  it('ignores unparseable timestamps', () => {
    expect(getLastCheckedAt([result('not a date')])).toBeNull();
    expect(
      getLastCheckedAt([result('nope'), result('2026-10-06T10:00:00.000Z')])?.toISOString(),
    ).toBe('2026-10-06T10:00:00.000Z');
  });
});

describe('getInitialDelayMs', () => {
  it('runs now when there is no previous run', () => {
    expect(getInitialDelayMs({ lastCheckedAt: null, now: NOW, intervalMs: INTERVAL })).toBe(0);
  });

  it('waits for the remainder when the last run is recent', () => {
    const lastCheckedAt = new Date(NOW.getTime() - 3 * HOUR);
    expect(getInitialDelayMs({ lastCheckedAt, now: NOW, intervalMs: INTERVAL })).toBe(5 * HOUR);
  });

  it('runs now when the last run is exactly one interval old', () => {
    const lastCheckedAt = new Date(NOW.getTime() - INTERVAL);
    expect(getInitialDelayMs({ lastCheckedAt, now: NOW, intervalMs: INTERVAL })).toBe(0);
  });

  it('runs now when the last run is older than one interval', () => {
    const lastCheckedAt = new Date(NOW.getTime() - 20 * HOUR);
    expect(getInitialDelayMs({ lastCheckedAt, now: NOW, intervalMs: INTERVAL })).toBe(0);
  });

  it('runs now when the last run is in the future', () => {
    const lastCheckedAt = new Date(NOW.getTime() + HOUR);
    expect(getInitialDelayMs({ lastCheckedAt, now: NOW, intervalMs: INTERVAL })).toBe(0);
  });
});
