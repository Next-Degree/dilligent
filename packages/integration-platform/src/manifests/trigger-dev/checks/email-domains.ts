import { TASK_TEMPLATES } from '../../../task-mappings';
import type { CheckContext, IntegrationCheck } from '../../../types';
import { normalizeEmail } from '../../people-directory';
import { teamSettingsUrl } from '../client';
import { emailDomain, loadDirectory } from '../directory';
import { inviteResourceId, memberEvidence, memberLabel, memberResourceId } from '../members';
import { loadRoster, resolveOrganizations } from '../scope';
import {
  corporateEmailDomainsVariable,
  parseCorporateDomains,
  targetOrganizationsVariable,
} from '../variables';

/**
 * Trigger.dev Corporate Email Accounts
 *
 * An account on a personal mailbox survives offboarding: disabling the person's work
 * account does not lock them out of Trigger.dev. Every member and pending invitation
 * must use a corporate domain — the configured list, or failing that the domains of
 * active people in the directory.
 *
 * Maps to: Employee Access
 */
export const emailDomainsCheck: IntegrationCheck = {
  id: 'corporate-email-domains',
  name: 'Corporate Email Accounts',
  description:
    'Verify every Trigger.dev member and invitation uses a corporate email domain rather than a personal address',
  service: 'access',
  taskMapping: TASK_TEMPLATES.employeeAccess,
  defaultSeverity: 'medium',
  variables: [targetOrganizationsVariable, corporateEmailDomainsVariable],

  run: async (ctx: CheckContext) => {
    ctx.log('Starting Trigger.dev corporate email check');

    const scope = await resolveOrganizations(ctx);
    if (!scope) return;

    let domains = parseCorporateDomains(ctx.variables);
    let domainSource = 'configured';
    let directoryAvailable: boolean | null = null;
    if (domains.size === 0) {
      const directory = await loadDirectory(ctx);
      domains = directory.activeDomains;
      directoryAvailable = directory.available;
      domainSource = 'people-directory';
    }

    // Guessing would flag the whole roster, so with no domains to compare against we
    // report the gap once instead.
    if (domains.size === 0) {
      ctx.fail({
        title: 'No corporate email domains to check against',
        description:
          directoryAvailable === false
            ? 'No corporate domains are configured, and the People directory could not be read to derive them.'
            : 'No corporate domains are configured, and no active person in the People directory has a work email domain to derive them from.',
        resourceType: 'trigger_dev_connection',
        resourceId: 'corporate-email-domains',
        severity: 'low',
        remediation:
          'Set "Corporate email domains" on this connection (for example acme.com), then re-run the check.',
        evidence: { directoryAvailable, checkedAt: scope.checkedAt },
      });
      return;
    }

    const allowed = [...domains].sort();
    const isCorporate = (email: string) => domains.has(emailDomain(email));

    for (const organization of scope.organizations) {
      const roster = await loadRoster(ctx, { organization, checkedAt: scope.checkedAt });
      if (!roster) continue;

      for (const member of roster.members) {
        const email = normalizeEmail(member.user.email);
        const evidence = {
          ...memberEvidence({ member, organization }),
          domain: emailDomain(email),
          allowedDomains: allowed,
          domainSource,
          checkedAt: scope.checkedAt,
        };

        if (isCorporate(email)) {
          ctx.pass({
            title: `Corporate account: ${memberLabel(member)}`,
            description: `${email} uses the corporate domain ${emailDomain(email)}.`,
            resourceType: 'trigger_dev_member',
            resourceId: memberResourceId({ member, organization }),
            evidence,
          });
          continue;
        }

        ctx.fail({
          title: `Non-corporate account: ${memberLabel(member)}`,
          description: `${email} in ${organization.title} is not on an approved domain (${allowed.join(', ')}).`,
          resourceType: 'trigger_dev_member',
          resourceId: memberResourceId({ member, organization }),
          severity: 'medium',
          remediation: `Invite the person again under their work address and remove ${email} under ${teamSettingsUrl(organization)}.`,
          evidence,
        });
      }

      for (const invite of roster.invites) {
        const email = normalizeEmail(invite.email);
        if (isCorporate(email)) continue;
        ctx.fail({
          title: `Invitation to non-corporate address: ${email}`,
          description: `An open invitation to ${email} in ${organization.title} is not on an approved domain (${allowed.join(', ')}).`,
          resourceType: 'trigger_dev_invite',
          resourceId: inviteResourceId({ organization, email }),
          severity: 'medium',
          remediation: `Revoke the invitation under ${teamSettingsUrl(organization)} and invite the person's work address instead.`,
          evidence: {
            organization: organization.slug,
            inviteId: invite.id,
            email,
            domain: emailDomain(email),
            allowedDomains: allowed,
            domainSource,
            checkedAt: scope.checkedAt,
          },
        });
      }
    }

    ctx.log('Trigger.dev corporate email check complete');
  },
};
