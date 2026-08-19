/**
 * Shared organization-account resolution for the GitHub access-review checks.
 *
 * Both the account-association and deprovisioning checks need the same thing:
 * every human account with access to the organization, resolved to an email
 * address so it can be matched against the People directory. That resolution is
 * the hard part, because GitHub does not hand out member emails directly.
 *
 * Emails are resolved in priority order:
 *   1. SAML `nameId` / SCIM `username` from the org's identity provider
 *      (GraphQL). Authoritative when SSO is configured — this is the same
 *      identity the IdP deprovisions.
 *   2. The account's public profile email (REST). A best-effort fallback for
 *      organizations without SSO.
 *
 * An account with no resolvable email is reported as unattributable rather than
 * silently skipped: an account nobody can tie to a person is exactly what these
 * controls exist to surface.
 */

import type { CheckContext, DirectoryPerson } from '../../../types';
import type {
  GitHubExternalIdentitiesResponse,
  GitHubOrgMember,
  GitHubUserProfile,
} from '../types';
import { mapWithConcurrency } from './concurrency';

/** Concurrent profile lookups. One REST call per member without an SSO identity. */
const PROFILE_LOOKUP_CONCURRENCY = 8;

export type AccountAccessType = 'member' | 'outside_collaborator';
export type EmailSource = 'saml' | 'scim' | 'profile' | 'none';

export interface OrgAccount {
  login: string;
  /** Lowercased email, or null when no identity could be resolved. */
  email: string | null;
  emailSource: EmailSource;
  name: string | null;
  profileUrl: string;
  accessType: AccountAccessType;
  isAdmin: boolean;
}

const EXTERNAL_IDENTITIES_QUERY = `
  query($org: String!, $cursor: String) {
    organization(login: $org) {
      samlIdentityProvider {
        externalIdentities(first: 100, after: $cursor) {
          pageInfo { hasNextPage endCursor }
          nodes {
            user { login }
            samlIdentity { nameId }
            scimIdentity { username }
          }
        }
      }
    }
  }
`;

const normalizeEmail = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim().toLowerCase();
  if (!trimmed || !trimmed.includes('@')) return null;
  return trimmed;
};

/** GitHub App accounts always end in `[bot]`; they are never people. */
export const isBotLogin = (login: string): boolean => login.toLowerCase().endsWith('[bot]');

/**
 * Map of login → { email, source } from the organization's identity provider.
 * Empty when the org has no SAML/SCIM configured or the token cannot read it —
 * both are normal, so this never throws.
 */
async function fetchExternalIdentities({
  ctx,
  org,
}: {
  ctx: CheckContext;
  org: string;
}): Promise<Map<string, { email: string; source: EmailSource }>> {
  const identities = new Map<string, { email: string; source: EmailSource }>();
  let cursor: string | null = null;

  try {
    // Bounded so a malformed pageInfo can never spin forever; 100 per page
    // covers 2,000 members.
    for (let page = 0; page < 20; page++) {
      const response: GitHubExternalIdentitiesResponse =
        await ctx.graphql<GitHubExternalIdentitiesResponse>(EXTERNAL_IDENTITIES_QUERY, {
          org,
          cursor,
        });

      const connection = response.organization?.samlIdentityProvider?.externalIdentities;
      if (!connection) {
        ctx.log(`No SAML identity provider configured for ${org}`);
        return identities;
      }

      for (const node of connection.nodes ?? []) {
        const login = node?.user?.login?.toLowerCase();
        if (!login) continue;
        const samlEmail = normalizeEmail(node?.samlIdentity?.nameId);
        const scimEmail = normalizeEmail(node?.scimIdentity?.username);
        if (samlEmail) {
          identities.set(login, { email: samlEmail, source: 'saml' });
        } else if (scimEmail) {
          identities.set(login, { email: scimEmail, source: 'scim' });
        }
      }

      if (!connection.pageInfo?.hasNextPage) break;
      cursor = connection.pageInfo.endCursor;
      if (!cursor) break;
    }
  } catch (error) {
    // Requires org-owner scope; a read failure means "no SSO data", not "check failed".
    ctx.warn(`Could not read external identities for ${org}: ${String(error)}`);
  }

  return identities;
}

