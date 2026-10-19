/**
 * Severity helpers for the Dependabot check.
 * Kept in a separate module so the main check file stays focused and the
 * helpers can be unit-tested independently of the NestJS/GitHub fetch layer.
 */

import type { FindingSeverity } from '../../../types';

export type AlertSeverity = 'critical' | 'high' | 'medium' | 'low';

export interface AlertCounts {
  open: number;
  dismissed: number;
  fixed: number;
  total: number;
  bySeverity: Record<AlertSeverity, number>;
}

/**
 * An alert's severity, treating a missing one as critical so bad data gets
 * the shortest SLA instead of the longest (same fail-safe as a missing
 * created_at).
 */
export const alertSeverityOf = (alert: {
  security_vulnerability?: { severity?: AlertSeverity } | null;
}): AlertSeverity => alert.security_vulnerability?.severity ?? 'critical';

const SEVERITY_RANK: Record<AlertSeverity, number> = { low: 0, medium: 1, high: 2, critical: 3 };

/**
 * Highest severity among a set of alerts, used to set the severity of the
 * emitted ctx.fail finding when only some alerts are past SLA.
 */
export const highestSeverityOf = (severities: AlertSeverity[]): FindingSeverity =>
  severities.reduce<AlertSeverity>(
    (highest, severity) => (SEVERITY_RANK[severity] > SEVERITY_RANK[highest] ? severity : highest),
    'low',
  );

/** e.g. "3 open (1 critical, 2 high), 4 fixed, 0 dismissed" */
export const formatAlertSummary = (counts: AlertCounts): string => {
  const parts: string[] = [];

  if (counts.open > 0) {
    const severityBreakdown = (['critical', 'high', 'medium', 'low'] as const)
      .filter((severity) => counts.bySeverity[severity] > 0)
      .map((severity) => `${counts.bySeverity[severity]} ${severity}`);
    parts.push(`${counts.open} open (${severityBreakdown.join(', ')})`);
  } else {
    parts.push('0 open');
  }

  parts.push(`${counts.fixed} fixed`);
  parts.push(`${counts.dismissed} dismissed`);

  return parts.join(', ');
};
