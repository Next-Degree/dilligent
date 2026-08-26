import type { CheckVariable, CheckVariableValues } from '../../types';

/**
 * Mailbox names that almost always represent a shared inbox or a bot rather
 * than one person. Used as the default for the configurable variable below.
 */
const DEFAULT_SHARED_LOCAL_PARTS = [
  'admin',
  'billing',
  'deploy',
  'deployments',
  'dev',
  'devops',
  'engineering',
  'hello',
  'info',
  'it',
  'noreply',
  'no-reply',
  'ops',
  'security',
  'support',
  'team',
  'vercel',
];

const DEFAULT_PENDING_INVITE_MAX_AGE_DAYS = 30;

export const corporateEmailDomainsVariable: CheckVariable = {
  id: 'corporate_email_domains',
  label: 'Corporate email domains',
  type: 'text',
  required: false,
  placeholder: 'acme.com, acme.io',
  helpText:
    'Comma-separated domains your company controls. Vercel accounts outside these domains cannot be centrally managed and are flagged. Leave empty to use the domain configured on your Vercel team.',
};

export const sharedAccountLocalPartsVariable: CheckVariable = {
  id: 'shared_account_local_parts',
  label: 'Shared mailbox names',
  type: 'text',
  required: false,
  default: DEFAULT_SHARED_LOCAL_PARTS.join(', '),
  helpText:
    'Comma-separated mailbox names (the part before the @) that indicate a shared account rather than one identifiable person.',
};

export const pendingInviteMaxAgeDaysVariable: CheckVariable = {
  id: 'pending_invite_max_age_days',
  label: 'Pending invite age limit (days)',
  type: 'number',
  required: false,
  default: DEFAULT_PENDING_INVITE_MAX_AGE_DAYS,
  helpText:
    'Open Vercel invitations older than this are flagged. An invitation that is never accepted is standing access for someone who may have already left.',
};

function parseCommaSeparatedList(value: CheckVariableValues[string]): string[] {
  const raw = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [];
  return raw.map((entry) => String(entry).trim().toLowerCase()).filter((entry) => entry.length > 0);
}

/**
 * Domains to treat as corporate: the configured list when set, otherwise the
 * team's own verified domain. An empty result means "unknown" — callers skip
 * the domain finding rather than flagging every account.
 */
export function parseCorporateDomains(
  variables: CheckVariableValues | undefined,
  teamEmailDomain?: string | null,
): string[] {
  const configured = parseCommaSeparatedList(variables?.corporate_email_domains).map((domain) =>
    domain.replace(/^@/, ''),
  );
  if (configured.length > 0) {
    return configured;
  }
  const fallback = teamEmailDomain?.trim().toLowerCase();
  return fallback ? [fallback] : [];
}

export const team2faEnforcedVariable: CheckVariable = {
  id: 'team_2fa_enforced',
  label: 'Team enforces two-factor authentication',
  type: 'boolean',
  required: false,
  default: false,
  helpText:
    'Tick this once Team Settings > Security & Privacy > Two-Factor Authentication Enforcement is on. Vercel does not expose this setting on its REST API, so the check records your confirmation as an attestation rather than observing it.',
};

export function parseSharedAccountLocalParts(
  variables: CheckVariableValues | undefined,
): Set<string> {
  const configured = parseCommaSeparatedList(variables?.shared_account_local_parts);
  return new Set(configured.length > 0 ? configured : DEFAULT_SHARED_LOCAL_PARTS);
}

export function parsePendingInviteMaxAgeDays(variables: CheckVariableValues | undefined): number {
  const raw = variables?.pending_invite_max_age_days;
  const parsed = typeof raw === 'number' ? raw : Number.parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_PENDING_INVITE_MAX_AGE_DAYS;
  }
  return parsed;
}

/**
 * Whether an administrator has confirmed team-wide 2FA enforcement.
 *
 * Defaults to false: an unanswered question is not a compliant answer, so an
 * unconfigured check reports the gap rather than assuming enforcement is on.
 */
export function parseTeam2faEnforced(variables: CheckVariableValues | undefined): boolean {
  const raw = variables?.team_2fa_enforced;
  if (typeof raw === 'boolean') return raw;
  return (
    String(raw ?? '')
      .trim()
      .toLowerCase() === 'true'
  );
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function daysSince(timestampMs: number, nowMs: number): number {
  return Math.floor((nowMs - timestampMs) / MS_PER_DAY);
}

export { DEFAULT_PENDING_INVITE_MAX_AGE_DAYS, DEFAULT_SHARED_LOCAL_PARTS };
