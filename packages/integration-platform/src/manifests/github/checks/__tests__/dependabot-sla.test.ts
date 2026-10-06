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
    const alerts = sla.alerts_at_or_above_threshold as AlertSlaTiming[];
    expect(alerts.map((a) => [a.number, a.age_days, a.days_past_sla, a.days_until_due])).toEqual([
      [1, 40, 10, 0],
      [2, 4, 0, 26],
    ]);
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
