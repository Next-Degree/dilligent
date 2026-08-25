/**
 * Shared organization-account resolution for the GitHub access-review checks.
 *
 * Both the account-association and deprovisioning checks need the same thing:
 * every human account with access to the organization, resolved to an email
 * address so it can be matched against the People directory. That resolution is
 * the hard part, because GitHub does not hand out member emails directly.
 *
 * Emails are resolved in priority order:
 *   1. An organization-supplied identity — SAML/SCIM, or an email verified
 *      against one of the org's verified domains. See `org-identity-emails.ts`.
 *   2. The account's public profile email (REST). A last resort, since GitHub
 *      only exposes one when the account has explicitly made it public.
 *
 * An account with no resolvable email is reported as unattributable rather than
 * silently skipped: an account nobody can tie to a person is exactly what these
 * controls exist to surface.
 */

import type { CheckContext, DirectoryPerson } from '../../../types';
import type { GitHubOrgMember, GitHubUserProfile } from '../types';
import { mapWithConcurrency } from './concurrency';
import {
  fetchIdentityEmails,
  normalizeEmail,
  type EmailSource,
  type IdentityEmail,
} from './org-identity-emails';

/** Concurrent profile lookups. One REST call per member without an org identity. */
const PROFILE_LOOKUP_CONCURRENCY = 8;

/** Provider slug People records use when linking a GitHub email to a person. */
const DIRECTORY_SOURCE = 'github';

export type AccountAccessType = 'member' | 'outside_collaborator';
export type { EmailSource };

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

/** GitHub App accounts always end in `[bot]`; they are never people. */
export const isBotLogin = (login: string): boolean => login.toLowerCase().endsWith('[bot]');

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

  const identities = await fetchIdentityEmails({ ctx, org });

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
      const identity: IdentityEmail | undefined = identities.get(login.toLowerCase());

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
 * Load the People directory keyed by every email that identifies a person on
 * GitHub: their primary work email, plus any GitHub email an admin linked to
 * their People record.
 *
 * The linked email matters most for organizations without SAML SSO — a paid
 * GitHub Enterprise feature. Without it there is no identity provider to read,
 * and people commonly use a GitHub account registered under a personal address,
 * so the work email alone would leave those accounts looking unattributable.
 * Linking is how those organizations state the mapping by hand.
 *
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
    const byEmail = new Map<string, DirectoryPerson>();
    let linkedCount = 0;

    for (const person of people) {
      const emails = [
        person.email,
        // Only emails linked FOR GitHub. A person's Slack or Okta address says
        // nothing about who owns a GitHub account, and matching on it would
        // attribute an account to the wrong person.
        ...(person.linkedEmails ?? [])
          .filter((linked) => linked.source === DIRECTORY_SOURCE)
          .map((linked) => linked.email),
      ];

      for (const raw of emails) {
        const email = normalizeEmail(raw);
        // First writer wins: if two people claim the same email, the directory
        // is inconsistent and picking arbitrarily on each run would make results
        // flap. Keeping the first is stable and the collision is logged.
        if (!email) continue;
        if (byEmail.has(email)) {
          ctx.warn(
            `Directory email ${email} maps to more than one person; keeping the first match.`,
          );
          continue;
        }
        byEmail.set(email, person);
        if (email !== person.email) linkedCount++;
      }
    }

    ctx.log(
      `Loaded ${people.length} people from the directory (${linkedCount} linked GitHub email(s))`,
    );
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