/**
 * Every human account with access to `org`: members and outside collaborators,
 * each resolved to an email where possible.
 */
export async function resolveOrgAccounts({
  ctx,
  org,
  ignoredLogins,
}: {
  ctx: CheckContext;
  org: string;
  ignoredLogins: Set<string>;
}): Promise<OrgAccount[]> {
  const orgSlug = encodeURIComponent(org);

  const members = await ctx.fetchAllPages<GitHubOrgMember>(`/orgs/${orgSlug}/members`);

  const admins = await ctx
    .fetchAllPages<GitHubOrgMember>(`/orgs/${orgSlug}/members?role=admin`)
    .catch((error: unknown) => {
      ctx.warn(`Could not list owners for ${org}: ${String(error)}`);
      return [] as GitHubOrgMember[];
    });
  const adminLogins = new Set(admins.map((admin) => admin.login.toLowerCase()));

  const outsideCollaborators = await ctx
    .fetchAllPages<GitHubOrgMember>(`/orgs/${orgSlug}/outside_collaborators`)
    .catch((error: unknown) => {
      ctx.warn(`Could not list outside collaborators for ${org}: ${String(error)}`);
      return [] as GitHubOrgMember[];
    });

  const identities = await fetchExternalIdentities({ ctx, org });

  const candidates: Array<{ member: GitHubOrgMember; accessType: AccountAccessType }> = [
    ...members.map((member) => ({ member, accessType: 'member' as const })),
    ...outsideCollaborators.map((member) => ({
      member,
      accessType: 'outside_collaborator' as const,
    })),
  ].filter(
    ({ member }) =>
      !isBotLogin(member.login) &&
      member.type !== 'Bot' &&
      !ignoredLogins.has(member.login.toLowerCase()),
  );

  return mapWithConcurrency(
    candidates,
    PROFILE_LOOKUP_CONCURRENCY,
    async ({ member, accessType }): Promise<OrgAccount> => {
      const login = member.login;
      const identity = identities.get(login.toLowerCase());

      let email = identity?.email ?? null;
      let emailSource: EmailSource = identity?.source ?? 'none';
      let name: string | null = null;

      // The profile is still worth fetching when SSO resolved the email, since
      // it is the only source of a display name for the evidence record.
      try {
        const profile = await ctx.fetch<GitHubUserProfile>(`/users/${login}`);
        name = profile.name?.trim() || null;
        if (!email) {
          const profileEmail = normalizeEmail(profile.email);
          if (profileEmail) {
            email = profileEmail;
            emailSource = 'profile';
          }
        }
      } catch (error) {
        ctx.warn(`Could not read profile for ${login}: ${String(error)}`);
      }

      return {
        login,
        email,
        emailSource,
        name,
        profileUrl: member.html_url,
        accessType,
        isAdmin: adminLogins.has(login.toLowerCase()),
      };
    },
  );
}

/**
 * Load the People directory keyed by lowercased email.
 * Returns `available: false` when the host supplied no directory, so callers can
 * degrade to provider-only evidence instead of reporting everyone as unmatched.
 */
export async function loadDirectoryByEmail(
  ctx: CheckContext,
): Promise<{ available: boolean; byEmail: Map<string, DirectoryPerson>; total: number }> {
  if (!ctx.directory) {
    ctx.warn(
      'No People directory available in this run; reporting GitHub accounts without directory comparison.',
    );
    return { available: false, byEmail: new Map(), total: 0 };
  }

  try {
    const people = await ctx.directory.listPeople();
    const byEmail = new Map(people.map((person) => [person.email, person]));
    ctx.log(`Loaded ${people.length} people from the directory`);
    return { available: true, byEmail, total: people.length };
  } catch (error) {
    ctx.warn(`Could not read the People directory: ${String(error)}`);
    return { available: false, byEmail: new Map(), total: 0 };
  }
}

/** Organization logins implied by the selected repositories (the owner segment). */
export const orgsFromTargetRepos = (values: string[]): string[] => [
  ...new Set(
    values
      .map((value) => value.split(':')[0]?.split('/')[0]?.trim())
      .filter((owner): owner is string => Boolean(owner)),
  ),
];
