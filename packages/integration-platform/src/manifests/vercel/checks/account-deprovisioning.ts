import { TASK_TEMPLATES } from '../../../task-mappings';
import type { CheckContext, IntegrationCheck } from '../../../types';
import { toHttpReadFailure } from '../../http-read-failure';
import {
  daysSince,
  parsePendingInviteMaxAgeDays,
  pendingInviteMaxAgeDaysVariable,
} from '../access-variables';
import { loadDirectoryByEmail } from '../directory';
import type { VercelTeamRoster } from '../members';
import {
  describeMember,
  fetchVercelTeamRoster,
  isPrivilegedRole,
  normalizeEmail,
} from '../members';
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

    // Without the People directory there is no departure signal at all. Say so
    // once, as a finding, rather than passing on absent evidence — silently
    // passing would present "we could not check" as "no leaver has access".
    const directory = await loadDirectoryByEmail(ctx);
    if (!directory.available) {
      ctx.fail({
        title: 'Cannot verify deprovisioning without the People directory',
        resourceType: 'vercel',
        resourceId: 'people-directory',
        severity: 'medium',
        description:
          'The People directory was unavailable in this run, so Vercel access could not be compared against personnel departures.',
        remediation:
          'Ensure your organization has people recorded in the People section, then re-run this check.',
        evidence: { teamId, vercelAccountCount: roster.members.length, checkedAt },
      });
      return;
    }

    const { byEmail } = directory;

    ctx.log(
      `Reconciling ${roster.members.length} Vercel account(s) against ${directory.total} person record(s)`,
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
      description: `${roster.members.length} Vercel account(s) on ${teamName ?? teamId}: ${leavers} belonging to leavers, ${unknown} not in the People directory.`,
      evidence: {
        teamId,
        teamName: teamName ?? null,
        vercelAccountCount: roster.members.length,
        directoryPersonCount: directory.total,
        leaversWithAccess: leavers,
        accountsNotInDirectory: unknown,
        staleInvites,
        checkedAt,
      },
    });

    ctx.log(
      `Vercel deprovisioning check complete: ${leavers} leaver(s) with access, ${unknown} unmatched account(s), ${staleInvites} stale invitation(s)`,
    );
  },
};
