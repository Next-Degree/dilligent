/**
 * Dependabot remediation SLA constants, shared by the check and the
 * connection variables so neither depends on the other.
 */

export type SlaDays = Record<'critical' | 'high' | 'medium' | 'low', number>;

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

/**
 * Upper bound for any SLA setting (100 years). Larger values are clamped so
 * "a very long SLA" stays very long without pushing deadlines past the
 * JavaScript date range, where toISOString() throws.
 */
export const MAX_SLA_DAYS = 36_500;
