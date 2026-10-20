/**
 * Remediation SLA helpers for the Dependabot check.
 * An open alert only counts against the check once it is older than the SLA
 * for its severity, so freshly reported alerts get time to be fixed.
 */

import { DEFAULT_SLA_DAYS, MAX_SLA_DAYS, type SlaDays } from '../dependabot-sla-defaults';
import type { GitHubDependabotAlert } from '../types';
import { alertSeverityOf, type AlertSeverity } from './dependabot-alert-severity';

export { DEFAULT_SLA_DAYS, MAX_SLA_DAYS, type SlaDays };

const DAY_MS = 24 * 60 * 60 * 1000;

/** How many of the most overdue alerts are listed individually in evidence. */
export const EVIDENCE_ALERT_LIMIT = 10;

export interface AlertSlaTiming {
  number: number;
  severity: AlertSeverity;
  package: string | null;
  advisory: string | null;
  url: string | null;
  created_at: string | null;
  sla_days: number;
  /** Remediation deadline (created_at + SLA); null when created_at is unreadable. */
  due_at: string | null;
  /**
   * Whole days relative to due_at, always rounded up: positive is days past
   * the deadline (1 hour late is 1), zero or negative is days still left,
   * rounded down. Null when created_at is unreadable.
   */
  days_overdue: number | null;
  breached: boolean;
}

/**
 * 0 is an explicit strict mode: every open alert at that severity
 * fails immediately, matching the check's behavior before SLAs existed.
 * Fractions between 0 and 1 would floor to 0 and turn strict mode on by
 * accident, so they fall back to the default like other invalid values.
 */
const toSlaDays = (value: unknown, fallback: number): number => {
  const parsed = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof parsed !== 'number' || !Number.isFinite(parsed)) return fallback;
  if (parsed === 0) return 0;
  if (parsed < 1) return fallback;
  return Math.min(Math.floor(parsed), MAX_SLA_DAYS);
};

/**
 * Build the per-severity SLA from check variables, falling back to the
 * defaults for anything missing or invalid.
 */
export const resolveSlaDays = (variables: Record<string, unknown>): SlaDays => ({
  critical: toSlaDays(variables.dependabot_sla_days_critical, DEFAULT_SLA_DAYS.critical),
  high: toSlaDays(variables.dependabot_sla_days_high, DEFAULT_SLA_DAYS.high),
  medium: toSlaDays(variables.dependabot_sla_days_medium, DEFAULT_SLA_DAYS.medium),
  low: toSlaDays(variables.dependabot_sla_days_low, DEFAULT_SLA_DAYS.low),
});

const dueMs = (timing: AlertSlaTiming): number =>
  timing.due_at === null ? Number.NEGATIVE_INFINITY : Date.parse(timing.due_at);

/**
 * Breached before within SLA, undated breaches first (their lateness is
 * unknown), then earliest deadline first, which is most overdue first.
 * Alert number breaks exact ties so the order never depends on GitHub's.
 */
const compareWorstFirst = (a: AlertSlaTiming, b: AlertSlaTiming): number =>
  Number(b.breached) - Number(a.breached) || dueMs(a) - dueMs(b) || a.number - b.number;

/**
 * Compute SLA timing for every open alert. Every severity is evaluated; a
 * long SLA is how a severity is effectively deprioritized.
 * An alert is breached once now passes its due_at, so a high alert 30 days
 * and 1 hour old is past a 30 day SLA. Alerts with an unreadable created_at
 * are treated as breached so a data problem can never hide an old alert.
 */
export const evaluateAlertSla = ({
  openAlerts,
  slaDays,
  now,
}: {
  openAlerts: GitHubDependabotAlert[];
  slaDays: SlaDays;
  now: Date;
}): AlertSlaTiming[] =>
  openAlerts
    .map((alert) => ({ alert, severity: alertSeverityOf(alert) }))
    .map(({ alert, severity }) => {
      const sla = slaDays[severity];
      const createdMs = alert.created_at ? Date.parse(alert.created_at) : Number.NaN;
      const rawDue = Number.isNaN(createdMs) ? Number.NaN : createdMs + sla * DAY_MS;
      // An out-of-range deadline (e.g. a corrupt created_at far in the future)
      // is treated like an unreadable date rather than throwing.
      const due = Number.isNaN(new Date(rawDue).getTime()) ? null : rawDue;
      // Verdict compares exact milliseconds; days_overdue is for display only.
      // A 0 day SLA is strict mode: breached even at the instant it opens.
      const breached = due === null || sla === 0 || now.getTime() > due;
      const overdue = due === null ? null : Math.ceil((now.getTime() - due) / DAY_MS);

      return {
        number: alert.number,
        severity,
        package: alert.dependency?.package?.name ?? null,
        advisory: alert.security_advisory?.cve_id ?? alert.security_advisory?.ghsa_id ?? null,
        url: alert.html_url ?? null,
        created_at: alert.created_at ?? null,
        sla_days: sla,
        due_at: due === null ? null : new Date(due).toISOString(),
        // Normalize -0 from Math.ceil so evidence never shows "-0".
        days_overdue: overdue === 0 ? 0 : overdue,
        breached,
      };
    })
    .sort(compareWorstFirst);

export const formatSlaPolicy = (slaDays: SlaDays): string =>
  `critical ${slaDays.critical}d, high ${slaDays.high}d, medium ${slaDays.medium}d, low ${slaDays.low}d`;

const plural = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? '' : 's'}`;

/**
 * One line describing the most overdue breach, e.g.
 * "Most overdue: #12 (high) is 15 days past its 30 day SLA (due 2026-09-21)."
 * Ranked by deadline, not age, so it may not be the oldest alert.
 */
export const describeWorstBreach = (breaches: AlertSlaTiming[]): string => {
  // Prefer the most overdue dated alert; undated ones sort first but say less.
  const worst = breaches.find((timing) => timing.due_at !== null) ?? breaches[0];
  if (!worst) return '';
  if (worst.due_at === null || worst.days_overdue === null) {
    return `Alert #${worst.number} (${worst.severity}) has no readable creation date and is treated as past SLA.`;
  }
  // Only a strict mode alert checked at the instant it opened sits at 0.
  const pastText = worst.days_overdue < 1 ? 'less than a day' : plural(worst.days_overdue, 'day');
  return `Most overdue: #${worst.number} (${worst.severity}) is ${pastText} past its ${worst.sla_days} day SLA (due ${worst.due_at.slice(0, 10)}).`;
};

/** Note for a passing result whose open alerts are all still within SLA. */
export const describeWithinSla = (withinSla: AlertSlaTiming[]): string => {
  const next = withinSla.reduce<AlertSlaTiming | undefined>(
    (soonest, timing) => (!soonest || dueMs(timing) < dueMs(soonest) ? timing : soonest),
    undefined,
  );
  if (!next || next.days_overdue === null) return '';
  const alerts = plural(withinSla.length, 'open alert');
  const daysLeft = -next.days_overdue;
  const dueIn = daysLeft < 1 ? 'less than a day' : plural(daysLeft, 'day');
  return `${alerts} within remediation SLA. Next due: #${next.number} (${next.severity}) in ${dueIn}.`;
};
