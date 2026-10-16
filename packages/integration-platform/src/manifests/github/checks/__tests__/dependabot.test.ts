import { describe, expect, it } from 'bun:test';
import {
  countAtOrAboveSeverity,
  highestPresentSeverity,
  resolveSeverityThreshold,
  thresholdLabel,
} from '../dependabot-alert-severity';
import { repo, runCheck, type AlertSeverity } from './dependabot-harness';

describe('dependabotCheck severity gating', () => {
  it('passes when Dependabot is enabled and there are zero open alerts', async () => {
    const result = await runCheck([repo('acme/api')], {
      target_repos: ['acme/api'],
    });
    expect(result.passed.map((p) => p.title)).toEqual(['Dependabot enabled on api']);
    expect(result.failed).toEqual([]);
  });

  it('fails when Dependabot is enabled but open high alerts exist (default threshold)', async () => {
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
    expect(result.failed[0]!.description).toContain(
      '8 open high severity or above alerts are past the remediation SLA',
    );
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

  it('passes when only medium alerts exist and default threshold is high', async () => {
    const result = await runCheck(
      [
        repo('acme/api', {
          openAlertSeverities: ['medium', 'medium', 'low'],
        }),
      ],
      { target_repos: ['acme/api'] },
    );
    expect(result.passed).toHaveLength(1);
    expect(result.failed).toEqual([]);
  });

  it('passes when threshold is critical and only high alerts exist', async () => {
    const result = await runCheck([repo('acme/api', { openAlertSeverities: ['high', 'high'] })], {
      target_repos: ['acme/api'],
      alert_severity_threshold: 'critical',
    });
    expect(result.passed).toHaveLength(1);
    expect(result.failed).toEqual([]);
  });

  it('fails when threshold is low and any alert exists', async () => {
    const result = await runCheck([repo('acme/api', { openAlertSeverities: ['low'] })], {
      target_repos: ['acme/api'],
      alert_severity_threshold: 'low',
    });
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]!.title).toBe('1 Dependabot alert past remediation SLA on api');
    expect(result.failed[0]!.description).toContain(
      '1 open any severity alert is past the remediation SLA',
    );
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

  it('passes (paused) when no threshold alerts exist', async () => {
    const result = await runCheck(
      [repo('acme/api', { dependabotStatus: 'paused', openAlertSeverities: [] })],
      { target_repos: ['acme/api'] },
    );
    expect(result.passed).toHaveLength(1);
    expect(result.passed[0]!.title).toBe('Dependabot enabled on api (paused)');
  });

  it('fails with generic "not enabled" message when Dependabot is disabled, ignoring threshold', async () => {
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

  it('handles unknown threshold by falling back to "high"', async () => {
    const result = await runCheck([repo('acme/api', { openAlertSeverities: ['high'] })], {
      target_repos: ['acme/api'],
      alert_severity_threshold: 'bogus',
    });
    expect(result.failed).toHaveLength(1);
  });
});

describe('dependabot severity helpers', () => {
  it('countAtOrAboveSeverity sums the right buckets per threshold', () => {
    const counts = { critical: 2, high: 3, medium: 5, low: 7 };
    expect(countAtOrAboveSeverity(counts, 'critical')).toBe(2);
    expect(countAtOrAboveSeverity(counts, 'high')).toBe(5);
    expect(countAtOrAboveSeverity(counts, 'medium')).toBe(10);
    expect(countAtOrAboveSeverity(counts, 'low')).toBe(17);
  });

  it('highestPresentSeverity returns the highest bucket with a non-zero count', () => {
    expect(highestPresentSeverity({ critical: 1, high: 5, medium: 0, low: 0 })).toBe('critical');
    expect(highestPresentSeverity({ critical: 0, high: 5, medium: 0, low: 0 })).toBe('high');
    expect(highestPresentSeverity({ critical: 0, high: 0, medium: 2, low: 1 })).toBe('medium');
    expect(highestPresentSeverity({ critical: 0, high: 0, medium: 0, low: 0 })).toBe('low');
  });

  it('resolveSeverityThreshold normalizes invalid input to "high"', () => {
    expect(resolveSeverityThreshold(undefined)).toBe('high');
    expect(resolveSeverityThreshold('')).toBe('high');
    expect(resolveSeverityThreshold('BOGUS')).toBe('high');
    expect(resolveSeverityThreshold('critical')).toBe('critical');
    expect(resolveSeverityThreshold('low')).toBe('low');
  });

  it('thresholdLabel humanizes each level', () => {
    expect(thresholdLabel('critical')).toBe('critical severity or above');
    expect(thresholdLabel('high')).toBe('high severity or above');
    expect(thresholdLabel('medium')).toBe('medium severity or above');
    expect(thresholdLabel('low')).toBe('any severity');
  });
});
