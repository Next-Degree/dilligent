import { TASK_TEMPLATES } from '../../../task-mappings';
import type { CheckContext, IntegrationCheck } from '../../../types';
import { toHttpReadFailure } from '../../http-read-failure';
import {
  daysSince,
  parsePendingInviteMaxAgeDays,
  pendingInviteMaxAgeDaysVariable,
} from '../access-variables';
import type { VercelTeamRoster } from '../members';
import {
  describeMember,
  fetchVercelTeamRoster,
  isPrivilegedRole,
  normalizeEmail,
} from '../members';
import { loadOrganizationRoster, type OrganizationRoster } from '../roster';
import { requireVercelTeam } from '../team';

/**
 * Vercel Accounts Deprovisioned When Personnel Leave
 *
 * Reconciles the Vercel team roster against the Comp AI employee roster: an
 * account whose person is offboarded — or who is not an employee at all — is
 * access that outlived the person, which is exactly what offboarding evidence
 * has to rule out.
 *
 * Deliberately does NOT depend on SAML SSO or Directory Sync: those are Vercel
 * Enterprise features, so a check built on them is inert for most teams.
 *
 * Maps to: Offboarding Checklist: Access & Asset Return
 */
export const accountDeprovisioningCheck: IntegrationCheck = {
  id: 'account-deprovisioning',
  name: 'Accounts Deprovisioned When Personnel Leave',
  description:
    'Verify every Vercel team account belongs to an active employee, and that no leaver retains access',
  service: 'access',
  taskMapping: TASK_TEMPLATES.offboardingChecklistAccessAssetReturn,
  defaultSeverity: 'high',
  variables: [pendingInviteMaxAgeDaysVariable],

  run: async (ctx: CheckContext) => {
    ctx.log('Starting Vercel account deprovisioning check');

    const resolved = await requireVercelTeam(ctx);
    if (!resolved) return;
    const { teamId, teamName } = resolved;

    let roster: VercelTeamRoster;
    try {
      roster = await fetchVercelTeamRoster(ctx, teamId);
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

    const checkedAt = new Date().toISOString();
    const nowMs = Date.now();

    // Without the roster there is nothing to reconcile against. Reporting that
    // plainly is the only honest outcome — silently passing would present "we
    // could not check" as "no leaver has access".
    let organization: OrganizationRoster;
    try {
      organization = await loadOrganizationRoster(ctx);
    } catch (error) {
      ctx.fail({
        title: 'Could not compare Vercel accounts to the employee roster',
        resourceType: 'vercel',
        resourceId: 'employee-roster',
        severity: 'medium',
        description: `The Comp AI employee roster could not be read, so Vercel accounts could not be reconciled against current staff: ${
          error instanceof Error ? error.message : String(error)
        }`,
        remediation:
          'Re-run the check. If it keeps failing, contact support — offboarding evidence for Vercel depends on this comparison.',
        evidence: { teamId, vercelAccountCount: roster.members.length, checkedAt },
      });
      return;
    }

    const { members, byEmail } = organization;

    ctx.log(
      `Reconciling ${roster.members.length} Vercel account(s) against ${members.length} employee record(s)`,
    );

    let leavers = 0;
    let unknown = 0;

    for (const account of roster.members) {
      const email = normalizeEmail(account.email);
      const displayName = describeMember(account);
      const employee = email ? byEmail.get(email) : undefined;
      const evidence = {
        email,
        name: account.name ?? null,
        role: account.role,
        uid: account.uid,
        matchedEmployee: employee
          ? {
              name: employee.name,
              isActive: employee.isActive,
              department: employee.department,
              // Records when the match came from a linked provider address
              // rather than the person's work email.
              matchedOnLinkedEmail: employee.email !== email,
              linkedEmailSource: employee.linkedEmailSource,
            }
          : null,
        addedAt: Number.isFinite(account.createdAt)
          ? new Date(account.createdAt).toISOString()
          : null,
        checkedAt,
      };

      if (employee?.isActive) {
        ctx.pass({
          title: 'Account belongs to an active employee',
          resourceType: 'user',
          resourceId: email ?? account.uid,
          description: `${displayName} holds ${account.role} access to Vercel and is an active member of the organization.`,
          evidence,
        });
        continue;
      }

      if (employee) {
        leavers++;
        ctx.fail({
          title: `Access not removed for leaver: ${displayName}`,
          resourceType: 'user',
          resourceId: email ?? account.uid,
          severity: 'high',
          description: `${displayName} is no longer an active member of the organization${
            employee.offboardDate ? ` (offboarded ${employee.offboardDate.slice(0, 10)})` : ''
          }, but still holds ${account.role} access to the Vercel team.`,
          remediation: `Remove this member in Vercel Team Settings > Members, then record the removal on the offboarding checklist.`,
          evidence: { ...evidence, offboardDate: employee.offboardDate },
        });
        continue;
      }

      unknown++;
      ctx.fail({
        title: `Vercel account not on the employee roster: ${displayName}`,
        resourceType: 'user',
        resourceId: email ?? account.uid,
        severity: isPrivilegedRole(account.role) ? 'high' : 'medium',
        description: `${displayName} holds ${account.role} access to the Vercel team but matches no member of the organization${
          email ? '' : ' (the account has no email address to match on)'
        }. This is either a departed person whose record is gone, or access that was never tracked.`,
        remediation:
          'Confirm who owns this account. If the person has left or is unknown, remove them in Vercel Team Settings > Members; if they are a current contractor, add them to the People list so access stays accounted for.',
        evidence,
      });
    }

    const maxInviteAgeDays = parsePendingInviteMaxAgeDays(ctx.variables);
    let staleInvites = 0;

    for (const invite of roster.emailInviteCodes) {
      const email = normalizeEmail(invite.email);
      const ageDays =
        typeof invite.createdAt === 'number' ? daysSince(invite.createdAt, nowMs) : null;
      const isStale = invite.expired === true || (ageDays !== null && ageDays > maxInviteAgeDays);
      const evidence = {
        inviteId: invite.id,
        email,
        role: invite.role ?? null,
        expired: invite.expired ?? false,
        ageDays,
        maxInviteAgeDays,
        checkedAt,
      };

      if (!isStale) {
        ctx.pass({
          title: 'Pending invitation within the age limit',
          resourceType: 'invite',
          resourceId: email ?? invite.id,
          description: `Invitation for ${email ?? invite.id} is ${ageDays ?? 0} day(s) old, within the ${maxInviteAgeDays}-day limit.`,
          evidence,
        });
        continue;
      }

      staleInvites++;
      ctx.fail({
        title: `Stale Vercel invitation: ${email ?? invite.id}`,
        resourceType: 'invite',
        resourceId: email ?? invite.id,
        severity: 'medium',
        description: `This invitation is ${
          invite.expired ? 'expired' : `${ageDays} day(s) old`
        } and still outstanding — standing access for someone who never joined or has since left.`,
        remediation:
          'Revoke the invitation in Vercel Team Settings > Members > Pending, and re-invite only if the person still needs access.',
        evidence,
      });
    }

    ctx.pass({
      title: 'Vercel Access Reconciliation',
      resourceType: 'vercel',
      resourceId: 'deprovisioning',
      description: `${roster.members.length} Vercel account(s) on ${teamName ?? teamId}: ${leavers} belonging to leavers, ${unknown} not on the employee roster.`,
      evidence: {
        teamId,
        teamName: teamName ?? null,
        vercelAccountCount: roster.members.length,
        employeeRecordCount: members.length,
        activeEmployeeCount: members.filter((member) => member.isActive).length,
        leaversWithAccess: leavers,
        accountsNotOnRoster: unknown,
        staleInvites,
        checkedAt,
      },
    });

    ctx.log(
      `Vercel deprovisioning check complete: ${leavers} leaver(s) with access, ${unknown} unmatched account(s), ${staleInvites} stale invitation(s)`,
    );
  },
};
