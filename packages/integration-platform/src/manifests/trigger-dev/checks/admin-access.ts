import { TASK_TEMPLATES } from '../../../task-mappings';
import type { CheckContext, IntegrationCheck } from '../../../types';
import { normalizeEmail } from '../../people-directory';
import { teamSettingsUrl } from '../client';
import { isAdmin } from '../members';
import { loadRoster, resolveOrganizations } from '../scope';
import {
  DEFAULT_MAX_ADMINS,
  maxAdminsVariable,
  parseInteger,
  targetOrganizationsVariable,
} from '../variables';

/**
 * Trigger.dev Admin Least Privilege
 *
 * Admins can invite members, change roles, manage billing and delete projects, so the
 * role should be held by as few people as the organization can operate with. Records
 * the Admin list on every run as access-review evidence, and fails an organization
 * with more Admins than the configured limit.
 *
 * Maps to: Access Review Log
 */
export const adminAccessCheck: IntegrationCheck = {
  id: 'admin-access',
  name: 'Admin Least Privilege',
  description: 'Verify the Trigger.dev Admin role is limited to a small, reviewed set of people',
  service: 'access',
  taskMapping: TASK_TEMPLATES.accessReviewLog,
  defaultSeverity: 'medium',
  variables: [targetOrganizationsVariable, maxAdminsVariable],

  run: async (ctx: CheckContext) => {
    ctx.log('Starting Trigger.dev admin least privilege check');

    const scope = await resolveOrganizations(ctx);
    if (!scope) return;

    const maxAdmins = parseInteger({
      variables: ctx.variables,
      id: maxAdminsVariable.id,
      fallback: DEFAULT_MAX_ADMINS,
    });

    for (const organization of scope.organizations) {
      const roster = await loadRoster(ctx, { organization, checkedAt: scope.checkedAt });
      if (!roster) continue;

      const admins = roster.members.filter(isAdmin);
      const evidence = {
        organizationId: organization.id,
        organization: organization.slug,
        memberCount: roster.members.length,
        adminCount: admins.length,
        maxAdmins,
        admins: admins.map((admin) => ({
          email: normalizeEmail(admin.user.email),
          name: admin.user.name,
        })),
        checkedAt: scope.checkedAt,
      };

      if (admins.length <= maxAdmins) {
        ctx.pass({
          title: `Admin role limited: ${organization.title}`,
          description: `${admins.length} of ${roster.members.length} member(s) hold the Admin role (limit ${maxAdmins}).`,
          resourceType: 'trigger_dev_organization',
          resourceId: organization.id,
          evidence,
        });
        continue;
      }

      ctx.fail({
        title: `Too many Admins: ${organization.title}`,
        description: `${admins.length} of ${roster.members.length} member(s) hold the Admin role, above the limit of ${maxAdmins}.`,
        resourceType: 'trigger_dev_organization',
        resourceId: organization.id,
        severity: 'medium',
        remediation: `Change members who do not need to manage the organization to the Member role under ${teamSettingsUrl(organization)}, or raise the limit if the extra Admins are justified.`,
        evidence,
      });
    }

    ctx.log('Trigger.dev admin least privilege check complete');
  },
};
