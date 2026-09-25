import { TASK_TEMPLATES } from '../../../task-mappings';
import type { CheckContext, IntegrationCheck } from '../../../types';
import { loadDirectory, normalizeEmail } from '../directory';
import { loadWorkspace, memberEvidence, memberLabel, resolveRailwayScope } from '../scope';

const REMOVE_REMEDIATION =
  'A workspace admin can remove the member under the workspace People settings in Railway. Rotate any variables or tokens they could read.';

/**
 * Railway Employee Access
 *
 * Reconciles every workspace member against the People directory. A member
 * whose person has left, or who is not an employee at all, can read the
 * workspace's environment variables and deploy to production.
 *
 * Maps to: Employee Access
 */
export const employeeAccessCheck: IntegrationCheck = {
  id: 'railway-employee-access',
  name: 'Employee Access',
  description:
    'Verify every Railway workspace member is an active employee, and that no leaver retains access',
  service: 'access',
  taskMapping: TASK_TEMPLATES.employeeAccess,
  defaultSeverity: 'high',

  run: async (ctx: CheckContext) => {
    ctx.log('Starting Railway employee access check');

    // Read the directory first: without it there is nothing to reconcile
    // against, and spending Railway's small rate limit would be wasted.
    // "Could not check" must never read as "no leaver has access".
    const directory = await loadDirectory(ctx);
    if (!directory.available) {
      ctx.fail({
        title: 'Cannot verify Railway access without the People directory',
        description:
          'The People directory was unavailable, so Railway members could not be matched to employees.',
        resourceType: 'railway',
        resourceId: 'people-directory',
        severity: 'medium',
        remediation: 'Add your employees under People, then re-run the check.',
        evidence: { checkedAt: new Date().toISOString() },
      });
      return;
    }

    const scope = await resolveRailwayScope(ctx);
    if (!scope) return;
    const { checkedAt } = scope;

    for (const ref of scope.workspaces) {
      const workspace = await loadWorkspace(ctx, { workspace: ref, checkedAt });
      if (!workspace) continue;

      for (const member of workspace.members) {
        const label = memberLabel(member);
        const person = directory.byEmail.get(normalizeEmail(member.email));
        const admin = member.role === 'ADMIN';
        const base = { resourceType: 'railway_member', resourceId: `${workspace.id}:${member.id}` };
        const evidence = {
          ...memberEvidence(member, workspace),
          directoryPersonId: person?.id ?? null,
          directoryActive: person?.isActive ?? null,
          offboardDate: person?.offboardDate ?? null,
          checkedAt,
        };

        if (person?.isActive) {
          ctx.pass({
            ...base,
            title: `Employee: ${label}`,
            description: `${label} is an active employee with the ${member.role} role in ${workspace.name}.`,
            evidence,
          });
          continue;
        }

        if (person) {
          ctx.fail({
            ...base,
            title: `Leaver retains Railway access: ${label}`,
            description: `${label} is offboarded in the People directory but is still ${admin ? 'an admin' : 'a member'} of ${workspace.name}.`,
            severity: admin ? 'critical' : 'high',
            remediation: REMOVE_REMEDIATION,
            evidence,
          });
          continue;
        }

        ctx.fail({
          ...base,
          title: `Not a known employee: ${label}`,
          description: `${label} is ${admin ? 'an admin' : 'a member'} of ${workspace.name} but matches no one in the People directory.`,
          severity: admin ? 'high' : 'medium',
          remediation: `${REMOVE_REMEDIATION} If they are an employee who signs in with another address, link that address on their People record.`,
          evidence,
        });
      }
    }

    ctx.log('Railway employee access check complete');
  },
};
