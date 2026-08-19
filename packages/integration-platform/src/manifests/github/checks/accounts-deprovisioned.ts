/**
 * GitHub Accounts Deprovisioned When Personnel Leave Check
 *
 * Access must end when employment does. This check reports the two ways GitHub
 * access outlives a person:
 *   - an account whose matching person in the People directory is inactive or
 *     already past their offboard date, yet still has organization access
 *   - a pending invitation left standing long after it was sent, which is
 *     access waiting to be claimed by whoever still holds that inbox
 *
 * Accounts that match nobody in the directory are deliberately NOT reported
 * here — that is the account-association check's finding, and reporting it
 * twice would double-count the same account under two controls.
 */

import { TASK_TEMPLATES } from '../../../task-mappings';
import type { DirectoryPerson, IntegrationCheck } from '../../../types';
import type { GitHubOrgInvitation } from '../types';
import {
  ignoredGithubLoginsVariable,
  parseIgnoredLogins,
  staleInvitationDaysVariable,
  targetReposVariable,
} from '../variables';
import {
  loadDirectoryByEmail,
  orgsFromTargetRepos,
  resolveOrgAccounts,
  type OrgAccount,
} from './org-accounts';

const DEFAULT_STALE_INVITATION_DAYS = 30;

const toPositiveNumber = (value: unknown, fallback: number): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return fallback;
  return value;
};

const describeDeparture = (person: DirectoryPerson): string => {
  if (person.offboardDate) {
    return `offboarded on ${person.offboardDate.slice(0, 10)}`;
  }
  return 'marked inactive in your People directory';
};

const accessLabel = (account: OrgAccount): string =>
  account.accessType === 'outside_collaborator' ? 'outside collaborator' : 'organization member';

export const accountsDeprovisionedCheck: IntegrationCheck = {
  id: 'github_accounts_deprovisioned',
  name: 'GitHub Accounts Deprovisioned When Personnel Leave',
  description:
    'Verifies that people who have left — inactive or offboarded in your People directory — no longer have GitHub organization access, and that stale pending invitations have been revoked.',
  service: 'access-management',
  taskMapping: TASK_TEMPLATES.accessReviewLog,
  defaultSeverity: 'high',

  variables: [targetReposVariable, ignoredGithubLoginsVariable, staleInvitationDaysVariable],

  run: async (ctx) => {
    const targetRepos = (ctx.variables.target_repos as string[] | undefined) ?? [];
    const orgs = orgsFromTargetRepos(targetRepos);
    const ignoredLogins = parseIgnoredLogins(
      ctx.variables.ignored_github_logins as string | undefined,
    );
    const staleAfterDays = toPositiveNumber(
      ctx.variables.stale_invitation_days,
      DEFAULT_STALE_INVITATION_DAYS,
    );
    const invitationCutoff = new Date(Date.now() - staleAfterDays * 24 * 60 * 60 * 1000);

    if (orgs.length === 0) {
      ctx.fail({
        title: 'No repositories configured',
        description:
          'No repositories are configured, so there is no organization whose access can be checked against personnel departures.',
        resourceType: 'integration',
        resourceId: 'github',
        severity: 'low',
        remediation: 'Open the integration settings and select repositories to monitor.',
      });
      return;
    }

    const directory = await loadDirectoryByEmail(ctx);

    // Without the People directory there is no departure signal at all. Say so
    // once, as a finding, rather than passing on absent evidence.
    if (!directory.available) {
      ctx.fail({
        title: 'Cannot verify deprovisioning without the People directory',
        description:
          'The People directory was unavailable in this run, so GitHub access could not be compared against personnel departures.',
        resourceType: 'integration',
        resourceId: 'github',
        severity: 'medium',
        remediation:
          'Ensure your organization has people recorded in the People section, then re-run this check.',
      });
      return;
    }

    for (const org of orgs) {
      const checkedAt = new Date().toISOString();

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

      const departed: Array<{ account: OrgAccount; person: DirectoryPerson }> = [];
      for (const account of accounts) {
        const person = account.email ? directory.byEmail.get(account.email) : undefined;
        if (person && !person.isActive) {
          departed.push({ account, person });
        }
      }

      for (const { account, person } of departed) {
        ctx.fail({
          title: `Departed person still has GitHub access: @${account.login}`,
          description: `${person.name ?? person.email} is ${describeDeparture(person)}, but @${account.login} is still an ${accessLabel(account)} of ${org}${account.isAdmin ? ' with owner privileges' : ''}.`,
          resourceType: 'user',
          resourceId: account.email ?? `${org}/${account.login}`,
          severity: account.isAdmin ? 'critical' : 'high',
          remediation: `1. Remove @${account.login} at https://github.com/orgs/${org}/people\n2. Revoke any personal access tokens, SSH keys, and SAML sessions they hold\n3. Review repositories they could reach for credentials that need rotating`,
          evidence: {
            organization: org,
            login: account.login,
            email: account.email,
            emailSource: account.emailSource,
            accessType: account.accessType,
            isAdmin: account.isAdmin,
            profileUrl: account.profileUrl,
            directoryMatch: {
              memberId: person.id,
              name: person.name,
              email: person.email,
              isActive: person.isActive,
              offboardDate: person.offboardDate,
            },
            checkedAt,
          },
        });
      }

      // Pending invitations are access that has been granted but not yet
      // claimed, so they survive offboarding entirely — nobody thinks to revoke
      // an invite for someone who never joined.
      let staleInvitations: GitHubOrgInvitation[] = [];
      try {
        const invitations = await ctx.fetchAllPages<GitHubOrgInvitation>(
          `/orgs/${encodeURIComponent(org)}/invitations`,
        );
        staleInvitations = invitations.filter(
          (invitation) => new Date(invitation.created_at).getTime() <= invitationCutoff.getTime(),
        );
      } catch (error) {
        ctx.warn(`Could not list pending invitations for ${org}: ${String(error)}`);
      }

      for (const invitation of staleInvitations) {
        const invitee = invitation.login ?? invitation.email ?? `invitation ${invitation.id}`;
        ctx.fail({
          title: `Stale GitHub invitation pending: ${invitee}`,
          description: `An invitation to ${org} for ${invitee} has been pending since ${invitation.created_at.slice(0, 10)}, longer than the ${staleAfterDays}-day threshold. Until it is revoked, anyone holding that account or inbox can still claim ${invitation.role} access.`,
          resourceType: 'invitation',
          resourceId: `${org}/invitation/${invitation.id}`,
          severity: 'medium',
          remediation: `1. Go to https://github.com/orgs/${org}/people/pending_invitations\n2. Cancel the invitation for ${invitee} if it is no longer needed\n3. Re-invite only if the person still requires access`,
          evidence: {
            organization: org,
            invitationId: invitation.id,
            login: invitation.login,
            email: invitation.email,
            role: invitation.role,
            createdAt: invitation.created_at,
            invitedBy: invitation.inviter?.login ?? null,
            staleAfterDays,
            checkedAt,
          },
        });
      }

      if (departed.length === 0 && staleInvitations.length === 0) {
        ctx.pass({
          title: `No departed personnel retain GitHub access in ${org}`,
          description: `All ${accounts.length} account(s) with access to ${org} that match your People directory belong to active personnel, and no invitation has been pending longer than ${staleAfterDays} days.`,
          resourceType: 'organization',
          resourceId: org,
          evidence: {
            organization: org,
            accountsChecked: accounts.length,
            directoryPeople: directory.total,
            departedWithAccess: 0,
            stalePendingInvitations: 0,
            staleAfterDays,
            checkedAt,
          },
        });
      }
    }
  },
};
