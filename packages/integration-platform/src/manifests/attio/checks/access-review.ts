import { TASK_TEMPLATES } from '../../../task-mappings';
import type { CheckContext, IntegrationCheck } from '../../../types';
import { maxAdminsVariable, parseMaxAdmins } from '../variables';
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
 * Access Review Log Check
 *
 * Records the privilege each Attio workspace member holds, as the evidence log an
 * access review is signed off against, and raises a finding when admin rights are
 * spread wider than the org allows.
 *
 * Distinct from the Employee Access check, which answers "who has Attio at all":
 * this one answers "at what privilege, and is that still justified". Rows use
 * `resourceType: 'access_grant'` so they never collide with the employee roster.
 *
 * Maps to: Access Review Log task.
 */
export const accessReviewCheck: IntegrationCheck = {
  id: 'attio_access_review',
  name: 'Access Review Log',
  description: "Records each Attio member's privilege level and flags excess workspace admins",
  service: 'user-management',
  taskMapping: TASK_TEMPLATES.accessReviewLog,
  defaultSeverity: 'medium',
  variables: [maxAdminsVariable],

  run: async (ctx: CheckContext) => {
    ctx.log('Starting Attio Access Review check');

    const maxAdmins = parseMaxAdmins(ctx.variables);
    const workspace = await fetchWorkspace(ctx);
    const allMembers = await fetchWorkspaceMembers(ctx);
    const members = allMembers.filter(hasWorkspaceAccess);
    const admins = members.filter((member) => member.access_level === 'admin');
    const checkedAt = new Date().toISOString();

    ctx.log(
      `Reviewing ${members.length} Attio members with access ` +
        `(${admins.length} admins)` +
        (maxAdmins === null ? '; no admin threshold configured' : `; threshold is ${maxAdmins}`),
    );

    for (const member of members) {
      const role = describeAccessLevel(member);
      ctx.pass({
        title: `Access Reviewed: ${role}`,
        resourceType: 'access_grant',
        resourceId: memberEmail(member) || member.id.workspace_member_id,
        description: `${memberName(member)} holds ${role} privileges in Attio`,
        evidence: { ...memberEvidence(member, workspace), checkedAt },
      });
    }

    // Always emit the workspace summary — it is the row an auditor reads first, and it
    // keeps the run non-empty when the workspace has no members at all.
    ctx.pass({
      title: 'Access Review Summary',
      resourceType: 'organization',
      resourceId: workspace.slug,
      description:
        `${members.length} member(s) hold Attio access: ${admins.length} admin(s), ` +
        `${members.length - admins.length} member(s). ` +
        `${allMembers.length - members.length} suspended account(s) retained for attribution.`,
      evidence: {
        totalUsers: members.length,
        adminUsers: admins.length,
        suspendedUsers: allMembers.length - members.length,
        adminEmails: admins.map((admin) => memberEmail(admin)).filter(Boolean),
        maxAdmins,
        workspace: workspace.name,
        checkedAt,
      },
    });

    // Without a configured threshold there is no policy to violate, so the check stays
    // an evidence log rather than inventing a limit on the customer's behalf.
    if (maxAdmins === null || admins.length <= maxAdmins) {
      ctx.log(`Attio Access Review check complete: ${members.length} grants recorded`);
      return;
    }

    ctx.fail({
      title: `${admins.length} Attio admins exceeds the limit of ${maxAdmins}`,
      resourceType: 'organization',
      resourceId: workspace.slug,
      severity: 'medium',
      description:
        `The Attio workspace has ${admins.length} admins but your access policy allows ` +
        `${maxAdmins}. Admins can change workspace settings, manage members, and export ` +
        'all CRM data.',
      remediation:
        'In Attio, open Workspace settings > Members and downgrade the admins who no longer ' +
        `need it to Member: ${admins.map((admin) => memberEmail(admin) || memberName(admin)).join(', ')}.`,
      evidence: {
        adminUsers: admins.length,
        maxAdmins,
        adminEmails: admins.map((admin) => memberEmail(admin)).filter(Boolean),
        workspace: workspace.name,
        checkedAt,
      },
    });

    ctx.log(
      `Attio Access Review check complete: ${members.length} grants recorded, ` +
        `admin count ${admins.length} over the configured limit of ${maxAdmins}`,
    );
  },
};
