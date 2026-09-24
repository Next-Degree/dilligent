/**
 * Email identity resolution for GitHub organization accounts.
 *
 * GitHub never returns member emails from the REST member endpoints, so the
 * access-review checks have to reconstruct them. Two GraphQL sources can answer
 * it, in descending order of authority:
 *
 *   1. SAML `nameId` / SCIM `username` from the org's identity provider. This is
 *      the same identity the IdP deprovisions, so it is authoritative — but
 *      `samlIdentityProvider` only exists on GitHub Enterprise Cloud with SSO
 *      configured, which most organizations do not have.
 *   2. `organizationVerifiedDomainEmails` — the account's emails that fall under
 *      a domain the organization has verified. This needs no SSO and no paid
 *      plan, only a verified domain, so it is the source that actually resolves
 *      accounts for the majority of organizations.
 *
 * Both are best-effort: a missing identity provider, no verified domains, or a
 * token without `read:org` all mean "no identity for this account", never a
 * failed check. Callers fall back to the public profile email.
 */

import type { CheckContext } from '../../../types';
import type {
  GitHubExternalIdentitiesResponse,
  GitHubVerifiedDomainEmailsResponse,
} from '../types';

/** Where an account's email came from, in the order the resolver tries them. */
export type EmailSource = 'saml' | 'scim' | 'verified_domain' | 'profile' | 'none';

/** An email resolved from the organization rather than the account's profile. */
export interface IdentityEmail {
  email: string;
  source: Extract<EmailSource, 'saml' | 'scim' | 'verified_domain'>;
}

/** Pages of 100 cover 2,000 accounts; the bound stops a malformed pageInfo looping. */
const MAX_PAGES = 20;

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

const VERIFIED_DOMAIN_EMAILS_QUERY = `
  query($org: String!, $cursor: String) {
    organization(login: $org) {
      membersWithRole(first: 100, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          login
          organizationVerifiedDomainEmails(login: $org)
        }
      }
    }
  }
`;

export const normalizeEmail = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim().toLowerCase();
  if (!trimmed || !trimmed.includes('@')) return null;
  return trimmed;
};

/** Map of login → SSO identity. Empty when the org has no SAML/SCIM provider. */
async function fetchExternalIdentities({
  ctx,
  org,
}: {
  ctx: CheckContext;
  org: string;
}): Promise<Map<string, IdentityEmail>> {
  const identities = new Map<string, IdentityEmail>();
  let cursor: string | null = null;

  try {
    for (let page = 0; page < MAX_PAGES; page++) {
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
        if (samlEmail) {
          identities.set(login, { email: samlEmail, source: 'saml' });
          continue;
        }
        const scimEmail = normalizeEmail(node?.scimIdentity?.username);
        if (scimEmail) identities.set(login, { email: scimEmail, source: 'scim' });
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
 * Map of login → verified-domain email, for members whose email falls under a
 * domain the organization has verified. Empty when no domains are verified —
 * which is indistinguishable from every member using an outside address, so it
 * is logged rather than treated as an error.
 */
async function fetchVerifiedDomainEmails({
  ctx,
  org,
}: {
  ctx: CheckContext;
  org: string;
}): Promise<Map<string, string>> {
  const emails = new Map<string, string>();
  let cursor: string | null = null;

  try {
    for (let page = 0; page < MAX_PAGES; page++) {
      const response: GitHubVerifiedDomainEmailsResponse =
        await ctx.graphql<GitHubVerifiedDomainEmailsResponse>(VERIFIED_DOMAIN_EMAILS_QUERY, {
          org,
          cursor,
        });

      const connection = response.organization?.membersWithRole;
      if (!connection) {
        ctx.log(`Could not read members with role for ${org}`);
        return emails;
      }

      for (const node of connection.nodes ?? []) {
        const login = node?.login?.toLowerCase();
        if (!node || !login) continue;
        // An account can have several verified addresses on the same domain;
        // any of them identifies the person, so the first usable one wins.
        const email = (node.organizationVerifiedDomainEmails ?? [])
          .map(normalizeEmail)
          .find((candidate): candidate is string => candidate !== null);
        if (email) emails.set(login, email);
      }

      if (!connection.pageInfo?.hasNextPage) break;
      cursor = connection.pageInfo.endCursor;
      if (!cursor) break;
    }
  } catch (error) {
    ctx.warn(`Could not read verified domain emails for ${org}: ${String(error)}`);
  }

  return emails;
}

/**
 * Every organization-supplied email, keyed by lowercased login. SSO identities
 * win over verified-domain emails: when both exist they normally agree, and
 * where they disagree the IdP identity is the one that governs access.
 */
export async function fetchIdentityEmails({
  ctx,
  org,
}: {
  ctx: CheckContext;
  org: string;
}): Promise<Map<string, IdentityEmail>> {
  const [identities, verifiedEmails] = await Promise.all([
    fetchExternalIdentities({ ctx, org }),
    fetchVerifiedDomainEmails({ ctx, org }),
  ]);

  for (const [login, email] of verifiedEmails) {
    if (identities.has(login)) continue;
    identities.set(login, { email, source: 'verified_domain' });
  }

  ctx.log(`Resolved ${identities.size} account email(s) from ${org}`);
  return identities;
}
