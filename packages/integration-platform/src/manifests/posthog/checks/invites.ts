/**
 * Pending-invitation review, used by the Valid Email Accounts check.
 *
 * An outstanding invitation is not an account yet, but it is a standing grant of future
 * access — an expired one left in place, or one addressed to a personal mailbox, is the
 * kind of thing an access review is meant to surface. Invitations are therefore recorded
 * under their own `invite` resource type so consumers that join check results to people
 * by email (the People roster, the 2FA column) never see them as employees.
 */

import type { CheckContext } from '../../../types';
import {
  describeLevel,
  emailDomain,
  errorMessage,
  fetchAllResults,
  isValidEmailFormat,
  normalizeEmail,
  POSTHOG_HOST,
} from '../client';
import type { PostHogInvite, PostHogOrganizationSummary } from '../types';

export async function reviewOrganizationInvites(options: {
  ctx: CheckContext;
  organization: PostHogOrganizationSummary;
  allowedDomains: Set<string>;
  checkedAt: string;
}): Promise<number> {
  const { ctx, organization, allowedDomains, checkedAt } = options;

  let invites: PostHogInvite[];
  try {
    const result = await fetchAllResults<PostHogInvite>(ctx, {
      path: `/api/organizations/${organization.id}/invites/`,
    });
    invites = result.items;
  } catch (error) {
    // A key without invite access is not a reason to fail the roster review that
    // already succeeded — record why the invitations were skipped and move on.
    ctx.warn(
      `Could not read PostHog invitations for ${organization.name} (${errorMessage(error)}); ` +
        'pending invitations were not reviewed',
    );
    return 0;
  }

  ctx.log(`Reviewing ${invites.length} pending PostHog invitations in ${organization.name}`);

  for (const invite of invites) {
    const email = normalizeEmail(invite.target_email);
    const resourceId = email || `invite:${invite.id}`;
    const domain = emailDomain(email);
    const role = describeLevel(invite.level);

    const evidence = {
      email: email || null,
      organization: organization.name,
      organizationId: organization.id,
      role,
      level: invite.level ?? null,
      isExpired: Boolean(invite.is_expired),
      invitedBy: normalizeEmail(invite.created_by?.email) || null,
      createdAt: invite.created_at ?? null,
      externalId: invite.id,
      checkedAt,
    };

    if (!email || !isValidEmailFormat(email)) {
      ctx.fail({
        title: 'Invalid invitation address',
        description: `A pending PostHog invitation in ${organization.name} has no usable email address.`,
        resourceType: 'invite',
        resourceId,
        severity: 'medium',
        remediation:
          `Revoke the invitation in PostHog under Settings > Organization > Members ` +
          `(${POSTHOG_HOST}/settings/organization-members) and re-send it to a valid address.`,
        evidence,
      });
      continue;
    }

    if (allowedDomains.size > 0 && !allowedDomains.has(domain)) {
      ctx.fail({
        title: 'Invitation to an unapproved domain',
        description: `${email} is invited to PostHog as ${role} but ${domain} is not an approved email domain.`,
        resourceType: 'invite',
        resourceId,
        severity: 'high',
        remediation:
          `Revoke the invitation under Settings > Organization > Members ` +
          `(${POSTHOG_HOST}/settings/organization-members), or add ${domain} to the approved domains for this integration.`,
        evidence: { ...evidence, domain, approvedDomains: [...allowedDomains] },
      });
      continue;
    }

    if (invite.is_expired) {
      ctx.fail({
        title: 'Expired invitation still outstanding',
        description: `The PostHog invitation for ${email} in ${organization.name} has expired but has not been revoked.`,
        resourceType: 'invite',
        resourceId,
        severity: 'low',
        remediation:
          `Revoke the expired invitation under Settings > Organization > Members ` +
          `(${POSTHOG_HOST}/settings/organization-members), and re-invite the person if they still need access.`,
        evidence,
      });
      continue;
    }

    ctx.pass({
      title: 'Pending invitation',
      description: `${email} has a pending invitation to join ${organization.name} as ${role}.`,
      resourceType: 'invite',
      resourceId,
      evidence: { ...evidence, domain },
    });
  }

  return invites.length;
}
