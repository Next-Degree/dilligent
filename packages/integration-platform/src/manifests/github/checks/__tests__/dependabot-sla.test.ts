import { describe, expect, it } from 'bun:test';
import type { GitHubDependabotAlert } from '../../types';
import {
  ageInDays,
  breachSeverity,
  classifyAlertsBySla,
  describeSla,
  resolveSlaConfig,
  resolveSlaDays,
  type SlaSeverity,
  type TrackedAlert,
} from '../dependabot-sla';

const NOW = new Date('2026-09-15T00:00:00.000Z');
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** ISO timestamp for an alert opened `days` before NOW. */
const daysAgo = (days: number): string => new Date(NOW.getTime() - days * MS_PER_DAY).toISOString();

let alertCounter = 0;
const makeAlert = ({
  severity,
  ageDays,
  undated,
}: {
  severity: SlaSeverity | 'medium' | 'low';
  ageDays?: number;
  undated?: boolean;
}): GitHubDependabotAlert => {
  alertCounter += 1;
  return {
    number: alertCounter,
    state: 'open',
    dependency: { package: { ecosystem: 'npm', name: `pkg-${alertCounter}` } },
    security_advisory: { ghsa_id: `GHSA-${alertCounter}`, severity },
    security_vulnerability: { severity },
    created_at: undated ? undefined : daysAgo(ageDays ?? 0),
    html_url: '',
  } as unknown as GitHubDependabotAlert;
};

describe('SLA helpers', () => {
  it('resolveSlaDays falls back on blank, non-numeric and negative input', () => {
    expect(resolveSlaDays(undefined, 30)).toBe(30);
    expect(resolveSlaDays('', 30)).toBe(30);
    expect(resolveSlaDays('bogus', 30)).toBe(30);
    expect(resolveSlaDays(-5, 30)).toBe(30);
    expect(resolveSlaDays(null, 30)).toBe(30);
  });

  it('resolveSlaDays preserves zero and floors fractions', () => {
    expect(resolveSlaDays(0, 30)).toBe(0);
    expect(resolveSlaDays('7', 30)).toBe(7);
    expect(resolveSlaDays(7.9, 30)).toBe(7);
  });

  it('resolveSlaConfig reads both windows with defaults', () => {
    expect(resolveSlaConfig({})).toEqual({ critical: 15, high: 30 });
    expect(
      resolveSlaConfig({ critical_remediation_sla_days: 3, high_remediation_sla_days: 7 }),
    ).toEqual({ critical: 3, high: 7 });
  });

  it('ageInDays floors whole days and returns null for unusable timestamps', () => {
    expect(ageInDays(daysAgo(5), NOW)).toBe(5);
    expect(ageInDays(new Date(NOW.getTime() - 1000).toISOString(), NOW)).toBe(0);
    expect(ageInDays(undefined, NOW)).toBeNull();
    expect(ageInDays('not-a-date', NOW)).toBeNull();
  });

  it('classifyAlertsBySla splits on the window boundary and counts undated alerts', () => {
    const alerts = [
      makeAlert({ severity: 'critical', ageDays: 15 }), // exactly at the deadline: within
      makeAlert({ severity: 'critical', ageDays: 16 }), // one day over: breaching
      makeAlert({ severity: 'high', ageDays: 31 }),
      makeAlert({ severity: 'medium', ageDays: 999 }), // not tracked
      makeAlert({ severity: 'high', undated: true }),
    ];
    const result = classifyAlertsBySla({
      alerts,
      sla: { critical: 15, high: 30 },
      now: NOW,
    });
    expect(result.breaching).toHaveLength(2);
    expect(result.withinSla).toHaveLength(1);
    expect(result.undated).toBe(1);
    // Sorted worst-overdue first.
    expect(result.breaching[0]!.overdueDays).toBe(1);
  });

  it('breachSeverity reports critical only when a critical alert is breaching', () => {
    const alert = (severity: SlaSeverity): TrackedAlert => ({
      number: 1,
      severity,
      packageName: 'pkg',
      advisory: 'GHSA-1',
      htmlUrl: '',
      createdAt: daysAgo(40),
      ageDays: 40,
      slaDays: 30,
      overdueDays: 10,
    });
    expect(breachSeverity([alert('high'), alert('critical')])).toBe('critical');
    expect(breachSeverity([alert('high')])).toBe('high');
  });

  it('describeSla pluralizes each window', () => {
    expect(describeSla({ critical: 15, high: 30 })).toBe('critical 15 days, high 30 days');
    expect(describeSla({ critical: 1, high: 1 })).toBe('critical 1 day, high 1 day');
  });
});
