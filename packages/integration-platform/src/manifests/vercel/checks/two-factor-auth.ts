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
 * Vercel supports per-account 2FA (TOTP or passkey) and lets a team enforce it
 * for every member under Team Settings > Security & Privacy > Two-Factor
 * Authentication Enforcement. Owners can see each member's 2FA state on the
 * team members page.
 *
 * None of that is on the public REST API: neither `GET /v2/teams/{id}` nor
 * `GET /v3/teams/{id}/members` returns an enforcement flag or a per-member 2FA
 * field, and the members endpoint has no 2FA filter. So this check records the
 * accounts in scope and reports their 2FA state as UNVERIFIED — never as
 * "disabled", which would assert something the API did not say, and never as a
 * pass, which would present missing evidence as compliance.
 *
 * If Vercel later exposes the enforcement flag or a per-member field, this
 * check becomes a real pass/fail on that field with no change to its shape.
 *
 * Maps to: 2FA task
 */
export const twoFactorAuthCheck: IntegrationCheck = {
  id: 'two-factor-auth',
  name: 'Account 2FA',
  description:
    'Record Vercel team accounts and their 2FA state (Vercel enforces 2FA in the dashboard but does not expose it on the REST API)',
  service: 'access',
  taskMapping: TASK_TEMPLATES.twoFactorAuth,
  defaultSeverity: 'high',

  run: async (ctx: CheckContext) => {
    ctx.log('Starting Vercel 2FA check');

    const resolved = await requireVercelTeam(ctx);
    if (!resolved) return;
    const { teamId, teamName } = resolved;

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

    const checkedAt = new Date().toISOString();
    const remediation =
      "Turn on Team Settings > Security & Privacy > Two-Factor Authentication Enforcement so every member must configure 2FA before accessing team resources, then attach a screenshot of that setting (and of the members list, which shows each member's 2FA state) as evidence. Vercel does not report either through its API, so this check cannot confirm them for you.";

    ctx.fail({
      title: 'Vercel 2FA enforcement cannot be verified automatically',
      resourceType: 'vercel',
      resourceId: 'two-factor-auth',
      severity: 'high',
      description: `Vercel supports 2FA and team-wide 2FA enforcement, but exposes neither the enforcement setting nor per-member 2FA status on its REST API, so the ${members.length} account(s) on this team cannot be confirmed as covered.`,
      remediation,
      evidence: {
        teamId,
        teamName: teamName ?? null,
        memberCount: members.length,
        verificationBasis: 'not-verifiable',
        providerExposesTeam2faEnforcement: false,
        providerExposesPerMember2fa: false,
        enforcementSetting:
          'Team Settings > Security & Privacy > Two-Factor Authentication Enforcement',
        checkedAt,
      },
    });

    // One row per person, keyed by lowercased email, so the People view can
    // show Vercel alongside other 2FA sources — as unverified rather than as a
    // clean pass or a false "2FA disabled".
    for (const member of members) {
      const email = normalizeEmail(member.email);
      const displayName = describeMember(member);

      ctx.fail({
        title: `2FA unverified: ${displayName}`,
        resourceType: 'user',
        resourceId: email ?? member.uid,
        severity: isPrivilegedRole(member.role) ? 'high' : 'medium',
        description: `Two-factor authentication for ${displayName} (${member.role}) cannot be confirmed: Vercel does not report per-member 2FA status through its API. Check this member on the Vercel team members page.`,
        remediation,
        evidence: {
          email,
          name: member.name ?? null,
          username: member.username ?? null,
          role: member.role,
          uid: member.uid,
          verificationBasis: 'not-verifiable',
          providerExposesPerMember2fa: false,
          checkedAt,
        },
      });
    }

    ctx.log(`Vercel 2FA check complete: ${members.length} account(s) recorded as unverified`);
  },
};
