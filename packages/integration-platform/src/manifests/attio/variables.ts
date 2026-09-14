import type { CheckVariable, CheckVariableValues } from '../../types';

/**
 * Email domains that belong to consumer mailbox providers. An Attio member signing in
 * with one of these is, by definition, using a personal account: no corporate identity
 * provider governs it, so nobody can enforce or evidence 2FA on it.
 *
 * This list only has to cover the providers people actually sign up with — it is the
 * fallback used when an org has not told us which domains its IdP manages, and the
 * `approved_identity_domains` variable overrides it with an explicit allow-list.
 */
const CONSUMER_EMAIL_DOMAINS: ReadonlySet<string> = new Set([
  'aol.com',
  'fastmail.com',
  'gmail.com',
  'googlemail.com',
  'gmx.com',
  'gmx.de',
  'hotmail.co.uk',
  'hotmail.com',
  'hey.com',
  'icloud.com',
  'live.com',
  'mail.com',
  'mail.ru',
  'me.com',
  'msn.com',
  'outlook.com',
  'pm.me',
  'proton.me',
  'protonmail.com',
  'qq.com',
  'tutanota.com',
  'yahoo.co.uk',
  'yahoo.com',
  'yandex.com',
  'yandex.ru',
  'zoho.com',
]);

export const approvedIdentityDomainsVariable: CheckVariable = {
  id: 'approved_identity_domains',
  label: 'Identity provider domains',
  type: 'text',
  required: false,
  placeholder: 'acme.com, acme.io',
  helpText:
    'Comma-separated email domains managed by your identity provider, where 2FA is enforced. ' +
    'Subdomains are covered automatically. Leave empty to flag only personal (consumer) email accounts.',
};

export const maxAdminsVariable: CheckVariable = {
  id: 'max_admins',
  label: 'Maximum workspace admins',
  type: 'number',
  required: false,
  placeholder: '3',
  helpText:
    'Raise an access-review finding when the Attio workspace has more admins than this. ' +
    'Leave empty to record admin counts as evidence without a threshold.',
};

/**
 * Parses the `approved_identity_domains` variable into normalised domains.
 *
 * Accepts what people actually type: `acme.com`, `@acme.com`, `alice@acme.com`, mixed
 * case, and separated by commas, semicolons, or whitespace. Anything without a dot is
 * dropped — a bare word is a typo, not a domain, and letting it through would silently
 * approve nothing while looking configured.
 */
export function parseApprovedDomains(variables: CheckVariableValues | undefined): string[] {
  const raw = variables?.approved_identity_domains;

  const parts = Array.isArray(raw)
    ? raw.filter((value): value is string => typeof value === 'string')
    : typeof raw === 'string'
      ? raw.split(/[\s,;]+/)
      : [];

  const domains = new Set<string>();
  for (const part of parts) {
    // Strip surrounding dots BEFORE the two-label check. `.acme.com` is a plausible way
    // to write a domain and should cover acme.com, while `.com` must stay rejected —
    // stripping first leaves `com`, which the dot check then drops. Doing it the other
    // way round would let a bare TLD through and approve every account under it.
    const domain = (part.trim().toLowerCase().split('@').pop() ?? '').replace(/^\.+|\.+$/g, '');
    if (domain.includes('.')) domains.add(domain);
  }

  return [...domains];
}

/**
 * Parses the `max_admins` threshold. Returns null when unset or nonsensical (negative,
 * fractional, non-numeric) so the caller records evidence without raising a finding
 * rather than acting on a value the customer did not mean.
 */
export function parseMaxAdmins(variables: CheckVariableValues | undefined): number | null {
  const raw = variables?.max_admins;
  const value = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw.trim()) : NaN;

  if (!Number.isInteger(value) || value < 0) return null;
  return value;
}

/**
 * How an Attio member's email domain relates to the org's identity perimeter.
 *
 * - `approved`  — an IdP-governed domain, so 2FA is enforced and evidenced upstream.
 * - `consumer`  — a personal mailbox provider; no IdP can govern it.
 * - `unapproved` — a real domain that is not on the configured allow-list, or an
 *   address we could not read a domain from at all.
 */
export type DomainVerdict = 'approved' | 'consumer' | 'unapproved';

/**
 * Whether the allow-list was configured. In `consumer-only` mode any non-consumer
 * domain is assumed to be corporate; evidence records the mode so an auditor can tell
 * an assumed pass from a verified one.
 */
export type DomainMatchMode = 'allow-list' | 'consumer-only';

export interface DomainClassification {
  domain: string | null;
  verdict: DomainVerdict;
  mode: DomainMatchMode;
}

/** Exact match, or a subdomain of it — `mail.acme.com` is covered by `acme.com`. */
function isCoveredBy(domain: string, approved: string): boolean {
  return domain === approved || domain.endsWith(`.${approved}`);
}

export function classifyEmailDomain(
  email: string | null | undefined,
  approvedDomains: string[],
): DomainClassification {
  const mode: DomainMatchMode = approvedDomains.length > 0 ? 'allow-list' : 'consumer-only';
  const domain = String(email ?? '')
    .trim()
    .toLowerCase()
    .split('@')
    .pop();

  // No readable domain means the account cannot be attributed to any identity
  // provider, which is exactly what `unapproved` means here.
  if (!domain || !domain.includes('.')) return { domain: null, verdict: 'unapproved', mode };

  if (CONSUMER_EMAIL_DOMAINS.has(domain)) return { domain, verdict: 'consumer', mode };

  if (mode === 'consumer-only') return { domain, verdict: 'approved', mode };

  const approved = approvedDomains.some((candidate) => isCoveredBy(domain, candidate));
  return { domain, verdict: approved ? 'approved' : 'unapproved', mode };
}
