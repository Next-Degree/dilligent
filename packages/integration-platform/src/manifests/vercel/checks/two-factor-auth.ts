import { TASK_TEMPLATES } from '../../../task-mappings';
import type { CheckContext, IntegrationCheck } from '../../../types';
import { toHttpReadFailure } from '../../http-read-failure';
import {
  describeMember,
  fetchVercelTeamRoster,
  isPrivilegedRole,
  normalizeEmail,
} from '../members';
import { requireVercelTeam } from '../team';
import type { VercelTeamMember } from '../types';

/**
 * Vercel Account 2FA
 *
 * Vercel's REST API exposes no per-member 2FA state — neither the team members
 * endpoint nor the user endpoint returns it. The verifiable control is SAML SSO
 * enforcement: with it on, every member authenticates through the identity
 * provider and inherits the MFA it enforces. Without it, this check reports 2FA
 * as UNVERIFIED (not as "disabled") so nobody reads absent evidence as proof of
 * a violation, or of compliance.
 *
 * Maps to: 2FA task
 */
export const twoFactorAuthCheck: IntegrationCheck = {
  id: 'two-factor-auth',
  name: 'Account 2FA',
  description:
    'Verify Vercel team sign-in is covered by enforced SSO/MFA (Vercel exposes no per-member 2FA state)',
  service: 'access',
  taskMapping: TASK_TEMPLATES.twoFactorAuth,
  defaultSeverity: 'high',

  run: async (ctx: CheckContext) => {
    ctx.log('Starting Vercel 2FA check');

    const resolved = await requireVercelTeam(ctx);
    if (!resolved) return;
    const { teamId, teamName, team } = resolved;

    let members: VercelTeamMember[];
    try {
      ({ members } = await fetchVercelTeamRoster(ctx, teamId));
    } catch (error) {
      const failure = toHttpReadFailure(error);
      ctx.fail({
        title: 'Failed to read Vercel team members',
        resourceType: 'vercel',
        resourceId: teamId,
        severity: 'high',
        description: `Could not list team members: ${failure.error}`,
        remediation: failure.denied
          ? 'Reconnect the Vercel integration with an account that has Owner access to this team.'
          : 'Re-run the check; if it keeps failing, contact support.',
        evidence: { teamId, error: failure.error, denied: failure.denied },
      });
      return;
    }

    const samlEnforced = team.saml?.enforced === true;
    const ssoConnected = team.saml?.connection?.state === 'active';
    const covered = samlEnforced && ssoConnected;
    const checkedAt = new Date().toISOString();
    const remediation =
      'Enable SAML SSO and turn on "Enforce SAML SSO" in Vercel Team Settings > Security & Privacy so every sign-in inherits your identity provider\'s MFA. On plans without SAML, require each member to enable two-factor authentication under Vercel Account Settings > Authentication and keep that screenshot as evidence.';

    const controlEvidence = {
      teamId,
      teamName: teamName ?? null,
      samlEnforced,
      ssoConnected,
      samlConnectionState: team.saml?.connection?.state ?? null,
      memberCount: members.length,
      // Recorded so an auditor reading this evidence knows the basis, and why
      // there is no per-member 2FA flag here.
      verificationBasis: covered ? 'saml-sso-enforced' : 'not-verifiable',
      providerExposesPerMember2fa: false,
      checkedAt,
    };

    if (covered) {
      ctx.pass({
        title: 'Vercel sign-in enforced through SSO',
        resourceType: 'vercel',
        resourceId: 'two-factor-auth',
        description:
          'SAML SSO is connected and enforced for this team, so every member authenticates through the identity provider and inherits the MFA it requires.',
        evidence: controlEvidence,
      });
    } else {
      ctx.fail({
        title: 'Vercel 2FA cannot be verified',
        resourceType: 'vercel',
        resourceId: 'two-factor-auth',
        severity: 'high',
        description: `SAML SSO is ${
          ssoConnected ? 'connected but not enforced' : 'not connected'
        } for this team, and Vercel's API does not expose per-member two-factor status. Multi-factor coverage for these accounts is unverified.`,
        remediation,
        evidence: controlEvidence,
      });
    }

    for (const member of members) {
      const email = normalizeEmail(member.email);
      const displayName = describeMember(member);
      const evidence = {
        email,
        name: member.name ?? null,
        username: member.username ?? null,
        role: member.role,
        uid: member.uid,
        samlEnforced,
        ssoConnected,
        linkedToSso: Boolean(member.joinedFrom?.ssoUserId),
        verificationBasis: covered ? 'saml-sso-enforced' : 'not-verifiable',
        providerExposesPerMember2fa: false,
        checkedAt,
      };

      if (covered) {
        ctx.pass({
          title: '2FA enforced through SSO',
          resourceType: 'user',
          resourceId: email ?? member.uid,
          description: `${displayName} signs in through the enforced SAML connection, which applies the identity provider's MFA.`,
          evidence,
        });
        continue;
      }

      ctx.fail({
        title: `2FA unverified: ${displayName}`,
        resourceType: 'user',
        resourceId: email ?? member.uid,
        severity: isPrivilegedRole(member.role) ? 'high' : 'medium',
        description: `Two-factor authentication for ${displayName} (${member.role}) cannot be confirmed: SSO is not enforced for this team and Vercel does not report per-member 2FA status.`,
        remediation,
        evidence,
      });
    }

    ctx.log(
      `Vercel 2FA check complete: ${members.length} accounts, basis "${controlEvidence.verificationBasis}"`,
    );
  },
};
