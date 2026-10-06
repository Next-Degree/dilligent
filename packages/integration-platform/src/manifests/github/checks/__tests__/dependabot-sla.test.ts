import { describe, expect, it } from 'bun:test';
import type { GitHubDependabotAlert } from '../../types';
import {
  DEFAULT_SLA_DAYS,
  evaluateAlertSla,
  resolveSlaDays,
  type AlertSlaTiming,
} from '../dependabot-alert-sla';
import { daysAgo, makeAlert, repo, runCheck } from './dependabot-harness';

const NOW = new Date('2026-10-06T12:00:00Z');
const at = (days: number): string =>
  new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString();

const remediationSla = (evidence: Record<string, unknown>): Record<string, unknown> => {
  const repoEvidence = evidence['acme/api'] as Record<string, unknown>;
  return repoEvidence.remediation_sla as Record<string, unknown>;
};

describe('dependabotCheck remediation SLA', () => {
  it('passes with a note when high alerts are still within the 30 day SLA', async () => {
    const result = await runCheck(
      [
        repo('acme/api', {
          openAlerts: [
            makeAlert('high', { number: 1, createdAt: daysAgo(10) }),
            makeAlert('high', { number: 2, createdAt: daysAgo(25) }),
          ],
        }),
      ],
      { target_repos: ['acme/api'] },
    );
    expect(result.failed).toEqual([]);
    expect(result.passed).toHaveLength(1);
    expect(result.passed[0]!.title).toBe('Dependabot enabled on api');
    expect(result.passed[0]!.description).toContain(
      '2 open alerts within remediation SLA. Next due: #2 (high) in 5 days.',
    );
  });

  it('fails only on the alerts past SLA and reports the oldest breach', async () => {
    const result = await runCheck(
      [
        repo('acme/api', {
          openAlerts: [
            makeAlert('high', { number: 1, createdAt: daysAgo(45) }),
            makeAlert('high', { number: 2, createdAt: daysAgo(3) }),
            makeAlert('critical', { number: 3, createdAt: daysAgo(2) }),
          ],
        }),
      ],
      { target_repos: ['acme/api'] },
    );
    expect(result.passed).toEqual([]);
    expect(result.failed).toHaveLength(1);
    const finding = result.failed[0]!;
    expect(finding.title).toBe('1 Dependabot alert past remediation SLA on api');
    // Severity reflects the breached alert, not the in-SLA critical.
    expect(finding.severity).toBe('high');
    expect(finding.description).toContain(
      'Oldest: #1 (high) is 45 days old, 15 days past its 30 day SLA.',
    );
    expect(finding.description).toContain('critical 7d, high 30d, medium 90d, low 180d');
  });

  it('fails a critical alert after 7 days by default', async () => {
    const result = await runCheck(
      [repo('acme/api', { openAlerts: [makeAlert('critical', { createdAt: daysAgo(8) })] })],
      { target_repos: ['acme/api'] },
    );
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]!.severity).toBe('critical');
  });

  it('respects custom SLA variables', async () => {
    const result = await runCheck(
      [repo('acme/api', { openAlerts: [makeAlert('high', { createdAt: daysAgo(10) })] })],
      { target_repos: ['acme/api'], sla_days_high: 5 },
    );
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]!.description).toContain('high 5d');
  });

  it('ignores alerts below the threshold even when they are past SLA', async () => {
    const result = await runCheck(
      [repo('acme/api', { openAlerts: [makeAlert('medium', { createdAt: daysAgo(200) })] })],
      { target_repos: ['acme/api'] },
    );
    expect(result.failed).toEqual([]);
    expect(result.passed[0]!.description).not.toContain('within remediation SLA');
  });

  it('records per-alert timing in the evidence', async () => {
    const result = await runCheck(
      [
        repo('acme/api', {
          openAlerts: [
            makeAlert('high', { number: 1, createdAt: daysAgo(40) }),
            makeAlert('high', { number: 2, createdAt: daysAgo(4) }),
          ],
        }),
      ],
      { target_repos: ['acme/api'] },
    );
    const sla = remediationSla(result.evidence[0]!);
    expect(sla.threshold).toBe('high');
    expect(sla.sla_days).toEqual(DEFAULT_SLA_DAYS);
    expect(sla.past_sla).toBe(1);
    expect(sla.within_sla).toBe(1);
    expect(sla.truncated).toBe(false);
    const alerts = sla.worst_alerts as AlertSlaTiming[];
    expect(alerts.map((a) => [a.number, a.age_days, a.days_past_sla, a.days_until_due])).toEqual([
      [1, 40, 10, 0],
      [2, 4, 0, 26],
    ]);
  });
  it('lists only the 10 most overdue alerts in evidence and flags truncation', async () => {
    const openAlerts = Array.from({ length: 12 }, (_, i) =>
      makeAlert('high', { number: i + 1, createdAt: daysAgo(31 + i) }),
    );
    const result = await runCheck([repo('acme/api', { openAlerts })], {
      target_repos: ['acme/api'],
    });
    const sla = remediationSla(result.evidence[0]!);
    expect(sla.past_sla).toBe(12);
    expect(sla.truncated).toBe(true);
    const listed = (sla.worst_alerts as AlertSlaTiming[]).map((a) => a.number);
    expect(listed).toEqual([12, 11, 10, 9, 8, 7, 6, 5, 4, 3]);
    expect(result.failed[0]!.title).toBe('12 Dependabot alerts past remediation SLA on api');
  });
});

