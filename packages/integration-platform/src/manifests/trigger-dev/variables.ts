/**
 * Variables for the Trigger.dev integration, plus the parsers that read them.
 *
 * Variable values round-trip through the database, so a number can come back as the
 * string `"3"` and a multi-select as `undefined` — every parser here normalises
 * defensively and falls back to the default rather than trusting the declared type.
 */

import type { CheckVariable, CheckVariableValues } from '../../types';
import type { TriggerOrganization } from './types';

export const DEFAULT_MAX_ADMINS = 3;
export const DEFAULT_PENDING_INVITE_MAX_AGE_DAYS = 30;
export const DEFAULT_RUN_LOOKBACK_DAYS = 7;
export const DEFAULT_MAX_FAILURE_RATE_PERCENT = 25;
export const DEFAULT_MIN_RUNS_FOR_FAILURE_RATE = 10;

/**
 * Which Trigger.dev organizations to review. Empty means every organization the token
 * can see: a token normally belongs to one company's account, and silently checking
 * none would read as "no findings".
 */
export const targetOrganizationsVariable: CheckVariable = {
  id: 'target_organizations',
  label: 'Organizations to check',
  type: 'multi-select',
  required: false,
  helpText: 'Leave empty to check every Trigger.dev organization this token can access.',
  fetchOptions: async (ctx) => {
    try {
      const orgs = await ctx.fetch<TriggerOrganization[]>('/api/v1/orgs');
      return (orgs ?? []).map((org) => ({ value: org.id, label: org.title || org.slug }));
    } catch {
      return [];
    }
  },
};

export const corporateEmailDomainsVariable: CheckVariable = {
  id: 'corporate_email_domains',
  label: 'Corporate email domains',
  type: 'text',
  required: false,
  placeholder: 'acme.com, acme.io',
  helpText:
    'Comma-separated domains your Trigger.dev accounts must use. Leave empty to use the domains of the active people in your People directory.',
};

export const maxAdminsVariable: CheckVariable = {
  id: 'max_admins',
  label: 'Maximum number of Admins',
  type: 'number',
  required: false,
  default: DEFAULT_MAX_ADMINS,
  helpText:
    'Organizations with more members holding the Admin role than this are flagged. Admins can invite people, manage billing and delete projects.',
};

export const pendingInviteMaxAgeDaysVariable: CheckVariable = {
  id: 'pending_invite_max_age_days',
  label: 'Pending invite age limit (days)',
  type: 'number',
  required: false,
  default: DEFAULT_PENDING_INVITE_MAX_AGE_DAYS,
  helpText:
    'Open invitations older than this are flagged. An invitation nobody accepts is standing access for someone who may have already left.',
};

export const runLookbackDaysVariable: CheckVariable = {
  id: 'run_lookback_days',
  label: 'Run history window (days)',
  type: 'number',
  required: false,
  default: DEFAULT_RUN_LOOKBACK_DAYS,
  helpText: 'How many days of production runs to use when measuring the failure rate.',
};

export const maxFailureRatePercentVariable: CheckVariable = {
  id: 'max_failure_rate_percent',
  label: 'Maximum production failure rate (%)',
  type: 'number',
  required: false,
  default: DEFAULT_MAX_FAILURE_RATE_PERCENT,
  helpText:
    'Flag a project when more than this share of its finished production runs failed, crashed or timed out in the window.',
};

export const minRunsForFailureRateVariable: CheckVariable = {
  id: 'min_runs_for_failure_rate',
  label: 'Minimum runs before judging failure rate',
  type: 'number',
  required: false,
  default: DEFAULT_MIN_RUNS_FOR_FAILURE_RATE,
  helpText:
    'Below this many finished runs the failure rate is recorded as evidence only, so two failures out of three do not fail the check. Set 0 to always judge it.',
};

interface NumberVariableRead {
  variables: CheckVariableValues | undefined;
  id: string;
  fallback: number;
}

/**
 * An integer of at least `min` (default 1), or the fallback when the stored value is
 * missing or nonsense. Pass `min: 0` where zero is a meaningful setting.
 */
export function parseInteger({
  variables,
  id,
  fallback,
  min = 1,
}: NumberVariableRead & { min?: number }): number {
  const raw = variables?.[id];
  const parsed = typeof raw === 'number' ? raw : Number.parseInt(String(raw ?? ''), 10);
  return Number.isFinite(parsed) && parsed >= min ? Math.floor(parsed) : fallback;
}

/** Percentages accept 0 (no failures tolerated) and cap at 100. */
export function parsePercent({ variables, id, fallback }: NumberVariableRead): number {
  const raw = variables?.[id];
  const parsed = typeof raw === 'number' ? raw : Number.parseFloat(String(raw ?? ''));
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 100 ? parsed : fallback;
}

function parseList(value: CheckVariableValues[string]): string[] {
  const parts = Array.isArray(value) ? value : String(value ?? '').split(/[\s,;]+/);
  return parts.map((part) => String(part).trim().toLowerCase()).filter(Boolean);
}

/**
 * Configured corporate domains. Tolerates entries written as `@acme.com` or
 * `https://acme.com`, which is how people actually fill this field in.
 */
export function parseCorporateDomains(variables: CheckVariableValues | undefined): Set<string> {
  return new Set(
    parseList(variables?.[corporateEmailDomainsVariable.id])
      .map((domain) =>
        domain
          .replace(/^https?:\/\//, '')
          .replace(/^@/, '')
          .replace(/\/.*$/, ''),
      )
      .filter(Boolean),
  );
}

export function parseTargetOrganizations(variables: CheckVariableValues | undefined): Set<string> {
  return new Set(parseList(variables?.[targetOrganizationsVariable.id]));
}
