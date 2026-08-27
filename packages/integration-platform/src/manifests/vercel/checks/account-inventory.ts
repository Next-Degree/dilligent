import { TASK_TEMPLATES } from '../../../task-mappings';
import type { CheckContext, IntegrationCheck } from '../../../types';
import { toHttpReadFailure } from '../../http-read-failure';
import {
  corporateEmailDomainsVariable,
  parseCorporateDomains,
  parseSharedAccountLocalParts,
  sharedAccountLocalPartsVariable,
} from '../access-variables';
import { loadDirectoryByEmail } from '../directory';
import {
  describeMember,
  fetchVercelTeamRoster,
  getEmailDomain,
  getEmailLocalPart,
  isPrivilegedRole,
  normalizeEmail,
} from '../members';
import { requireVercelTeam } from '../team';
import type { VercelTeamMember } from '../types';

/**
 * Vercel Accounts Associated With Users
 *
 * Every account on the Vercel team must belong to one identifiable person in
 * the People directory. Attribution is a directory match first — the same
 * question the GitHub manifest's accounts-associated check asks — because an
 * address nobody in People holds is an account nobody can name or revoke,
 * however plausible the domain looks. An account with no email, a shared
 * mailbox, or an unconfirmed membership fails for its own reason on top.
 *
 * The corporate-domain heuristic is a fallback for runs with no directory to
 * compare against, not a second way to pass: it says an address belongs to the
 * company, never that it belongs to a person we employ.
 *
 * Emits one row per member keyed by lowercased email so person-scoped
 * features can join Vercel accounts to org members.
 * Maps to: Employee Access task
 */
export const accountInventoryCheck: IntegrationCheck = {
  id: 'account-inventory',
  name: 'Accounts Associated With Users',
  description:
    'Verify every Vercel team account belongs to an identifiable person in your People directory',
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
          ? 'Check that the Vercel access token is still valid and was created by an account with Owner access to this team.'
          : 'Re-run the check; if it keeps failing, contact support.',
        evidence: { teamId, error: failure.error, denied: failure.denied },
      });
      return;
    }

    const corporateDomains = parseCorporateDomains(ctx.variables, team.emailDomain);
    const sharedLocalParts = parseSharedAccountLocalParts(ctx.variables);
    const checkedAt = new Date().toISOString();

    // A directory match is what attributes an account to a person — including
    // when the account is held under their linked provider address (typically a
    // personal one), which no corporate domain would ever cover.
    const directory = await loadDirectoryByEmail(ctx);

    // An empty directory is not evidence that nobody works here: an org that has
    // not filled in People yet would otherwise have every Vercel account flagged
    // as belonging to a stranger. Treat it like an absent directory and fall back
    // to the domain heuristic, which is weaker but at least says something.
    const canMatchDirectory = directory.available && directory.total > 0;
    if (directory.available && !canMatchDirectory) {
      ctx.warn(
        'The People directory returned no people; falling back to domain attribution for this run.',
      );
    }

    ctx.log(
      canMatchDirectory
        ? `Reviewing ${members.length} members against ${directory.total} person record(s) in the People directory`
        : `Reviewing ${members.length} members against ${
            corporateDomains.length > 0
              ? `corporate domains: ${corporateDomains.join(', ')}`
              : 'no configured corporate domains (domain attribution skipped)'
          } (no People directory available)`,
    );

    let unattributed = 0;
    let notInDirectory = 0;
    const roleCounts: Record<string, number> = {};

    for (const member of members) {
      roleCounts[member.role] = (roleCounts[member.role] ?? 0) + 1;

      const email = normalizeEmail(member.email);
      const displayName = describeMember(member);
      const domain = email ? getEmailDomain(email) : null;
      const localPart = email ? getEmailLocalPart(email) : null;

      const employee = email ? (directory.byEmail.get(email) ?? null) : null;

      const issues: string[] = [];
      if (!email) {
        issues.push('the account has no email address, so it cannot be traced to a person');
      }
      if (localPart && sharedLocalParts.has(localPart)) {
        issues.push(`"${localPart}" is a shared mailbox rather than one person`);
      }
      // The association the check is named for: with a directory to compare
      // against, an address no person holds is unattributed no matter what its
      // domain is. Without one, the domain is all that is left to go on — and it
      // only ever speaks for accounts the directory could not account for.
      if (canMatchDirectory && email && !employee) {
        notInDirectory++;
        issues.push(
          `no person in the People directory holds "${email}" as their work email or a linked account email`,
        );
      } else if (
        !canMatchDirectory &&
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
        directoryAvailable: canMatchDirectory,
        matchedEmployee: employee
          ? {
              name: employee.name,
              isActive: employee.isActive,
              matchedOnLinkedEmail: employee.email !== email,
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
        // Without a directory nothing was matched, only ruled out — record the
        // account as inventory rather than claiming an association the run could
        // not verify.
        ctx.pass({
          title: employee ? 'Account associated with a user' : 'Vercel account inventory',
          resourceType: 'user',
          resourceId: email ?? member.uid,
          description: employee
            ? `${displayName} holds ${member.role} access to the Vercel team and is ${
                employee.email === email ? 'associated with' : 'linked to'
              } ${employee.name ?? employee.email} in your People directory.`
            : `${displayName} holds ${member.role} access to the Vercel team. The People directory was unavailable in this run, so no association was verified.`,
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
        remediation: email
          ? `1. If ${email} belongs to a current employee or contractor, add them to your People directory\n2. If they are already there under a different address — a personal account signed in with GitHub is the usual reason — link ${email} on their People record\n3. If nobody owns the account, or it is a shared mailbox, remove it in Vercel Team Settings > Members and give the individual who needs the access their own named account`
          : 'Identify who owns this account in Vercel Team Settings > Members. Replace it with a named account for the individual who needs the access, and add that person to your People directory, or remove it.',
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
        accountsNotInDirectory: notInDirectory,
        roleCounts,
        corporateDomains,
        teamEmailDomain: team.emailDomain ?? null,
        directoryAvailable: canMatchDirectory,
        directoryPersonCount: directory.total,
        checkedAt,
      },
    });

    ctx.log(
      `Vercel account inventory complete: ${members.length} accounts, ${unattributed} unattributed (${notInDirectory} not in the People directory)`,
    );
  },
};
