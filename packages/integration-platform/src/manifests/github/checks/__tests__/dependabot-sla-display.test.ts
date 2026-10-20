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
    slaDays: DEFAULT_SLA_DAYS,
    now: NOW,
  });

describe('countdown never overstates time left', () => {
  it('reports 0 whole days left with under a day to go', () => {
    const [timing] = evaluateOne(agedMs(29 * DAY_MS + 23 * HOUR_MS));
    expect(timing!.breached).toBe(false);
    expect(timing!.days_overdue).toBe(0);
    expect(describeWithinSla([timing!])).toBe(
      '1 open alert within remediation SLA. Next due: #7 (high) in less than a day.',
    );
  });

  it('never overstates time left on a partial day', () => {
    const [timing] = evaluateOne(agedMs(25 * DAY_MS + HOUR_MS));
    expect(timing!.days_overdue).toBe(-4);
    expect(describeWithinSla([timing!])).toContain('in 4 days.');
  });
});

describe('days past SLA use one rounding rule (always up)', () => {
  it('counts 1 hour late as 1 day past and records the deadline', () => {
    const breaches = evaluateOne(agedMs(30 * DAY_MS + HOUR_MS));
    expect(breaches[0]!.due_at).toBe('2026-10-06T11:00:00.000Z');
    expect(breaches[0]!.days_overdue).toBe(1);
    expect(describeWorstBreach(breaches)).toBe(
      'Most overdue: #7 (high) is 1 day past its 30 day SLA (due 2026-10-06).',
    );
  });

  it('counts 2 days and 1 hour late as 3 days past', () => {
    const breaches = evaluateOne(agedMs(32 * DAY_MS + HOUR_MS));
    expect(breaches[0]!.days_overdue).toBe(3);
    expect(describeWorstBreach(breaches)).toBe(
      'Most overdue: #7 (high) is 3 days past its 30 day SLA (due 2026-10-04).',
    );
  });
});

describe('most overdue is ranked by deadline, not age or rounded days', () => {
  it('names the critical alert further past its SLA over an older high alert', () => {
    const breaches = evaluateAlertSla({
      openAlerts: [
        makeAlert('high', { number: 1, createdAt: agedMs(40 * DAY_MS + HOUR_MS) }),
        makeAlert('critical', { number: 2, createdAt: agedMs(20 * DAY_MS + HOUR_MS) }),
      ],
      slaDays: DEFAULT_SLA_DAYS,
      now: NOW,
    });
    expect(describeWorstBreach(breaches)).toBe(
      'Most overdue: #2 (critical) is 14 days past its 7 day SLA (due 2026-09-23).',
    );
  });

  it('breaks ties that whole days would hide (46h late beats 1h late)', () => {
    const breaches = evaluateAlertSla({
      openAlerts: [
        makeAlert('critical', { number: 1, createdAt: agedMs(7 * DAY_MS + HOUR_MS) }),
        makeAlert('high', { number: 2, createdAt: agedMs(30 * DAY_MS + 46 * HOUR_MS) }),
      ],
      slaDays: DEFAULT_SLA_DAYS,
      now: NOW,
    });
    expect(breaches.map((t) => t.number)).toEqual([2, 1]);
    expect(describeWorstBreach(breaches)).toBe(
      'Most overdue: #2 (high) is 2 days past its 30 day SLA (due 2026-10-04).',
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
