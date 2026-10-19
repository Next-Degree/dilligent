import { describe, expect, it } from 'bun:test';
import { highestSeverityOf } from '../dependabot-alert-severity';
import { repo, runCheck, type AlertSeverity } from './dependabot-harness';

describe('dependabotCheck severity gating', () => {
  it('passes when Dependabot is enabled and there are zero open alerts', async () => {
    const result = await runCheck([repo('acme/api')], {
      target_repos: ['acme/api'],
    });
    expect(result.passed.map((p) => p.title)).toEqual(['Dependabot enabled on api']);
    expect(result.failed).toEqual([]);
  });

  it('fails when Dependabot is enabled but overdue high alerts exist', async () => {
    // This is the exact bug reported: 8 high alerts should fail, not pass.
    const result = await runCheck(
      [
        repo('acme/api', {
          openAlertSeverities: Array<AlertSeverity>(8).fill('high'),
        }),
      ],
      { target_repos: ['acme/api'] },
    );
    expect(result.passed).toEqual([]);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]!.title).toBe('8 Dependabot alerts past remediation SLA on api');
    expect(result.failed[0]!.severity).toBe('high');
    expect(result.failed[0]!.description).toContain('8 open alerts are past the remediation SLA');
  });

  it('fails with critical severity when critical alerts are present', async () => {
    const result = await runCheck(
      [
        repo('acme/api', {
          openAlertSeverities: ['critical', 'critical', 'high'],
        }),
      ],
      { target_repos: ['acme/api'] },
    );
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]!.severity).toBe('critical');
    expect(result.failed[0]!.title).toBe('3 Dependabot alerts past remediation SLA on api');
  });

  it('evaluates medium and low alerts too, with severity from the worst overdue', async () => {
    const result = await runCheck(
      [
        repo('acme/api', {
          openAlertSeverities: ['medium', 'medium', 'low'],
        }),
      ],
      { target_repos: ['acme/api'] },
    );
    expect(result.passed).toEqual([]);
    expect(result.failed[0]!.title).toBe('3 Dependabot alerts past remediation SLA on api');
    expect(result.failed[0]!.severity).toBe('medium');
  });

  it('fails on a single overdue low alert', async () => {
    const result = await runCheck([repo('acme/api', { openAlertSeverities: ['low'] })], {
      target_repos: ['acme/api'],
    });
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]!.title).toBe('1 Dependabot alert past remediation SLA on api');
    expect(result.failed[0]!.description).toContain('1 open alert is past the remediation SLA');
  });

  it('lets a long SLA deprioritize a severity', async () => {
    const result = await runCheck([repo('acme/api', { openAlertSeverities: ['low', 'low'] })], {
      target_repos: ['acme/api'],
      sla_days_low: 3650,
    });
    expect(result.passed).toHaveLength(1);
    expect(result.failed).toEqual([]);
  });

  it('fails when Dependabot is paused but high alerts exist', async () => {
    const result = await runCheck(
      [
        repo('acme/api', {
          dependabotStatus: 'paused',
          openAlertSeverities: ['high', 'high'],
        }),
      ],
      { target_repos: ['acme/api'] },
    );
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]!.title).toBe(
      '2 Dependabot alerts past remediation SLA on api (paused)',
    );
    expect(result.failed[0]!.description).toContain('Paused Dependabot');
  });

  it('passes (paused) when no alerts are open', async () => {
    const result = await runCheck(
      [repo('acme/api', { dependabotStatus: 'paused', openAlertSeverities: [] })],
      { target_repos: ['acme/api'] },
    );
    expect(result.passed).toHaveLength(1);
    expect(result.passed[0]!.title).toBe('Dependabot enabled on api (paused)');
  });

  it('fails with "not enabled" when Dependabot is disabled', async () => {
    const result = await runCheck(
      [
        repo('acme/api', {
          dependabotStatus: 'disabled',
          openAlertSeverities: ['critical'],
        }),
      ],
      { target_repos: ['acme/api'] },
    );
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]!.title).toBe('Dependabot not enabled on api');
  });

  it('passes when alert fetch fails (null alertCounts) and Dependabot is enabled', async () => {
    // No alert signal -> do not regress to a false-fail.
    const result = await runCheck([repo('acme/api', { alertsFetchFails: true })], {
      target_repos: ['acme/api'],
    });
    expect(result.passed).toHaveLength(1);
    expect(result.failed).toEqual([]);
  });

  it('ignores a stale alert_severity_threshold stored on older connections', async () => {
    const result = await runCheck([repo('acme/api', { openAlertSeverities: ['high'] })], {
      target_repos: ['acme/api'],
      alert_severity_threshold: 'critical',
    });
    expect(result.failed).toHaveLength(1);
  });
});

describe('highestSeverityOf', () => {
  it('returns the highest severity present, defaulting to low when empty', () => {
    expect(highestSeverityOf(['high', 'critical', 'low'])).toBe('critical');
    expect(highestSeverityOf(['medium', 'low'])).toBe('medium');
    expect(highestSeverityOf([])).toBe('low');
  });
});
