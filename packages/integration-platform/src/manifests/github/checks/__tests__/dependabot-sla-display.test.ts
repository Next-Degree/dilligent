import { describe, expect, it } from 'bun:test';
import {
  DEFAULT_SLA_DAYS,
  describeWithinSla,
  describeWorstBreach,
  evaluateAlertSla,
} from '../dependabot-alert-sla';
import { makeAlert, repo, runCheck } from './dependabot-harness';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const NOW = new Date('2026-10-06T12:00:00Z');
const agedMs = (ms: number): string => new Date(NOW.getTime() - ms).toISOString();

const evaluateOne = (createdAt: string) =>
  evaluateAlertSla({
    openAlerts: [makeAlert('high', { number: 7, createdAt })],
    threshold: 'high',
    slaDays: DEFAULT_SLA_DAYS,
    now: NOW,
  });

describe('SLA countdown rounds down', () => {
  it('reports 0 whole days left with under a day to go', () => {
    const [timing] = evaluateOne(agedMs(29 * DAY_MS + 23 * HOUR_MS));
    expect(timing!.breached).toBe(false);
    expect(timing!.days_until_due).toBe(0);
    expect(describeWithinSla([timing!])).toBe(
      '1 open alert within remediation SLA. Next due: #7 (high) in less than a day.',
    );
  });

  it('never overstates time left on a partial day', () => {
    const [timing] = evaluateOne(agedMs(25 * DAY_MS + HOUR_MS));
    expect(timing!.days_until_due).toBe(4);
    expect(describeWithinSla([timing!])).toContain('in 4 days.');
  });
});

describe('overdue wording within the first day past SLA', () => {
  it('says "less than a day past" instead of contradictory whole days', () => {
    const breaches = evaluateOne(agedMs(30 * DAY_MS + HOUR_MS));
    expect(breaches[0]!.days_past_sla).toBe(1);
    expect(describeWorstBreach(breaches)).toBe(
      'Oldest: #7 (high) is 30 days old, less than a day past its 30 day SLA.',
    );
  });

  it('uses whole days once a full day past', () => {
    const breaches = evaluateOne(agedMs(32 * DAY_MS + HOUR_MS));
    expect(describeWorstBreach(breaches)).toBe(
      'Oldest: #7 (high) is 32 days old, 2 days past its 30 day SLA.',
    );
  });
});

describe('remediation SLA evidence timestamp', () => {
  it('records the instant ages were measured against', async () => {
    const before = Date.now();
    const result = await runCheck(
      [repo('acme/api', { openAlerts: [makeAlert('high', { createdAt: agedMs(DAY_MS) })] })],
      { target_repos: ['acme/api'] },
    );
    const repoEvidence = result.evidence[0]!['acme/api'] as Record<string, unknown>;
    const sla = repoEvidence.remediation_sla as Record<string, unknown>;
    const evaluatedAt = Date.parse(sla.evaluated_at as string);
    expect(evaluatedAt).toBeGreaterThanOrEqual(before);
    expect(evaluatedAt).toBeLessThanOrEqual(Date.parse(repoEvidence.checked_at as string));
  });
});
