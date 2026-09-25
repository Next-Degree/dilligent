import { TASK_TEMPLATES } from '../../../task-mappings';
import type { CheckContext, IntegrationCheck } from '../../../types';
import { normalizeEmail } from '../../people-directory';
import { teamSettingsUrl } from '../client';
import { loadDirectory } from '../directory';
import { inviteResourceId } from '../members';
import { loadRoster, resolveOrganizations } from '../scope';
import {
  DEFAULT_PENDING_INVITE_MAX_AGE_DAYS,
  parseInteger,
  pendingInviteMaxAgeDaysVariable,
  targetOrganizationsVariable,
} from '../variables';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Trigger.dev Pending Invitations
 *
 * An open invitation is access waiting to be claimed. It is flagged when it has sat
 * unaccepted past the age limit, or when it was sent to someone who is not an active
 * employee — the invitee may have left, or the invitation went to the wrong address.
 *
 * Maps to: Employee Access
 */
export const pendingInvitesCheck: IntegrationCheck = {
  id: 'pending-invites',
  name: 'Pending Invitations',
  description: 'Verify open Trigger.dev invitations are recent and addressed to active employees',
  service: 'access',
  taskMapping: TASK_TEMPLATES.employeeAccess,
  defaultSeverity: 'medium',
  variables: [targetOrganizationsVariable, pendingInviteMaxAgeDaysVariable],

  run: async (ctx: CheckContext) => {
    ctx.log('Starting Trigger.dev pending invitations check');

    const scope = await resolveOrganizations(ctx);
    if (!scope) return;

    const maxAgeDays = parseInteger({
      variables: ctx.variables,
      id: pendingInviteMaxAgeDaysVariable.id,
      fallback: DEFAULT_PENDING_INVITE_MAX_AGE_DAYS,
    });
    const directory = await loadDirectory(ctx);
    const nowMs = Date.now();

    for (const organization of scope.organizations) {
      const roster = await loadRoster(ctx, { organization, checkedAt: scope.checkedAt });
      if (!roster) continue;

      if (roster.invites.length === 0) {
        ctx.pass({
          title: `No pending invitations: ${organization.title}`,
          description: `${organization.title} has no open invitations.`,
          resourceType: 'trigger_dev_organization',
          resourceId: organization.id,
          evidence: { organization: organization.slug, inviteCount: 0, checkedAt: scope.checkedAt },
        });
        continue;
      }

      for (const invite of roster.invites) {
        const email = normalizeEmail(invite.email);
        const sentMs = Date.parse(invite.updatedAt);
        const ageDays = Number.isFinite(sentMs) ? Math.floor((nowMs - sentMs) / MS_PER_DAY) : null;
        const person = directory.byEmail.get(email);

        // An invite passes only when both its age and its invitee were verified. A
        // dimension that could not be checked is a problem, not a skip.
        const problems: string[] = [];
        if (ageDays === null) {
          problems.push('its age could not be determined');
        } else if (ageDays > maxAgeDays) {
          problems.push(`it has been open for ${ageDays} days (limit ${maxAgeDays})`);
        }
        if (!directory.available) {
          problems.push(
            'the People directory was unavailable to confirm the invitee is an employee',
          );
        } else if (!person?.isActive) {
          problems.push(
            person ? 'the invitee is offboarded' : 'the invitee is not in the People directory',
          );
        }

        const resourceId = inviteResourceId({ organization, email });
        const evidence = {
          organization: organization.slug,
          inviteId: invite.id,
          email,
          sentAt: invite.updatedAt,
          ageDays,
          maxAgeDays,
          invitedBy: invite.inviter?.email ?? null,
          directoryChecked: directory.available,
          directoryActive: person?.isActive ?? null,
          checkedAt: scope.checkedAt,
        };

        if (problems.length === 0) {
          ctx.pass({
            title: `Invitation in order: ${email}`,
            description: `The invitation to ${email} is ${ageDays} day(s) old and addressed to an active employee.`,
            resourceType: 'trigger_dev_invite',
            resourceId,
            evidence,
          });
          continue;
        }

        ctx.fail({
          title: `Pending invitation needs review: ${email}`,
          description: `The invitation to ${email} in ${organization.title} should be reviewed because ${problems.join(' and ')}.`,
          resourceType: 'trigger_dev_invite',
          resourceId,
          severity: 'medium',
          remediation: `Revoke the invitation under ${teamSettingsUrl(organization)}, or resend it if the person still needs access.`,
          evidence,
        });
      }
    }

    ctx.log('Trigger.dev pending invitations check complete');
  },
};
