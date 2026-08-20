import { TASK_TEMPLATES } from '../../../task-mappings';
import type { CheckContext, FindingSeverity, IntegrationCheck } from '../../../types';
import {
  describeLevel,
  emailDomain,
  fetchAllResults,
  friendlyError,
  isPrivilegedLevel,
  isValidEmailFormat,
  listOrganizations,
  normalizeEmail,
  resolveHost,
} from '../client';
import type { PostHogOrganizationMember, PostHogOrganizationSummary } from '../types';
import {
  allowedEmailDomainsVariable,
  filterOrganizations,
  includePendingInvitesVariable,
  parseAllowedEmailDomains,
  parseBooleanVariable,
  parseTargetOrganizations,
  requireVerifiedEmailVariable,
  targetOrganizationsVariable,
} from '../variables';
import { reviewOrganizationInvites } from './invites';

interface AccountIssue {
  message: string;
  severity: FindingSeverity;
  remediation: string;
}

const SEVERITY_RANK: Record<FindingSeverity, number> = {
  info: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

function highestSeverity(issues: AccountIssue[]): FindingSeverity {
  return issues.reduce<FindingSeverity>(
    (worst, issue) =>
      SEVERITY_RANK[issue.severity] > SEVERITY_RANK[worst] ? issue.severity : worst,
    'low',
  );
}

/**
 * An account is valid when PostHog can prove the mailbox behind it is real and, when the
 * customer has told us their domains, that it belongs to the company.
 *
 * SSO short-circuits the verification rule: PostHog leaves `is_email_verified` null for
 * social sign-ups because the identity provider already proved ownership of the address,
 * so requiring PostHog's own verification there would flag a correctly-configured org.
 */
function evaluateAccount(options: {
  member: PostHogOrganizationMember;
  email: string;
  allowedDomains: Set<string>;
  requireVerifiedEmail: boolean;
  host: string;
}): AccountIssue[] {
  const { member, email, allowedDomains, requireVerifiedEmail, host } = options;
  const issues: AccountIssue[] = [];
  const privileged = isPrivilegedLevel(member.level);
  const domain = emailDomain(email);

  if (allowedDomains.size > 0 && !allowedDomains.has(domain)) {
    issues.push({
      message: `${domain || 'the address'} is not an approved email domain`,
      severity: 'high',
      remediation:
        `Remove the member under Settings > Organization > Members (${host}/settings/organization-members), ` +
        `or add ${domain || 'the domain'} to the approved domains for this integration if it is legitimate.`,
    });
  }

  const verified = member.user?.is_email_verified === true || member.has_social_auth === true;
  if (requireVerifiedEmail && !verified) {
    issues.push({
      message: 'PostHog has not verified this email address',
      severity: privileged ? 'high' : 'medium',
      remediation:
        'Ask the member to complete email verification from the link PostHog sends on sign-in, ' +
        'or remove the account if the mailbox is no longer in use.',
    });
  }

  return issues;
}

/**
 * Valid Email Accounts
 *
 * Reviews every PostHog organization member so the roster can be tied back to real,
 * verified company mailboxes, and reports the pending invitations that would become
 * accounts. Emits one row per person keyed by lowercased email (`resourceType: 'user'`),
 * the shared contract that lets person-scoped features join results to org members.
 */
export const validAccountsCheck: IntegrationCheck = {
  id: 'posthog_valid_accounts',
  name: 'Valid Email Accounts',
  description:
    'Verifies every PostHog account uses a valid, verified email address on an approved domain',
  taskMapping: TASK_TEMPLATES.employeeAccess,
  defaultSeverity: 'medium',
  variables: [
    targetOrganizationsVariable,
    allowedEmailDomainsVariable,
    requireVerifiedEmailVariable,
    includePendingInvitesVariable,
  ],

  run: async (ctx: CheckContext) => {
    const host = resolveHost(ctx);
    const allowedDomains = parseAllowedEmailDomains(ctx.variables);
    const requireVerifiedEmail = parseBooleanVariable(
      ctx.variables,
      requireVerifiedEmailVariable.id,
      true,
    );
    const reviewInvites = parseBooleanVariable(
      ctx.variables,
      includePendingInvitesVariable.id,
      true,
    );
    const checkedAt = new Date().toISOString();

    ctx.log(
      `Starting PostHog Valid Email Accounts check against ${host}` +
        (allowedDomains.size > 0 ? ` (approved domains: ${[...allowedDomains].join(', ')})` : ''),
    );

    let organizations: PostHogOrganizationSummary[];
    try {
      organizations = filterOrganizations(
        await listOrganizations(ctx, host),
        parseTargetOrganizations(ctx.variables),
      );
    } catch (error) {
      throw friendlyError(error, host);
    }

    ctx.log(`Checking ${organizations.length} PostHog organization(s)`);

    for (const organization of organizations) {
      let members: PostHogOrganizationMember[];
      let truncated: boolean;
      try {
        const result = await fetchAllResults<PostHogOrganizationMember>(ctx, {
          path: `/api/organizations/${organization.id}/members/`,
          host,
        });
        members = result.items;
        truncated = result.truncated;
      } catch (error) {
        throw friendlyError(error, host);
      }

      if (truncated) {
        ctx.warn(
          `PostHog member list for ${organization.name} truncated at ${members.length} records; ` +
            'some accounts were not reviewed.',
        );
      }

      ctx.log(`Reviewing ${members.length} member(s) in ${organization.name}`);

      let emitted = 0;
      let invalid = 0;

      for (const member of members) {
        const email = normalizeEmail(member.user?.email);
        const role = describeLevel(member.level);
        const name =
          [member.user?.first_name, member.user?.last_name].filter(Boolean).join(' ').trim() ||
          email ||
          member.id;

        const evidence = {
          email: email || null,
          name,
          role,
          roles: [role],
          level: member.level ?? null,
          isAdmin: isPrivilegedLevel(member.level),
          domain: emailDomain(email) || null,
          isEmailVerified: member.user?.is_email_verified ?? null,
          hasSocialAuth: Boolean(member.has_social_auth),
          organization: organization.name,
          organizationId: organization.id,
          externalId: member.user?.uuid ?? member.id,
          joinedAt: member.joined_at ?? null,
          lastLogin: member.last_login ?? null,
          truncated,
          checkedAt,
        };

        // No usable email means nothing downstream can key this account to a person, so
        // it is recorded under the membership id rather than polluting the 'user' rows.
        if (!email || !isValidEmailFormat(email)) {
          invalid++;
          ctx.fail({
            title: 'Account without a valid email address',
            description: `PostHog member ${member.id} in ${organization.name} has no usable email address.`,
            resourceType: 'organization_member',
            resourceId: member.id,
            severity: isPrivilegedLevel(member.level) ? 'high' : 'medium',
            remediation:
              `Review the member under Settings > Organization > Members ` +
              `(${host}/settings/organization-members) and remove the account if it does not belong to a person.`,
            evidence,
          });
          continue;
        }

        const issues = evaluateAccount({
          member,
          email,
          allowedDomains,
          requireVerifiedEmail,
          host,
        });
        emitted++;

        if (issues.length === 0) {
          ctx.pass({
            title: 'Valid Account',
            description: `${name} holds a valid PostHog account as ${role} in ${organization.name}.`,
            resourceType: 'user',
            resourceId: email,
            evidence,
          });
          continue;
        }

        invalid++;
        ctx.fail({
          title: 'Invalid Account',
          description: `${name} (${email}) is not a valid PostHog account: ${issues
            .map((issue) => issue.message)
            .join('; ')}.`,
          resourceType: 'user',
          resourceId: email,
          severity: highestSeverity(issues),
          remediation: issues.map((issue) => issue.remediation).join('\n'),
          evidence: {
            ...evidence,
            issues: issues.map((issue) => issue.message),
            approvedDomains: [...allowedDomains],
          },
        });
      }

      // A run that stores zero rows reads as "no evidence collected", so an organization
      // with no members still records the completed review.
      if (emitted === 0) {
        ctx.pass({
          title: 'Account Review',
          description: `No PostHog accounts with an email address were found in ${organization.name}.`,
          resourceType: 'organization',
          resourceId: organization.slug || organization.id,
          evidence: {
            organization: organization.name,
            organizationId: organization.id,
            inspectedMembers: members.length,
            truncated,
            checkedAt,
          },
        });
      }

      if (reviewInvites) {
        await reviewOrganizationInvites({
          ctx,
          host,
          organization,
          allowedDomains,
          checkedAt,
        });
      }

      ctx.log(
        `PostHog Valid Email Accounts complete for ${organization.name}: ` +
          `${members.length} member(s) reviewed, ${invalid} finding(s)`,
      );
    }
  },
};
