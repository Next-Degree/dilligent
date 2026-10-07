import { describe, expect, it } from 'vitest';
import { getInitialDelayMs } from './schedule-timing';

const HOUR = 60 * 60 * 1000;
const INTERVAL = 8 * HOUR;
const NOW = new Date('2026-10-06T12:00:00.000Z');

function hoursAgo(hours: number): string {
  return new Date(NOW.getTime() - hours * HOUR).toISOString();
}

describe('getInitialDelayMs', () => {
  it('runs now when there is no previous report', () => {
    expect(getInitialDelayMs({ lastReportedAt: null, now: NOW, intervalMs: INTERVAL })).toBe(0);
  });

  it('waits for the remainder when the last report is recent', () => {
    const delay = getInitialDelayMs({
      lastReportedAt: hoursAgo(3),
      now: NOW,
      intervalMs: INTERVAL,
    });
    expect(delay).toBe(5 * HOUR);
  });

  it('runs now when the last report is exactly one interval old', () => {
    const delay = getInitialDelayMs({
      lastReportedAt: hoursAgo(8),
      now: NOW,
      intervalMs: INTERVAL,
    });
    expect(delay).toBe(0);
  });

  it('runs now when the last report is older than one interval', () => {
    const delay = getInitialDelayMs({
      lastReportedAt: hoursAgo(20),
      now: NOW,
      intervalMs: INTERVAL,
    });
    expect(delay).toBe(0);
  });

  it('runs now when the last report is in the future', () => {
    const delay = getInitialDelayMs({
      lastReportedAt: hoursAgo(-1),
      now: NOW,
      intervalMs: INTERVAL,
    });
    expect(delay).toBe(0);
  });

  it('runs now when the stored time is unparseable', () => {
    const delay = getInitialDelayMs({
      lastReportedAt: 'not a date',
      now: NOW,
      intervalMs: INTERVAL,
    });
    expect(delay).toBe(0);
  });
});
