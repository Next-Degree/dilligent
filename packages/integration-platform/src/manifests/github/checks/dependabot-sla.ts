/**
 * Remediation-SLA helpers for the Dependabot vulnerability check.
 *
 * A Vulnerability & Patch Management policy does not say "never have an open
 * alert" — it says "fix critical ones within N days and high ones within M".
 * These helpers turn an alert's `created_at` into an age, compare it to the
 * configured window, and report which alerts are past due.
 *
 * Pure functions only, so the SLA arithmetic is testable without the GitHub
 * fetch layer.
 */

import type { GitHubDependabotAlert } from '../types';

/** Severities the SLA applies to. Medium and low are informational here. */
export type SlaSeverity = 'critical' | 'high';

export interface SlaConfig {
  critical: number;
  high: number;
}

/**
 * Defaults are deliberately conservative relative to common policy language
 * (critical within 15 days, high within 30). Organizations override both from
 * the connection settings to match whatever their own policy commits to.
 */
export const DEFAULT_CRITICAL_SLA_DAYS = 15;
export const DEFAULT_HIGH_SLA_DAYS = 30;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Normalize a configured SLA window into a whole number of days.
 *
 * Blank, non-numeric, and negative values fall back to the default rather than
 * silently becoming zero, which would fail every repository the moment an alert
 * appeared. Zero is preserved and means "no grace period".
 */
export const resolveSlaDays = (raw: unknown, fallback: number): number => {
  // Number('') and Number(null) are both 0, so an untouched form field would
  // otherwise read as "no grace period" and fail every repository.
  if (raw === undefined || raw === null || raw === '') return fallback;
  const parsed = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.floor(parsed);
};

/** Read both SLA windows off the check's configured variables. */
export const resolveSlaConfig = (variables: Record<string, unknown>): SlaConfig => ({
  critical: resolveSlaDays(variables.critical_remediation_sla_days, DEFAULT_CRITICAL_SLA_DAYS),
  high: resolveSlaDays(variables.high_remediation_sla_days, DEFAULT_HIGH_SLA_DAYS),
});

/**
 * Whole days an alert has been open. Unparseable timestamps return `null` so
 * callers can treat the age as unknown instead of as zero.
 */
export const ageInDays = (createdAt: string | undefined, now: Date): number | null => {
  if (!createdAt) return null;
  const created = new Date(createdAt).getTime();
  if (Number.isNaN(created)) return null;
  return Math.floor((now.getTime() - created) / MS_PER_DAY);
};

export interface TrackedAlert {
  number: number;
  severity: SlaSeverity;
  packageName: string;
  advisory: string;
  htmlUrl: string;
  createdAt: string;
  ageDays: number;
  slaDays: number;
  /** Days past the deadline. Zero or negative while still within SLA. */
  overdueDays: number;
}

export interface SlaClassification {
  /** Open critical/high alerts whose age exceeds their SLA window. */
  breaching: TrackedAlert[];
  /** Open critical/high alerts still inside their SLA window. */
  withinSla: TrackedAlert[];
  /** Alerts we could not age because `created_at` was missing or unparseable. */
  undated: number;
}

const SLA_SEVERITIES: ReadonlySet<string> = new Set<SlaSeverity>(['critical', 'high']);

/**
 * Split open alerts into those past their remediation deadline and those still
 * inside it. Only critical and high alerts are tracked; anything below is left
 * to the severity-threshold check.
 */
export const classifyAlertsBySla = ({
  alerts,
  sla,
  now,
}: {
  alerts: GitHubDependabotAlert[];
  sla: SlaConfig;
  now: Date;
}): SlaClassification => {
  const breaching: TrackedAlert[] = [];
  const withinSla: TrackedAlert[] = [];
  let undated = 0;

  for (const alert of alerts) {
    const severity = alert.security_vulnerability?.severity ?? alert.security_advisory?.severity;
    if (!severity || !SLA_SEVERITIES.has(severity)) continue;

    const ageDays = ageInDays(alert.created_at, now);
    if (ageDays === null) {
      undated++;
      continue;
    }

    const slaDays = severity === 'critical' ? sla.critical : sla.high;
    const tracked: TrackedAlert = {
      number: alert.number,
      severity: severity as SlaSeverity,
      packageName: alert.dependency?.package?.name ?? 'unknown package',
      advisory: alert.security_advisory?.ghsa_id ?? alert.security_advisory?.cve_id ?? 'advisory',
      htmlUrl: alert.html_url ?? '',
      createdAt: alert.created_at,
      ageDays,
      slaDays,
      overdueDays: ageDays - slaDays,
    };

    if (tracked.overdueDays > 0) breaching.push(tracked);
    else withinSla.push(tracked);
  }

  // Worst breach first, so the finding title and evidence lead with the alert
  // that has been outstanding the longest.
  breaching.sort((a, b) => b.overdueDays - a.overdueDays);
  return { breaching, withinSla, undated };
};

/** `critical` when any breaching alert is critical, otherwise `high`. */
export const breachSeverity = (breaching: TrackedAlert[]): 'critical' | 'high' =>
  breaching.some((alert) => alert.severity === 'critical') ? 'critical' : 'high';

/** Human summary of the configured windows, e.g. "critical 15 days, high 30 days". */
export const describeSla = (sla: SlaConfig): string =>
  `critical ${sla.critical} ${sla.critical === 1 ? 'day' : 'days'}, high ${sla.high} ${
    sla.high === 1 ? 'day' : 'days'
  }`;
