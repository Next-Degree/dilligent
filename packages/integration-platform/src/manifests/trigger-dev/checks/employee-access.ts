import { TASK_TEMPLATES } from '../../../task-mappings';
import type { CheckContext, IntegrationCheck } from '../../../types';
import { teamSettingsUrl } from '../client';
import { loadDirectory, normalizeEmail } from '../directory';
import { isAdmin, memberEvidence, memberLabel, memberResourceId } from '../members';
import { loadRoster, resolveOrganizations } from '../scope';
import { targetOrganizationsVariable } from '../variables';

/**
 * Trigger.dev Employee Access
 *
 * Reconciles every Trigger.dev organization member against the People directory. A
 * member whose person has left, or who is not an employee at all, holds access to the
 * company's background jobs, their payloads and their environment variables without a
 * reason to.
 *
 * Maps to: Employee Access
 */
export const employeeAccessCheck: IntegrationCheck = {
  id: 'employee-access',
  name: 'Employee Access',
  description:
    'Verify every Trigger.dev organization member is an active employee, and that no leaver retains access',
  service: 'access',
  taskMapping: TASK_TEMPLATES.employeeAccess,
  defaultSeverity: 'high',
  variables: [targetOrganizationsVariable],

  run: async (ctx: CheckContext) => {
    ctx.log('Starting Trigger.dev employee access check');

    const scope = await resolveOrganizations(ctx);
    if (!scope) return;

    // Without the directory there is nothing to reconcile against. Say so once rather
    // than passing — "could not check" must never read as "no leaver has access".
    const directory = await loadDirectory(ctx);
    if (!directory.available) {
      ctx.fail({
        title: 'Cannot verify Trigger.dev access without the People directory',
        description:
          'The People directory was unavailable, so Trigger.dev members could not be matched to employees.',
        resourceType: 'trigger_dev_connection',
        resourceId: 'people-directory',
        severity: 'medium',
        remediation: 'Add your employees under People, then re-run the check.',
        evidence: { checkedAt: scope.checkedAt },
      });
      return;
    }

    for (const organization of scope.organizations) {
      const roster = await loadRoster(ctx, { organization, checkedAt: scope.checkedAt });
      if (!roster) continue;

      for (const member of roster.members) {
        const person = directory.byEmail.get(normalizeEmail(member.user.email));
        const admin = isAdmin(member);
        const evidence = {
          ...memberEvidence(member, organization),
          directoryPersonId: person?.id ?? null,
          directoryActive: person?.isActive ?? null,
          offboardDate: person?.offboardDate ?? null,
          checkedAt: scope.checkedAt,
        };

        if (person?.isActive) {
          ctx.pass({
            title: `Employee: ${memberLabel(member)}`,
            description: `${memberLabel(member)} is an active employee with the ${member.role} role in ${organization.title}.`,
            resourceType: 'trigger_dev_member',
            resourceId: memberResourceId(member, organization),
            evidence,
          });
          continue;
        }

        if (person) {
          ctx.fail({
            title: `Leaver retains Trigger.dev access: ${memberLabel(member)}`,
            description: `${memberLabel(member)} is offboarded in the People directory but is still a${admin ? 'n Admin' : ' member'} of ${organization.title}.`,
            resourceType: 'trigger_dev_member',
            resourceId: memberResourceId(member, organization),
            severity: admin ? 'critical' : 'high',
            remediation: `Remove the member under ${teamSettingsUrl(organization)}, then rotate any environment API keys they could read.`,
            evidence,
          });
          continue;
        }

        ctx.fail({
          title: `Not a known employee: ${memberLabel(member)}`,
          description: `${memberLabel(member)} is a${admin ? 'n Admin' : ' member'} of ${organization.title} but matches no one in the People directory.`,
          resourceType: 'trigger_dev_member',
          resourceId: memberResourceId(member, organization),
          severity: admin ? 'high' : 'medium',
          remediation: `Remove the member under ${teamSettingsUrl(organization)} if they should not have access. If they are an employee who signs in with another address, link that address on their People record.`,
          evidence,
        });
      }
    }

    ctx.log('Trigger.dev employee access check complete');
  },
};
