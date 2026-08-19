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
  isCentrallyManaged,
  isPrivilegedRole,
  normalizeEmail,
} from '../members';
import { requireVercelTeam } from '../team';

/**
 * Vercel Accounts Deprovisioned When Personnel Leave
 *
 * Vercel has no "last active" or termination signal, so the evidence that
 * access ends when someone leaves is structural: accounts governed by the
 * team's identity provider (SAML SSO / Directory Sync) lose Vercel access when
 * the person is deactivated in the IdP; accounts outside it must be removed by
 * hand. Stale open invitations are standing access offers and are flagged too.
 *
 * Maps to: Offboarding Checklist: Access & Asset Return
 */
export const accountDeprovisioningCheck: IntegrationCheck = {
  id: 'account-deprovisioning',
  name: 'Accounts Deprovisioned When Personnel Leave',
  description:
    'Verify Vercel accounts are governed by an identity provider so access is removed when someone leaves',
  service: 'access',
  taskMapping: TASK_TEMPLATES.offboardingChecklistAccessAssetReturn,
  defaultSeverity: 'high',
  variables: [pendingInviteMaxAgeDaysVariable],

  run: async (ctx: CheckContext) => {
    ctx.log('Starting Vercel account deprovisioning check');

    const resolved = await requireVercelTeam(ctx);
    if (!resolved) return;
    const { teamId, teamName, team } = resolved;

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

    const ssoConnected = team.saml?.connection?.state === 'active';
    const directoryConnected = team.saml?.directory?.state === 'active';
    const samlEnforced = team.saml?.enforced === true;
    const hasIdentityProvider = ssoConnected || directoryConnected;
    const checkedAt = new Date().toISOString();
    const nowMs = Date.now();

    const idpEvidence = {
      teamId,
      teamName: teamName ?? null,
      ssoConnected,
      directoryConnected,
      samlEnforced,
      samlConnectionState: team.saml?.connection?.state ?? null,
      directorySyncState: team.saml?.directory?.syncState ?? null,
      checkedAt,
    };

    if (directoryConnected && samlEnforced) {
      ctx.pass({
        title: 'Vercel access is governed by an identity provider',
        resourceType: 'vercel',
        resourceId: 'deprovisioning-controls',
        description:
          'SAML SSO is enforced and Directory Sync is active, so deactivating someone in the identity provider removes their Vercel access.',
        evidence: idpEvidence,
      });
    } else if (hasIdentityProvider) {
      ctx.fail({
        title: 'Identity provider does not fully govern Vercel access',
        resourceType: 'vercel',
        resourceId: 'deprovisioning-controls',
        severity: 'medium',
        description: `Vercel is connected to an identity provider, but ${
          directoryConnected
            ? 'SAML SSO is not enforced, so members can still sign in with a password after being deactivated in the identity provider'
            : 'Directory Sync is not active, so removing someone in the identity provider does not remove their Vercel membership'
        }.`,
        remediation:
          'In Vercel Team Settings > Security & Privacy, enable Directory Sync (SCIM) and turn on "Enforce SAML SSO" so leavers lose Vercel access automatically.',
        evidence: idpEvidence,
      });
    } else {
      ctx.fail({
        title: 'No identity provider connected to Vercel',
        resourceType: 'vercel',
        resourceId: 'deprovisioning-controls',
        severity: 'high',
        description:
          'This Vercel team has no SAML SSO or Directory Sync connection, so removing a leaver from Vercel is a manual step that this check cannot evidence.',
        remediation:
          'Connect your identity provider in Vercel Team Settings > Security & Privacy (SAML SSO + Directory Sync), or keep manual offboarding evidence showing Vercel access was removed for each leaver.',
        evidence: idpEvidence,
      });
    }

    let uncovered = 0;
    for (const member of roster.members) {
      const email = normalizeEmail(member.email);
      const displayName = describeMember(member);
      const centrallyManaged = isCentrallyManaged(member);
      const evidence = {
        email,
        name: member.name ?? null,
        role: member.role,
        uid: member.uid,
        centrallyManaged,
        isEnterpriseManaged: member.isEnterpriseManaged ?? false,
        linkedToSso: Boolean(member.joinedFrom?.ssoUserId),
        linkedToDirectorySync: Boolean(member.joinedFrom?.dsyncUserId),
        teamHasIdentityProvider: hasIdentityProvider,
        addedAt: Number.isFinite(member.createdAt)
          ? new Date(member.createdAt).toISOString()
          : null,
        checkedAt,
      };

      // With no identity provider at all the gap is the team-level control
      // already reported above — repeating it per member would bury that one
      // finding under a fail for every employee. The roster still emits so
      // offboarding reviews can join these accounts to org members.
      if (!hasIdentityProvider) {
        ctx.pass({
          title: 'Account removal is manual',
          resourceType: 'user',
          resourceId: email ?? member.uid,
          description: `${displayName} holds ${member.role} access. With no identity provider connected, this account must be removed by hand when they leave.`,
          evidence,
        });
        continue;
      }

      if (centrallyManaged) {
        ctx.pass({
          title: 'Account deprovisioned by the identity provider',
          resourceType: 'user',
          resourceId: email ?? member.uid,
          description: `${displayName} is linked to the identity provider, so deactivating them there removes their Vercel access.`,
          evidence,
        });
        continue;
      }

      uncovered++;
      ctx.fail({
        title: `Account outside the identity provider: ${displayName}`,
        resourceType: 'user',
        resourceId: email ?? member.uid,
        severity: isPrivilegedRole(member.role) ? 'high' : 'medium',
        description: `${displayName} holds ${member.role} access but was not provisioned through SAML SSO or Directory Sync, so their access survives deactivation in the identity provider.`,
        remediation:
          'Remove this member in Vercel Team Settings > Members and re-invite them through your identity provider so the account is governed by Directory Sync.',
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

    ctx.log(
      `Vercel deprovisioning check complete: ${roster.members.length} accounts (${uncovered} outside the identity provider), ${staleInvites} stale invitation(s)`,
    );
  },
};