describe('dependabotCheck evidence with undated alerts', () => {
  it('keeps an undated breach in the capped list and describes the oldest dated one', async () => {
    const dated = Array.from({ length: 10 }, (_, i) =>
      makeAlert('high', { number: i + 1, createdAt: daysAgo(31 + i) }),
    );
    const result = await runCheck(
      [
        repo('acme/api', {
          openAlerts: [
            makeAlert('high', { number: 99, createdAt: daysAgo(29) }),
            ...dated,
            makeAlert('high', { number: 50, createdAt: null }),
          ],
        }),
      ],
      { target_repos: ['acme/api'] },
    );
    const sla = remediationSla(result.evidence[0]!);
    const listed = sla.worst_alerts as AlertSlaTiming[];
    expect(sla.past_sla).toBe(11);
    expect(sla.truncated).toBe(true);
    expect(listed.map((a) => a.number)).not.toContain(99);
    expect(listed.every((a) => a.breached)).toBe(true);
    expect(listed[0]!.number).toBe(50);
    expect(result.failed[0]!.description).toContain('Oldest: #10 (high) is 40 days old');
  });
});

describe('evaluateAlertSla', () => {
  const evaluate = (openAlerts: GitHubDependabotAlert[]): AlertSlaTiming[] =>
    evaluateAlertSla({ openAlerts, threshold: 'high', slaDays: DEFAULT_SLA_DAYS, now: NOW });

  it('treats the last day of the SLA as on time', () => {
    const [onDeadline] = evaluate([makeAlert('high', { createdAt: at(30) })]);
    expect(onDeadline!.breached).toBe(false);
    expect(onDeadline!.days_until_due).toBe(0);

    const [dayAfter] = evaluate([makeAlert('high', { createdAt: at(31) })]);
    expect(dayAfter!.breached).toBe(true);
    expect(dayAfter!.days_past_sla).toBe(1);
  });

  it('breaches on exact elapsed time, not whole days', () => {
    const hour = 60 * 60 * 1000;
    const thirtyDaysOneHour = new Date(NOW.getTime() - 30 * 24 * hour - hour).toISOString();
    const [high] = evaluate([makeAlert('high', { createdAt: thirtyDaysOneHour })]);
    expect(high!.breached).toBe(true);
    expect(high!.age_days).toBe(30);
    expect(high!.days_past_sla).toBe(1);

    const sevenDays23Hours = new Date(NOW.getTime() - 7 * 24 * hour - 23 * hour).toISOString();
    const [critical] = evaluate([makeAlert('critical', { createdAt: sevenDays23Hours })]);
    expect(critical!.breached).toBe(true);
  });

  it('sorts breached alerts, undated ones first, ahead of alerts within SLA', () => {
    const timings = evaluate([
      makeAlert('high', { number: 1, createdAt: at(30) }),
      makeAlert('high', { number: 2, createdAt: null }),
      makeAlert('high', { number: 3, createdAt: at(45) }),
    ]);
    expect(timings.map((t) => [t.number, t.breached])).toEqual([
      [2, true],
      [3, true],
      [1, false],
    ]);
  });

  it('treats a missing or unreadable created_at as breached', () => {
    const timings = evaluate([
      makeAlert('high', { createdAt: null }),
      makeAlert('high', { createdAt: 'not a date' }),
    ]);
    expect(timings.every((t) => t.breached && t.age_days === null)).toBe(true);
  });

  it('sorts the most overdue alert first', () => {
    const timings = evaluate([
      makeAlert('high', { number: 1, createdAt: at(35) }),
      makeAlert('critical', { number: 2, createdAt: at(20) }),
      makeAlert('high', { number: 3, createdAt: at(1) }),
    ]);
    expect(timings.map((t) => t.number)).toEqual([2, 1, 3]);
  });
});

describe('resolveSlaDays', () => {
  it('uses the 7/30/90 policy defaults when nothing is configured', () => {
    expect(resolveSlaDays({})).toEqual({ critical: 7, high: 30, medium: 90, low: 180 });
  });

  it('falls back to the default for values below 1 day', () => {
    expect(resolveSlaDays({ sla_days_critical: '0.5', sla_days_high: 0.99 })).toEqual(
      DEFAULT_SLA_DAYS,
    );
    expect(resolveSlaDays({ sla_days_critical: '1.5' }).critical).toBe(1);
  });

  it('accepts numeric strings and ignores invalid values', () => {
    expect(
      resolveSlaDays({
        sla_days_critical: '3',
        sla_days_high: 0,
        sla_days_medium: -5,
        sla_days_low: 'soon',
      }),
    ).toEqual({ critical: 3, high: 30, medium: 90, low: 180 });
  });
});
