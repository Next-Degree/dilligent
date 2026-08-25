/**
 * Shared variables for the PostHog integration, plus the parsers that read them.
 *
 * Variable values round-trip through the database, so a boolean can come back as the
 * string `"true"` and a multi-select as `undefined` — every parser here normalises
 * defensively rather than trusting the declared type.
 */

import type { CheckVariable, CheckVariableValues } from '../../types';
import type { PostHogOrganizationSummary } from './types';

/**
 * Which PostHog organizations to review. Empty means every organization the key can see,
 * which is the right default: a personal API key is usually scoped to one organization
 * already, and silently checking none would read as "no findings".
 */
export const targetOrganizationsVariable: CheckVariable = {
  id: 'target_organizations',
  label: 'Organizations to check',
  type: 'multi-select',
  required: false,
  helpText: 'Leave empty to check every PostHog organization this API key can access.',
  fetchOptions: async (ctx) => {
    // Options are best-effort: this runs against PostHog Cloud US (the connect form has
    // no access to the host credential yet), so EU and self-hosted connections get an
    // empty list. Leaving the field empty still checks every organization, so an empty
    // list degrades to "check everything" rather than breaking the connect flow.
    try {
      const response = await ctx.fetch<{ results?: PostHogOrganizationSummary[] }>(
        '/api/organizations/?limit=100',
      );
      return (response?.results ?? []).map((org) => ({
        value: org.id,
        label: org.name || org.id,
      }));
    } catch {
      return [];
    }
  },
};

/**
 * Domains a member's email must belong to. Empty disables the domain rule — we cannot
 * guess a customer's corporate domain, and guessing wrong would flag their whole roster.
 */
export const allowedEmailDomainsVariable: CheckVariable = {
  id: 'allowed_email_domains',
  label: 'Approved email domains',
  type: 'text',
  required: false,
  placeholder: 'acme.com, acme.io',
  helpText:
    'Comma-separated list of domains your PostHog accounts must use. Leave empty to skip the domain rule.',
};

export const requireVerifiedEmailVariable: CheckVariable = {
  id: 'require_verified_email',
  label: 'Require verified email addresses',
  type: 'boolean',
  required: false,
  default: true,
  helpText:
    'Fail members whose email PostHog has not verified. Accounts that sign in through SSO always count as verified.',
};

export const includePendingInvitesVariable: CheckVariable = {
  id: 'include_pending_invites',
  label: 'Review pending invitations',
  type: 'boolean',
  required: false,
  default: true,
  helpText:
    'Also review outstanding invitations. Expired invitations and invitations to unapproved domains are reported as findings.',
};

export const treatSsoAsTwoFactorVariable: CheckVariable = {
  id: 'treat_sso_as_2fa',
  label: 'Count SSO sign-in as 2FA',
  type: 'boolean',
  required: false,
  default: true,
  helpText:
    'Treat members who sign in through an SSO provider as covered, because MFA is enforced by the identity provider rather than PostHog.',
};

export const requireOrgEnforcementVariable: CheckVariable = {
  id: 'require_2fa_enforcement',
  label: 'Require organization-wide 2FA enforcement',
  type: 'boolean',
  required: false,
  default: false,
  helpText:
    'Also fail when the PostHog organization does not force every member to enrol in 2FA. Enforcement is a paid PostHog feature, so this is off by default.',
};

/**
 * Reads a boolean variable that may arrive as a real boolean or as its string form.
 * Anything unrecognised falls back rather than being coerced — `"maybe"` must not
 * silently disable a rule the customer switched on.
 */
export function parseBooleanVariable(
  variables: CheckVariableValues | undefined,
  id: string,
  fallback: boolean,
): boolean {
  const value = variables?.[id];
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  }
  return fallback;
}

/**
 * Approved domains as a lowercase set. Accepts commas, whitespace or newlines as
 * separators and tolerates entries written as `@acme.com` or `https://acme.com`, which
 * is how people actually fill this field in.
 */
export function parseAllowedEmailDomains(variables: CheckVariableValues | undefined): Set<string> {
  const raw = variables?.[allowedEmailDomainsVariable.id];
  const parts = Array.isArray(raw) ? raw : String(raw ?? '').split(/[\s,;]+/);

  const domains = new Set<string>();
  for (const part of parts) {
    const domain = String(part)
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/^@/, '')
      .replace(/\/.*$/, '');
    if (domain) domains.add(domain);
  }
  return domains;
}

/** Selected organization ids/slugs, lowercased so a slug typed in any case still matches. */
export function parseTargetOrganizations(variables: CheckVariableValues | undefined): Set<string> {
  const raw = variables?.[targetOrganizationsVariable.id];
  const parts = Array.isArray(raw) ? raw : String(raw ?? '').split(/[\s,;]+/);

  const targets = new Set<string>();
  for (const part of parts) {
    const target = String(part).trim().toLowerCase();
    if (target) targets.add(target);
  }
  return targets;
}

/**
 * Narrows the organization list to the selection. An empty selection — or one that
 * matches nothing, which means the connection was configured against organizations the
 * key can no longer see — keeps every organization: reviewing too much is recoverable,
 * silently reviewing nothing is not.
 */
export function filterOrganizations<T extends PostHogOrganizationSummary>(
  organizations: T[],
  targets: Set<string>,
): T[] {
  if (targets.size === 0) return organizations;

  const selected = organizations.filter(
    (org) =>
      targets.has(String(org.id).toLowerCase()) ||
      (org.slug ? targets.has(String(org.slug).toLowerCase()) : false),
  );

  return selected.length > 0 ? selected : organizations;
}
