import { describe, expect, it } from 'bun:test';
import { dependabotSlaVariables } from '../../variables';
import { DEFAULT_SLA_DAYS, evaluateAlertSla, resolveSlaDays } from '../dependabot-alert-sla';
import { daysAgo, makeAlert, repo, runCheck } from './dependabot-harness';

const NOW = new Date('2026-10-06T12:00:00Z');

describe('strict mode (SLA of 0 days)', () => {
  it('accepts 0 as a number or a string', () => {
    expect(resolveSlaDays({ sla_days_critical: 0, sla_days_high: '0' })).toEqual({
      ...DEFAULT_SLA_DAYS,
      critical: 0,
      high: 0,
    });
  });

  it('breaches an alert opened this instant', () => {
    const [timing] = evaluateAlertSla({
      openAlerts: [makeAlert('high', { createdAt: NOW.toISOString() })],
      threshold: 'high',
      slaDays: { ...DEFAULT_SLA_DAYS, high: 0 },
      now: NOW,
    });
    expect(timing!.breached).toBe(true);
    expect(timing!.days_until_due).toBe(0);
  });

  it('restores the old fail-on-any-open-alert behavior for the check', async () => {
    const result = await runCheck(
      [repo('acme/api', { openAlerts: [makeAlert('high', { createdAt: daysAgo(1) })] })],
      { target_repos: ['acme/api'], sla_days_critical: 0, sla_days_high: 0 },
    );
    expect(result.passed).toEqual([]);
    expect(result.failed[0]!.title).toBe('1 Dependabot alert past remediation SLA on api');
    expect(result.failed[0]!.description).toContain('critical 0d, high 0d');
  });

  it('leaves other severities on their defaults', async () => {
    const result = await runCheck(
      [repo('acme/api', { openAlerts: [makeAlert('high', { createdAt: daysAgo(1) })] })],
      { target_repos: ['acme/api'], sla_days_critical: 0 },
    );
    expect(result.failed).toEqual([]);
    expect(result.passed).toHaveLength(1);
  });
});

describe('SLA field help text', () => {
  it('says the field only applies at or above the severity threshold', () => {
    const medium = dependabotSlaVariables.find((v) => v.id === 'sla_days_medium');
    expect(medium!.helpText).toContain(
      'Only applies when medium is at or above the "Fail on open alerts at severity" setting (default high).',
    );
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
