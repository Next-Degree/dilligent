import { TASK_TEMPLATES } from '../../../task-mappings';
import type { CheckContext, IntegrationCheck } from '../../../types';
import { toHttpReadFailure } from '../../http-read-failure';
import {
  corporateEmailDomainsVariable,
  parseCorporateDomains,
  parseSharedAccountLocalParts,
  sharedAccountLocalPartsVariable,
} from '../access-variables';
import {
  describeMember,
  fetchVercelTeamRoster,
  getEmailDomain,
  getEmailLocalPart,
  isPrivilegedRole,
  normalizeEmail,
} from '../members';
import { loadOrganizationRoster, type OrganizationRoster } from '../roster';
import { requireVercelTeam } from '../team';
import type { VercelTeamMember } from '../types';

/**
 * Vercel Accounts Associated With Users
 *
 * Every account on the Vercel team must belong to one identifiable person:
 * an account with no email, a shared mailbox, or an address outside the
 * company's domains cannot be attributed to (or revoked for) an individual.
 *
 * Emits one row per member keyed by lowercased email so person-scoped
 * features can join Vercel accounts to org members.
 * Maps to: Employee Access task
 */
export const accountInventoryCheck: IntegrationCheck = {
  id: 'account-inventory',
  name: 'Accounts Associated With Users',
  description:
    'Verify every Vercel team account belongs to an identifiable person on a corporate email domain',
  service: 'access',
  taskMapping: TASK_TEMPLATES.employeeAccess,
  defaultSeverity: 'medium',
  variables: [corporateEmailDomainsVariable, sharedAccountLocalPartsVariable],

  run: async (ctx: CheckContext) => {
    ctx.log('Starting Vercel account inventory check');

    const resolved = await requireVercelTeam(ctx);
    if (!resolved) return;
    const { teamId, teamName, team } = resolved;

    let members: VercelTeamMember[];
    try {
      ({ members } = await fetchVercelTeamRoster(ctx, teamId));
    } catch (error) {
      const failure = toHttpReadFailure(error);
      ctx.fail({
        title: 'Failed to read Vercel team members',
        resourceType: 'vercel',
        resourceId: teamId,
        severity: 'high',
        description: `Could not list team members: ${failure.error}`,
        remediation: failure.denied
          ? 'Reconnect the Vercel integration with an account that has Owner access to this team.'
          : 'Re-run the check; if it keeps failing, contact support.',
        evidence: { teamId, error: failure.error, denied: failure.denied },
      });
      return;
    }

    const corporateDomains = parseCorporateDomains(ctx.variables, team.emailDomain);
    const sharedLocalParts = parseSharedAccountLocalParts(ctx.variables);
    const checkedAt = new Date().toISOString();

    // An account that matches someone on the employee roster is attributable to
    // a person by definition — including when it is held under their linked
    // provider address (typically a personal GitHub email), which no corporate
    // domain would ever cover. The domain heuristic is only for accounts the
    // roster cannot account for.
    let organization: OrganizationRoster | null = null;
    try {
      organization = await loadOrganizationRoster(ctx);
    } catch (error) {
      ctx.log(
        `Employee roster unavailable, falling back to domain attribution: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    ctx.log(
      `Reviewing ${members.length} members against ${
        corporateDomains.length > 0
          ? `corporate domains: ${corporateDomains.join(', ')}`
          : 'no configured corporate domains (domain attribution skipped)'
      }`,
    );

    let unattributed = 0;
    const roleCounts: Record<string, number> = {};

    for (const member of members) {
      roleCounts[member.role] = (roleCounts[member.role] ?? 0) + 1;

      const email = normalizeEmail(member.email);
      const displayName = describeMember(member);
      const domain = email ? getEmailDomain(email) : null;
      const localPart = email ? getEmailLocalPart(email) : null;

      const employee = email ? (organization?.byEmail.get(email) ?? null) : null;

      const issues: string[] = [];
      if (!email) {
        issues.push('the account has no email address, so it cannot be traced to a person');
      }
      if (localPart && sharedLocalParts.has(localPart)) {
        issues.push(`"${localPart}" is a shared mailbox rather than one person`);
      }
      // Only question the domain when the roster did not already identify the
      // person — a linked personal address is a legitimate match, not a finding.
      if (
        !employee &&
        domain &&
        corporateDomains.length > 0 &&
        !corporateDomains.includes(domain)
      ) {
        issues.push(`the domain "${domain}" is not one of the company's domains`);
      }
      if (!member.confirmed) {
        issues.push('the membership is still pending confirmation by an owner');
      }

      // One row per person: resourceId stays the email so results join to org
      // members, and every issue for that person is collapsed into that row.
      const evidence = {
        email,
        name: member.name ?? null,
        username: member.username ?? null,
        role: member.role,
        uid: member.uid,
        confirmed: member.confirmed,
        emailDomain: domain,
        corporateDomains,
        matchedEmployee: employee
          ? {
              name: employee.name,
              isActive: employee.isActive,
              matchedOnLinkedEmail: employee.email !== email,
              linkedEmailSource: employee.linkedEmailSource,
            }
          : null,
        joinedFromOrigin: member.joinedFrom?.origin ?? null,
        isEnterpriseManaged: member.isEnterpriseManaged ?? false,
        addedAt: Number.isFinite(member.createdAt)
          ? new Date(member.createdAt).toISOString()
          : null,
        checkedAt,
      };

      if (issues.length === 0) {
        ctx.pass({
          title: 'Account associated with a user',
          resourceType: 'user',
          resourceId: email ?? member.uid,
          description: `${displayName} holds ${member.role} access to the Vercel team and is attributable to an individual.`,
          evidence,
        });
        continue;
      }

      unattributed++;
      ctx.fail({
        title: `Account not associated with a user: ${displayName}`,
        resourceType: 'user',
        resourceId: email ?? member.uid,
        severity: isPrivilegedRole(member.role) ? 'high' : 'medium',
        description: `${displayName} holds ${member.role} access to the Vercel team, but ${issues.join('; ')}.`,
        remediation:
          'In Vercel Team Settings > Members, replace this account with a named corporate account for the individual who needs the access, or remove it.',
        evidence: { ...evidence, issues },
      });
    }

    ctx.pass({
      title: 'Vercel Account Inventory',
      resourceType: 'vercel',
      resourceId: 'account-inventory',
      description: `${members.length} account(s) on ${teamName ?? teamId}, ${unattributed} not attributable to an individual.`,
      evidence: {
        teamId,
        teamName: teamName ?? null,
        totalAccounts: members.length,
        unattributedAccounts: unattributed,
        roleCounts,
        corporateDomains,
        teamEmailDomain: team.emailDomain ?? null,
        rosterAvailable: organization !== null,
        checkedAt,
      },
    });

    ctx.log(
      `Vercel account inventory complete: ${members.length} accounts, ${unattributed} unattributed`,
    );
  },
};
