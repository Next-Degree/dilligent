/**
 * GitHub Accounts Associated With Users Check
 *
 * Every account with access to the organization must belong to a known person
 * in the People directory. An account nobody can name is an account nobody can
 * revoke — the classic finding behind shared logins, forgotten contractors, and
 * personal accounts left on org repositories.
 *
 * Matching is by email: the SAML/SCIM identity when the org uses SSO, otherwise
 * the account's public profile email. Either is compared against both the
 * person's work email and any GitHub email linked to their People record —
 * the manual path for organizations without SSO, which is a paid GitHub
 * Enterprise feature.
 *
 * Two failure modes are reported and kept distinct, because they need different
 * fixes:
 *   - no email could be resolved at all → the account cannot even be attributed
 *   - an email resolved but matches nobody in the directory → an account for
 *     someone who is not in People
 */

import { TASK_TEMPLATES } from '../../../task-mappings';
import type { IntegrationCheck } from '../../../types';
import { ignoredGithubLoginsVariable, parseIgnoredLogins, targetReposVariable } from '../variables';
import {
  loadDirectoryByEmail,
  orgsFromTargetRepos,
  resolveOrgAccounts,
  type OrgAccount,
} from './org-accounts';

const accessLabel = (account: OrgAccount): string =>
  account.accessType === 'outside_collaborator' ? 'outside collaborator' : 'organization member';

export const accountsAssociatedCheck: IntegrationCheck = {
  id: 'github_accounts_associated',
  name: 'GitHub Accounts Associated With Users',
  description:
    'Verifies every GitHub account with access to the organization maps to a person in your People directory, by SAML/SCIM identity or profile email.',
  service: 'access-management',
  taskMapping: TASK_TEMPLATES.employeeAccess,
  defaultSeverity: 'medium',

  variables: [targetReposVariable, ignoredGithubLoginsVariable],

  run: async (ctx) => {
    const targetRepos = (ctx.variables.target_repos as string[] | undefined) ?? [];
    const orgs = orgsFromTargetRepos(targetRepos);
    const ignoredLogins = parseIgnoredLogins(
      ctx.variables.ignored_github_logins as string | undefined,
    );

    if (orgs.length === 0) {
      ctx.fail({
        title: 'No repositories configured',
        description:
          'No repositories are configured, so there is no organization whose accounts can be compared against the People directory.',
        resourceType: 'integration',
        resourceId: 'github',
        severity: 'low',
        remediation: 'Open the integration settings and select repositories to monitor.',
      });
      return;
    }

    const directory = await loadDirectoryByEmail(ctx);

    for (const org of orgs) {
      const checkedAt = new Date().toISOString();
      ctx.log(`Resolving accounts for organization ${org}`);

      let accounts: OrgAccount[];
      try {
        accounts = await resolveOrgAccounts({ ctx, org, ignoredLogins });
      } catch (error) {
        ctx.error(`Could not list accounts for ${org}: ${String(error)}`);
        ctx.fail({
          title: `Cannot list GitHub accounts for ${org}`,
          description: `Failed to read the member list for organization "${org}": ${String(error)}`,
          resourceType: 'organization',
          resourceId: org,
          severity: 'medium',
          remediation:
            'Reconnect the GitHub integration with an account that can read organization membership, and authorize it for organization SSO if required.',
          evidence: { organization: org, checkedAt },
        });
        continue;
      }

      ctx.log(`Resolved ${accounts.length} human accounts in ${org}`);

      for (const account of accounts) {
        const person = account.email ? directory.byEmail.get(account.email) : undefined;
        const baseEvidence = {
          organization: org,
          login: account.login,
          name: account.name,
          email: account.email,
          emailSource: account.emailSource,
          accessType: account.accessType,
          isAdmin: account.isAdmin,
          profileUrl: account.profileUrl,
          checkedAt,
        };
        // Email when we have one, so person-scoped features can join these rows
        // to org members the same way the Google Workspace check does. Falls
        // back to org/login, which is still stable across runs.
        const resourceId = account.email ?? `${org}/${account.login}`;

        if (person) {
          ctx.pass({
            title: 'GitHub Account Associated',
            description: `@${account.login} (${accessLabel(account)}) is associated with ${person.name ?? person.email} in your People directory.`,
            resourceType: 'user',
            resourceId,
            evidence: {
              ...baseEvidence,
              directoryMatch: {
                memberId: person.id,
                name: person.name,
                email: person.email,
                isActive: person.isActive,
                department: person.department,
                jobTitle: person.jobTitle,
              },
            },
          });
          continue;
        }

        // Without a directory the comparison cannot be made at all. Record the
        // account as inventory rather than accusing it of being unassociated.
        if (!directory.available) {
          ctx.pass({
            title: 'GitHub Account Inventory',
            description: `@${account.login} (${accessLabel(account)}) has access to ${org}. The People directory was unavailable in this run, so no association was verified.`,
            resourceType: 'user',
            resourceId,
            evidence: { ...baseEvidence, directoryMatch: null, directoryAvailable: false },
          });
          continue;
        }

        if (!account.email) {
          ctx.fail({
            title: `GitHub account cannot be attributed: @${account.login}`,
            description: `@${account.login} is an ${accessLabel(account)} of ${org}, but no email could be resolved for the account — it has no SAML/SCIM identity and no public profile email — so it cannot be tied to a person.`,
            resourceType: 'user',
            resourceId,
            severity: account.isAdmin ? 'high' : 'medium',
            remediation: `1. Identify who owns @${account.login}\n2. If it is a person, open their People record and link the GitHub email their account uses, or enforce SAML SSO on ${org} so identities resolve automatically\n3. If it is automation, add "${account.login}" to "Service and bot accounts to ignore" in the integration settings\n4. If nobody owns it, remove it at https://github.com/orgs/${org}/people`,
            evidence: { ...baseEvidence, directoryMatch: null },
          });
          continue;
        }

        ctx.fail({
          title: `GitHub account not in People directory: @${account.login}`,
          description: `@${account.login} is an ${accessLabel(account)} of ${org} using ${account.email}, but no person with that email exists in your People directory.`,
          resourceType: 'user',
          resourceId,
          severity: account.isAdmin ? 'high' : 'medium',
          remediation: `1. If ${account.email} belongs to a current employee or contractor, add them to your People directory\n2. If they are already there under a different address — a personal GitHub account is the usual reason — link ${account.email} on their People record\n3. If they should no longer have access, remove them at https://github.com/orgs/${org}/people`,
          evidence: { ...baseEvidence, directoryMatch: null },
        });
      }

      if (accounts.length === 0) {
        ctx.pass({
          title: `No human GitHub accounts found in ${org}`,
          description: `Organization "${org}" reported no member or outside-collaborator accounts to associate, once bots and ignored service accounts were excluded.`,
          resourceType: 'organization',
          resourceId: org,
          evidence: { organization: org, accounts: 0, checkedAt },
        });
      }
    }
  },
};
