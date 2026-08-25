import { TASK_TEMPLATES } from '../../../task-mappings';
import type { CheckContext, IntegrationCheck } from '../../../types';
import {
  describeLevel,
  emailDomain,
  fetchAllResults,
  friendlyError,
  getOrganizationDetail,
  isPrivilegedLevel,
  listOrganizations,
  normalizeEmail,
  POSTHOG_HOST,
} from '../client';
import type { PostHogOrganizationMember, PostHogOrganizationSummary } from '../types';
import {
  filterOrganizations,
  parseBooleanVariable,
  parseTargetOrganizations,
  requireOrgEnforcementVariable,
  targetOrganizationsVariable,
  treatSsoAsTwoFactorVariable,
} from '../variables';

const ENROL_REMEDIATION =
  'Ask the member to enable two-factor authentication from their PostHog account settings ' +
  '(Settings > Account > Two-factor authentication), then re-run this check.';

/**
 * Reports the organization-wide 2FA enforcement setting.
 *
 * Enforcement is reported separately from per-member enrolment because it answers a
 * different question — "can a new member skip 2FA?" rather than "has this person set it
 * up?" — and because it is a paid PostHog feature, so it only fails the check when the
 * customer has asked for it via `require_2fa_enforcement`.
 */
async function reportOrganizationEnforcement(options: {
  ctx: CheckContext;
  organization: PostHogOrganizationSummary;
  required: boolean;
  checkedAt: string;
}): Promise<void> {
  const { ctx, organization, required, checkedAt } = options;

  const detail = await getOrganizationDetail(ctx, organization.id);
  if (!detail) return;

  const enforced = detail.enforce_2fa === true;
  const resourceId = organization.slug || organization.id;
  const evidence = {
    organization: organization.name,
    organizationId: organization.id,
    enforce2fa: detail.enforce_2fa ?? null,
    enforceVerifiedDomains: detail.enforce_verified_domains ?? null,
    memberCount: detail.member_count ?? null,
    checkedAt,
  };

  if (enforced || !required) {
    if (!enforced) {
      ctx.warn(
        `PostHog organization ${organization.name} does not enforce 2FA for all members. ` +
          'Enable "Require 2FA" in the integration settings to make this a finding.',
      );
    }
    ctx.pass({
      title: enforced ? '2FA Enforced Organization-wide' : 'Organization 2FA Setting Recorded',
      description: enforced
        ? `${organization.name} requires every member to enrol in two-factor authentication.`
        : `${organization.name} does not require 2FA organization-wide; per-member enrolment is reported below.`,
      resourceType: 'organization',
      resourceId,
      evidence,
    });
    return;
  }

  ctx.fail({
    title: '2FA Not Enforced Organization-wide',
    description: `${organization.name} does not require members to enrol in two-factor authentication.`,
    resourceType: 'organization',
    resourceId,
    severity: 'medium',
    remediation:
      `Turn on "Enforce 2FA" under Settings > Organization (${POSTHOG_HOST}/settings/organization) ` +
      'so every member must enrol before accessing PostHog.',
    evidence,
  });
}

/**
 * Two-Factor Authentication
 *
 * Verifies every PostHog organization member has 2FA enabled. Emits one row per person
 * keyed by lowercased email (`resourceType: 'user'`) so the result feeds the same
 * per-employee 2FA reporting as the other providers bound to the 2FA task.
 */
export const twoFactorAuthCheck: IntegrationCheck = {
  id: 'posthog_two_factor_auth',
  name: '2FA Enabled',
  description: 'Verifies every PostHog organization member has two-factor authentication enabled',
  taskMapping: TASK_TEMPLATES.twoFactorAuth,
  defaultSeverity: 'high',
  variables: [
    targetOrganizationsVariable,
    treatSsoAsTwoFactorVariable,
    requireOrgEnforcementVariable,
  ],

  run: async (ctx: CheckContext) => {
    const treatSsoAsTwoFactor = parseBooleanVariable(
      ctx.variables,
      treatSsoAsTwoFactorVariable.id,
      true,
    );
    const requireEnforcement = parseBooleanVariable(
      ctx.variables,
      requireOrgEnforcementVariable.id,
      false,
    );
    const checkedAt = new Date().toISOString();

    ctx.log(`Starting PostHog 2FA check against ${POSTHOG_HOST}`);

    let organizations: PostHogOrganizationSummary[];
    try {
      organizations = filterOrganizations(
        await listOrganizations(ctx),
        parseTargetOrganizations(ctx.variables),
      );
    } catch (error) {
      throw friendlyError(error);
    }

    ctx.log(`Checking ${organizations.length} PostHog organization(s)`);

    for (const organization of organizations) {
      await reportOrganizationEnforcement({
        ctx,
        organization,
        required: requireEnforcement,
        checkedAt,
      });

      let members: PostHogOrganizationMember[];
      let truncated: boolean;
      try {
        const result = await fetchAllResults<PostHogOrganizationMember>(ctx, {
          path: `/api/organizations/${organization.id}/members/`,
        });
        members = result.items;
        truncated = result.truncated;
      } catch (error) {
        throw friendlyError(error);
      }

      if (truncated) {
        ctx.warn(
          `PostHog member list for ${organization.name} truncated at ${members.length} records; ` +
            'some accounts were not checked for 2FA.',
        );
      }

      ctx.log(`Checking 2FA for ${members.length} member(s) in ${organization.name}`);

      let missing = 0;

      for (const member of members) {
        const email = normalizeEmail(member.user?.email);
        const role = describeLevel(member.level);
        const privileged = isPrivilegedLevel(member.level);
        const name =
          [member.user?.first_name, member.user?.last_name].filter(Boolean).join(' ').trim() ||
          email ||
          member.id;

        // Without an email there is nothing to key a per-user row to. The account still
        // appears in the Valid Email Accounts check, which owns that finding.
        if (!email) {
          ctx.warn(`Skipping PostHog member ${member.id}: no email on record`);
          continue;
        }

        const enabled = member.is_2fa_enabled === true;
        const ssoCovered = !enabled && treatSsoAsTwoFactor && member.has_social_auth === true;

        const evidence = {
          email,
          name,
          role,
          level: member.level ?? null,
          isAdmin: privileged,
          domain: emailDomain(email) || null,
          is2faEnabled: member.is_2fa_enabled ?? null,
          hasSocialAuth: Boolean(member.has_social_auth),
          coveredBySso: ssoCovered,
          organization: organization.name,
          organizationId: organization.id,
          externalId: member.user?.uuid ?? member.id,
          lastLogin: member.last_login ?? null,
          truncated,
          checkedAt,
        };

        if (enabled || ssoCovered) {
          ctx.pass({
            title: '2FA Enabled',
            description: ssoCovered
              ? `${name} signs in to PostHog through an SSO provider, which enforces multi-factor authentication upstream.`
              : `${name} has two-factor authentication enabled in PostHog.`,
            resourceType: 'user',
            resourceId: email,
            evidence,
          });
          continue;
        }

        missing++;
        ctx.fail({
          title: '2FA Not Enabled',
          description: `${name} (${role} in ${organization.name}) does not have two-factor authentication enabled in PostHog.`,
          resourceType: 'user',
          resourceId: email,
          severity: privileged ? 'high' : 'medium',
          remediation: ENROL_REMEDIATION,
          evidence,
        });
      }

      ctx.log(
        `PostHog 2FA check complete for ${organization.name}: ` +
          `${members.length} member(s) checked, ${missing} without 2FA`,
      );
    }
  },
};
