import { describe, expect, it } from 'bun:test';
import type { GitHubDependabotAlert } from '../../types';
import { dependabotSlaVariables } from '../../variables';
import { dependabotCheck } from '../dependabot';
import {
  DEFAULT_SLA_DAYS,
  MAX_SLA_DAYS,
  evaluateAlertSla,
  resolveSlaDays,
} from '../dependabot-alert-sla';
import { daysAgo, makeAlert, repo, runCheck } from './dependabot-harness';

const NOW = new Date('2026-10-06T12:00:00Z');

describe('strict mode (SLA of 0 days)', () => {
  it('accepts 0 as a number or a string', () => {
    expect(
      resolveSlaDays({ dependabot_sla_days_critical: 0, dependabot_sla_days_high: '0' }),
    ).toEqual({
      ...DEFAULT_SLA_DAYS,
      critical: 0,
      high: 0,
    });
  });

  it('breaches an alert opened this instant', () => {
    const [timing] = evaluateAlertSla({
      openAlerts: [makeAlert('high', { createdAt: NOW.toISOString() })],
      slaDays: { ...DEFAULT_SLA_DAYS, high: 0 },
      now: NOW,
    });
    expect(timing!.breached).toBe(true);
    expect(timing!.days_overdue).toBe(0);
  });

  it('restores the old fail-on-any-open-alert behavior for the check', async () => {
    const result = await runCheck(
      [repo('acme/api', { openAlerts: [makeAlert('high', { createdAt: daysAgo(1) })] })],
      { target_repos: ['acme/api'], dependabot_sla_days_critical: 0, dependabot_sla_days_high: 0 },
    );
    expect(result.passed).toEqual([]);
    expect(result.failed[0]!.title).toBe('1 Dependabot alert past remediation SLA on api');
    expect(result.failed[0]!.description).toContain('critical 0d, high 0d');
  });

  it('leaves other severities on their defaults', async () => {
    const result = await runCheck(
      [repo('acme/api', { openAlerts: [makeAlert('high', { createdAt: daysAgo(1) })] })],
      { target_repos: ['acme/api'], dependabot_sla_days_critical: 0 },
    );
    expect(result.failed).toEqual([]);
    expect(result.passed).toHaveLength(1);
  });
});

describe('SLA field help text', () => {
  it('says a long SLA is how to deprioritize a severity', () => {
    const medium = dependabotSlaVariables.find((v) => v.id === 'dependabot_sla_days_medium');
    expect(medium!.helpText).toContain('use a long SLA to deprioritize a severity');
  });

  it('no longer offers a severity threshold setting', () => {
    expect(dependabotCheck.variables?.map((v) => v.id)).not.toContain('alert_severity_threshold');
  });
});

describe('evidence timestamps', () => {
  it('uses the same instant for checked_at and evaluated_at', async () => {
    const result = await runCheck(
      [repo('acme/api', { openAlerts: [makeAlert('high', { createdAt: daysAgo(1) })] })],
      { target_repos: ['acme/api'] },
    );
    const repoEvidence = result.evidence[0]!['acme/api'] as Record<string, unknown>;
    const sla = repoEvidence.remediation_sla as Record<string, unknown>;
    expect(repoEvidence.checked_at).toBe(sla.evaluated_at);
  });
});

describe('alerts with no severity', () => {
  it('are treated as critical so they get the shortest SLA', () => {
    const noSeverity = {
      ...makeAlert('low', { number: 5, createdAt: NOW.toISOString() }),
      security_vulnerability: undefined,
    } as unknown as GitHubDependabotAlert;
    const [timing] = evaluateAlertSla({
      openAlerts: [noSeverity],
      slaDays: DEFAULT_SLA_DAYS,
      now: new Date(NOW.getTime() + 8 * 24 * 60 * 60 * 1000),
    });
    expect(timing!.severity).toBe('critical');
    expect(timing!.breached).toBe(true);
  });
});

describe('very large SLA values', () => {
  it('caps the SLA at 100 years instead of falling back to the default', () => {
    expect(resolveSlaDays({ dependabot_sla_days_high: 100_000_000 }).high).toBe(MAX_SLA_DAYS);
    expect(resolveSlaDays({ dependabot_sla_days_low: '50000' }).low).toBe(MAX_SLA_DAYS);
  });

  it('keeps checking every repo instead of throwing on an out-of-range deadline', async () => {
    const result = await runCheck(
      [
        repo('acme/api', { openAlerts: [makeAlert('high')] }),
        repo('acme/web', { openAlerts: [makeAlert('high')] }),
      ],
      { target_repos: ['acme/api', 'acme/web'], dependabot_sla_days_high: 100_000_000 },
    );
    expect(result.passed.map((p) => p.resourceId)).toEqual(['acme/api', 'acme/web']);
  });

  it('treats a created_at that pushes the deadline out of range as undated', () => {
    const [timing] = evaluateAlertSla({
      openAlerts: [makeAlert('high', { createdAt: '+275760-09-01T00:00:00.000Z' })],
      slaDays: DEFAULT_SLA_DAYS,
      now: NOW,
    });
    expect(timing!.due_at).toBeNull();
    expect(timing!.breached).toBe(true);
  });
});

describe('finding severity when Dependabot is not active', () => {
  it('raises disabled and unknown failures to the worst overdue severity', async () => {
    const overdueCritical = [makeAlert('critical', { createdAt: daysAgo(60) })];
    const result = await runCheck(
      [
        repo('acme/api', { dependabotStatus: 'disabled', openAlerts: overdueCritical }),
        repo('acme/web', { dependabotStatus: 'unknown', openAlerts: overdueCritical }),
      ],
      { target_repos: ['acme/api', 'acme/web'] },
    );
    expect(result.failed.map((f) => f.severity)).toEqual(['critical', 'critical']);
  });

  it('keeps medium when nothing is overdue', async () => {
    const result = await runCheck(
      [repo('acme/api', { dependabotStatus: 'disabled', openAlerts: [] })],
      { target_repos: ['acme/api'] },
    );
    expect(result.failed[0]!.severity).toBe('medium');
  });
});
