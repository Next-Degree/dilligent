import { TASK_TEMPLATES } from '../../../task-mappings';
import type { CheckContext, IntegrationCheck } from '../../../types';
import { loadWorkspace, memberEvidence, memberLabel, resolveRailwayScope } from '../scope';
import type { RailwayWorkspace, RailwayWorkspaceMember } from '../types';

const MEMBER_REMEDIATION =
  'Ask this member to enable two-factor authentication in Railway under Account Settings > Security. Enforcing 2FA for the workspace blocks them from workspace resources until they do.';

const ENFORCEMENT_REMEDIATION =
  'A workspace admin can turn on 2FA enforcement in the workspace People settings. Members without 2FA then keep their seat but cannot reach workspace resources until they enable it.';

function judgeMember(
  ctx: CheckContext,
  {
    member,
    workspace,
    checkedAt,
  }: { member: RailwayWorkspaceMember; workspace: RailwayWorkspace; checkedAt: string },
): boolean {
  const label = memberLabel(member);
  const resourceId = `${workspace.id}:${member.id}`;
  const evidence = {
    ...memberEvidence(member, workspace),
    name: member.name ?? null,
    twoFactorAuthEnabled: member.twoFactorAuthEnabled ?? null,
    checkedAt,
  };

  if (member.twoFactorAuthEnabled === true) {
    ctx.pass({
      title: `2FA enabled: ${label}`,
      description: `${label} has two-factor authentication enabled on their Railway account.`,
      resourceType: 'railway_member',
      resourceId,
      evidence,
    });
    return true;
  }

  // Nullable in the schema: Railway withholds it from callers who may not see
  // it. "Not reported" must never read as "enabled".
  const unknown = member.twoFactorAuthEnabled === null || member.twoFactorAuthEnabled === undefined;
  const admin = member.role === 'ADMIN';
  ctx.fail({
    title: unknown ? `2FA status unknown: ${label}` : `2FA not enabled: ${label}`,
    description: unknown
      ? `Railway did not report a 2FA status for ${label}, so two-factor authentication cannot be evidenced for this member.`
      : `${label} (${member.role}) can sign in to Railway without two-factor authentication.`,
    resourceType: 'railway_member',
    resourceId,
    severity: unknown ? 'medium' : admin ? 'critical' : 'high',
    remediation: unknown
      ? 'Reconnect Railway with a token created by a workspace admin, so member 2FA status is visible, then re-run the check.'
      : MEMBER_REMEDIATION,
    evidence,
  });
  return false;
}

/**
 * Railway Two-Factor Authentication
 *
 * Two layers, reported separately: whether the workspace enforces 2FA (the
 * control that keeps it true for future members), and whether every current
 * member has 2FA on (the state today). Enforcement alone is not enough: Railway
 * lets a member without 2FA keep their seat and only blocks their access, so
 * each member is still judged on their own flag.
 *
 * Maps to: 2FA
 */
export const twoFactorCheck: IntegrationCheck = {
  id: 'railway-2fa-enabled',
  name: 'Two-Factor Authentication',
  description:
    'Verify every Railway workspace enforces 2FA and every member has two-factor authentication enabled',
  service: 'access',
  taskMapping: TASK_TEMPLATES.twoFactorAuth,
  defaultSeverity: 'high',

  run: async (ctx: CheckContext) => {
    ctx.log('Starting Railway 2FA check');

    const scope = await resolveRailwayScope(ctx);
    if (!scope) return;
    const { checkedAt } = scope;

    for (const ref of scope.workspaces) {
      const workspace = await loadWorkspace(ctx, { workspace: ref, checkedAt });
      if (!workspace) continue;

      const workspaceEvidence = {
        verification: 'api-verified',
        workspaceId: workspace.id,
        workspaceName: workspace.name,
        has2FAEnforcement: workspace.has2FAEnforcement,
        memberCount: workspace.members.length,
        checkedAt,
      };

      if (workspace.has2FAEnforcement === true) {
        ctx.pass({
          title: `2FA enforced: ${workspace.name}`,
          description: `Workspace "${workspace.name}" requires members to have 2FA enabled before they can access its resources.`,
          resourceType: 'railway_workspace',
          resourceId: workspace.id,
          evidence: workspaceEvidence,
        });
      } else {
        ctx.fail({
          title: `2FA not enforced: ${workspace.name}`,
          description: `Workspace "${workspace.name}" does not require two-factor authentication, so a member without 2FA can reach its projects, variables and deployments.`,
          resourceType: 'railway_workspace',
          resourceId: workspace.id,
          severity: 'high',
          remediation: ENFORCEMENT_REMEDIATION,
          evidence: workspaceEvidence,
        });
      }

      if (workspace.members.length === 0) {
        // Every workspace has at least the member who created it, so an empty
        // list means the read went wrong. Passing would green the task on no data.
        ctx.fail({
          title: `No members returned for ${workspace.name}`,
          description:
            'Railway returned an empty member list, so two-factor authentication cannot be evidenced for anyone.',
          resourceType: 'railway_workspace',
          resourceId: `${workspace.id}:members`,
          severity: 'medium',
          remediation:
            'Confirm the token was created by a workspace admin and the workspace still has members, then re-run the check.',
          evidence: workspaceEvidence,
        });
        continue;
      }

      let withTwoFactor = 0;
      for (const member of workspace.members) {
        if (judgeMember(ctx, { member, workspace, checkedAt })) withTwoFactor++;
      }
      ctx.log(
        `Workspace ${workspace.id}: ${withTwoFactor}/${workspace.members.length} member(s) with 2FA`,
      );
    }

    ctx.log('Railway 2FA check complete');
  },
};
