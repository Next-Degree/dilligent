/**
 * Remediation SLA helpers for the Dependabot check.
 * An open alert only counts against the check once it is older than the SLA
 * for its severity, so freshly reported alerts get time to be fixed.
 */

import type { GitHubDependabotAlert } from '../types';
import { isAtOrAboveSeverity, type AlertSeverity } from './dependabot-alert-severity';

export type SlaDays = Record<AlertSeverity, number>;

/**
 * Defaults match the Vulnerability & Patch Management policy template
 * (critical 7, high 30, medium 90). The template leaves low at "next
 * maintenance window", so low gets a generous fixed window.
 */
export const DEFAULT_SLA_DAYS: SlaDays = {
  critical: 7,
  high: 30,
  medium: 90,
  low: 180,
};

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
  /** Whole days since the alert was opened; null when created_at is unreadable. */
  age_days: number | null;
  sla_days: number;
  /** Days remaining before the SLA is breached; 0 once breached. */
  days_until_due: number;
  /** Days beyond the SLA; 0 while still within it. */
  days_past_sla: number;
  breached: boolean;
}

const toPositiveDays = (value: unknown, fallback: number): number => {
  const parsed = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  // Below 1 would floor to a 0 day SLA and fail every alert immediately.
  if (typeof parsed !== 'number' || !Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }
  return Math.floor(parsed);
};

/**
 * Build the per-severity SLA from check variables, falling back to the
 * defaults for anything missing or invalid.
 */
export const resolveSlaDays = (variables: Record<string, unknown>): SlaDays => ({
  critical: toPositiveDays(variables.sla_days_critical, DEFAULT_SLA_DAYS.critical),
  high: toPositiveDays(variables.sla_days_high, DEFAULT_SLA_DAYS.high),
  medium: toPositiveDays(variables.sla_days_medium, DEFAULT_SLA_DAYS.medium),
  low: toPositiveDays(variables.sla_days_low, DEFAULT_SLA_DAYS.low),
});

/**
 * Breached before within SLA, undated breaches first (their lateness is
 * unknown), then most days past SLA, then soonest due.
 */
const compareWorstFirst = (a: AlertSlaTiming, b: AlertSlaTiming): number =>
  Number(b.breached) - Number(a.breached) ||
  Number(b.age_days === null) - Number(a.age_days === null) ||
  b.days_past_sla - a.days_past_sla ||
  a.days_until_due - b.days_until_due;

/**
 * Compute SLA timing for every open alert at or above the threshold.
 * An alert is breached once its exact age exceeds the SLA, so a high alert
 * 30 days and 1 hour old is past a 30 day SLA. Alerts with an unreadable created_at are
 * treated as breached so a data problem can never hide an old alert.
 */
export const evaluateAlertSla = ({
  openAlerts,
  threshold,
  slaDays,
  now,
}: {
  openAlerts: GitHubDependabotAlert[];
  threshold: AlertSeverity;
  slaDays: SlaDays;
  now: Date;
}): AlertSlaTiming[] =>
  openAlerts
    .map((alert) => ({ alert, severity: alert.security_vulnerability?.severity ?? 'low' }))
    .filter(({ severity }) => isAtOrAboveSeverity(severity, threshold))
    .map(({ alert, severity }) => {
      const sla = slaDays[severity];
      const createdMs = alert.created_at ? Date.parse(alert.created_at) : Number.NaN;
      const ageMs = Number.isNaN(createdMs) ? null : Math.max(0, now.getTime() - createdMs);
      // Verdict uses exact elapsed time; whole days are for display only.
      const breached = ageMs === null || ageMs > sla * DAY_MS;
      const ageDays = ageMs === null ? null : Math.floor(ageMs / DAY_MS);

      return {
        number: alert.number,
        severity,
        package: alert.dependency?.package?.name ?? null,
        advisory: alert.security_advisory?.cve_id ?? alert.security_advisory?.ghsa_id ?? null,
        url: alert.html_url ?? null,
        created_at: alert.created_at ?? null,
        age_days: ageDays,
        sla_days: sla,
        days_until_due: breached || ageDays === null ? 0 : sla - ageDays,
        // A partial day past the deadline still reads as 1 day past.
        days_past_sla: !breached || ageDays === null ? 0 : Math.max(1, ageDays - sla),
        breached,
      };
    })
    .sort(compareWorstFirst);

export const formatSlaPolicy = (slaDays: SlaDays): string =>
  `critical ${slaDays.critical}d, high ${slaDays.high}d, medium ${slaDays.medium}d, low ${slaDays.low}d`;

const plural = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? '' : 's'}`;

/** One line describing the worst breach, e.g. "Oldest: #12 (high) is 45 days old, 15 days past its 30 day SLA." */
export const describeWorstBreach = (breaches: AlertSlaTiming[]): string => {
  // Prefer the most overdue dated alert; undated ones sort first but say less.
  const worst = breaches.find((timing) => timing.age_days !== null) ?? breaches[0];
  if (!worst) return '';
  if (worst.age_days === null) {
    return `Alert #${worst.number} (${worst.severity}) has no readable creation date and is treated as past SLA.`;
  }
  return `Oldest: #${worst.number} (${worst.severity}) is ${plural(worst.age_days, 'day')} old, ${plural(worst.days_past_sla, 'day')} past its ${worst.sla_days} day SLA.`;
};

/** Note for a passing result whose open alerts are all still within SLA. */
export const describeWithinSla = (withinSla: AlertSlaTiming[]): string => {
  const next = withinSla.reduce<AlertSlaTiming | undefined>(
    (soonest, timing) =>
      !soonest || timing.days_until_due < soonest.days_until_due ? timing : soonest,
    undefined,
  );
  if (!next) return '';
  const alerts = plural(withinSla.length, 'open alert');
  return `${alerts} within remediation SLA. Next due: #${next.number} (${next.severity}) in ${plural(next.days_until_due, 'day')}.`;
};
