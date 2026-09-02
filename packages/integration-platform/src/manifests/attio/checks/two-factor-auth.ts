import { TASK_TEMPLATES } from '../../../task-mappings';
import type { CheckContext, IntegrationCheck } from '../../../types';
import {
  approvedIdentityDomainsVariable,
  classifyEmailDomain,
  parseApprovedDomains,
} from '../variables';
import {
  fetchWorkspace,
  fetchWorkspaceMembers,
  hasWorkspaceAccess,
  memberEmail,
  memberEvidence,
  memberName,
} from './shared';

/**
 * Two-Factor Coverage Check
 *
 * Attio's REST API exposes no MFA state: `GET /v2/workspace_members` returns
 * id, name, avatar, email, created_at and access_level, and there is no security-
 * settings or SSO endpoint anywhere in its published OpenAPI document. So a literal
 * "is 2FA on for this person" check is not implementable against Attio, and pretending
 * otherwise would put an unverifiable claim in front of an auditor.
 *
 * What IS verifiable is the perimeter: Attio 2FA is only enforceable through the
 * identity provider a member signs in with. A member on an IdP-governed domain
 * inherits that IdP's enforced 2FA — and the platform already reads per-person 2FA
 * from the org's configured 2FA source. A member on a personal mailbox, or on a domain
 * outside the configured allow-list, sits outside that perimeter entirely: nobody can
 * enforce 2FA on the account, and no evidence of it exists.
 *
 * Every row therefore records `mfaVerifiable` so the evidence states plainly which
 * question was answered. Maps to: 2FA task.
 */
export const twoFactorAuthCheck: IntegrationCheck = {
  id: 'attio_two_factor_auth',
  name: 'Two-Factor Coverage',
  description:
    'Verifies every Attio workspace member signs in with an identity-provider account, ' +
    'where 2FA can be enforced (Attio exposes no per-user MFA status via its API)',
  service: 'mfa-compliance',
  taskMapping: TASK_TEMPLATES.twoFactorAuth,
  defaultSeverity: 'high',
  variables: [approvedIdentityDomainsVariable],

  run: async (ctx: CheckContext) => {
    ctx.log('Starting Attio Two-Factor Coverage check');

    const approvedDomains = parseApprovedDomains(ctx.variables);
    const workspace = await fetchWorkspace(ctx);
    const members = (await fetchWorkspaceMembers(ctx)).filter(hasWorkspaceAccess);
    const checkedAt = new Date().toISOString();

    ctx.log(
      approvedDomains.length > 0
        ? `Checking ${members.length} members against approved domains: ${approvedDomains.join(', ')}`
        : `Checking ${members.length} members; no approved domains configured, ` +
            'so only personal (consumer) email accounts are flagged',
    );

    // No members with access is still a completed review — emit one org-level row so
    // the run never stores zero results, which would read as "no evidence collected".
    if (members.length === 0) {
      ctx.pass({
        title: 'No Attio accounts to cover',
        resourceType: 'organization',
        resourceId: workspace.slug,
        description:
          'No Attio workspace members hold access, so no account sits outside 2FA coverage',
        evidence: {
          totalUsers: 0,
          approvedDomains,
          workspace: workspace.name,
          checkedAt,
        },
      });
      ctx.log('Attio Two-Factor Coverage check complete: 0 members with access');
      return;
    }

    let covered = 0;
    const uncovered: string[] = [];

    for (const member of members) {
      const email = memberEmail(member);
      const name = memberName(member);
      const isAdmin = member.access_level === 'admin';
      const { domain, verdict, mode } = classifyEmailDomain(email, approvedDomains);

      const evidence = {
        ...memberEvidence(member, workspace),
        emailDomain: domain,
        domainVerdict: verdict,
        matchMode: mode,
        approvedDomains,
        // Attio never reports MFA state, so no row here may claim to have read it.
        // This check attests coverage — whether an IdP is in a position to enforce
        // 2FA on the account — not enrolment.
        mfaVerifiable: false,
        checkedAt,
      };

      // resourceId falls back to the Attio member id so a member with no email still
      // produces a stable, non-colliding row rather than being silently dropped.
      const resourceId = email || member.id.workspace_member_id;

      if (verdict === 'approved') {
        covered++;
        ctx.pass({
          title: '2FA Coverage Confirmed',
          resourceType: 'user',
          resourceId,
          description:
            `${name} signs in to Attio with ${domain}, a domain governed by your identity ` +
            'provider, where 2FA is enforced',
          evidence,
        });
        continue;
      }

      uncovered.push(email || member.id.workspace_member_id);

      const reason =
        verdict === 'consumer'
          ? `${name} signs in to Attio with a personal email account (${domain}), which no ` +
            'identity provider governs, so 2FA cannot be enforced or evidenced on it'
          : domain
            ? `${name} signs in to Attio with ${domain}, which is not one of your identity ` +
              'provider domains, so 2FA cannot be enforced or evidenced on this account'
            : `${name} has no email address on record in Attio, so this account cannot be ` +
              'attributed to an identity provider';

      ctx.fail({
        title: isAdmin ? '2FA Not Enforceable (Admin)' : '2FA Not Enforceable',
        resourceType: 'user',
        resourceId,
        // An admin outside the identity perimeter can change the whole workspace,
        // so the same gap is a materially larger risk on an admin account.
        severity: isAdmin ? 'high' : 'medium',
        description: reason,
        remediation:
          `Invite ${name} to Attio using an address on a domain your identity provider ` +
          'manages and suspend the current account, or — if this domain is IdP-managed — ' +
          'add it to the "Identity provider domains" setting on this integration.',
        evidence,
      });
    }

    ctx.log(
      `Attio Two-Factor Coverage check complete: ${covered}/${members.length} accounts covered, ` +
        `${uncovered.length} outside the identity perimeter`,
    );
  },
};
