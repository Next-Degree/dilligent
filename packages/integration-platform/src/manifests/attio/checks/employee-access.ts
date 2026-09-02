import { TASK_TEMPLATES } from '../../../task-mappings';
import type { CheckContext, IntegrationCheck } from '../../../types';
import type { AttioWorkspaceMember } from '../types';
import {
  describeAccessLevel,
  fetchWorkspace,
  fetchWorkspaceMembers,
  hasWorkspaceAccess,
  memberEmail,
  memberEvidence,
  memberName,
} from './shared';

/**
 * Employee Access Review Check
 *
 * Lists every Attio workspace member holding access, for access review.
 * Maps to: Employee Access task.
 *
 * Access is an inventory, not a violation, so every member row emits as a pass —
 * the same contract as the Google Workspace and Linear employee-access checks.
 * Rows are keyed `resourceType: 'user'` / `resourceId: <lowercased email>` so
 * person-scoped consumers can join them to org members by email.
 */
export const employeeAccessCheck: IntegrationCheck = {
  id: 'attio_employee_access',
  name: 'Employee Access',
  description: 'Lists Attio workspace members and the access level each one holds',
  service: 'user-management',
  taskMapping: TASK_TEMPLATES.employeeAccess,
  defaultSeverity: 'medium',

  run: async (ctx: CheckContext) => {
    ctx.log('Starting Attio Employee Access check');

    const workspace = await fetchWorkspace(ctx);
    const members = await fetchWorkspaceMembers(ctx);
    const checkedAt = new Date().toISOString();

    const active: AttioWorkspaceMember[] = [];
    const suspended: AttioWorkspaceMember[] = [];
    for (const member of members) {
      (hasWorkspaceAccess(member) ? active : suspended).push(member);
    }

    ctx.log(
      `Fetched ${members.length} Attio workspace members ` +
        `(${active.length} with access, ${suspended.length} suspended)` +
        (workspace.name ? ` in ${workspace.name}` : ''),
    );

    // Suspended members keep their Attio row forever so past actions stay attributable.
    // They hold no access, so they are recorded under a separate resourceType — the
    // audit trail keeps them while person-scoped consumers, which read resourceType
    // 'user', never mistake them for someone with a live seat.
    for (const member of suspended) {
      ctx.pass({
        title: 'Access Revoked',
        resourceType: 'suspended_member',
        resourceId: memberEmail(member) || member.id.workspace_member_id,
        description: `${memberName(member)} is suspended in Attio and holds no workspace access`,
        evidence: { ...memberEvidence(member, workspace), checkedAt },
      });
    }

    // No active members is still a completed review — emit one org-level row so the
    // run never stores zero results, which would read as "no evidence collected".
    if (active.length === 0) {
      ctx.pass({
        title: 'Employee Access List',
        resourceType: 'organization',
        resourceId: workspace.slug,
        description:
          `No Attio workspace members hold access (${members.length} member records ` +
          `inspected, ${suspended.length} of them suspended)`,
        evidence: {
          totalUsers: 0,
          inspectedUsers: members.length,
          suspendedUsers: suspended.length,
          workspace: workspace.name,
          checkedAt,
        },
      });
      ctx.log('Attio Employee Access check complete: 0 members with access');
      return;
    }

    let emitted = 0;
    for (const member of active) {
      const email = memberEmail(member);

      // Without an email the row cannot be joined to an org member, so it would be an
      // orphan in every person-scoped view. Warn rather than emit a misleading row.
      if (!email) {
        ctx.warn(
          `Skipping Attio member ${member.id.workspace_member_id}: no email address on record`,
        );
        continue;
      }

      const role = describeAccessLevel(member);

      ctx.pass({
        title: 'Employee Access',
        resourceType: 'user',
        resourceId: email,
        description: `${memberName(member)} has access to Attio as ${role}`,
        evidence: { ...memberEvidence(member, workspace), roles: [role], checkedAt },
      });
      emitted++;
    }

    const admins = active.filter((member) => member.access_level === 'admin').length;

    ctx.log(
      `Attio Employee Access check complete: ${emitted} members with access ` +
        `(${admins} admins), ${suspended.length} suspended`,
    );
  },
};
