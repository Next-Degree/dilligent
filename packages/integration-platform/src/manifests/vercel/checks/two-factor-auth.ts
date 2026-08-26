import { TASK_TEMPLATES } from '../../../task-mappings';
import type { CheckContext, IntegrationCheck } from '../../../types';
import { parseTeam2faEnforced, team2faEnforcedVariable } from '../access-variables';
import { fetchVercelTeamRoster } from '../members';
import { requireVercelTeam } from '../team';

/**
 * Vercel Team 2FA Enforcement
 *
 * Scope is the team, not the person. Vercel lets a team require 2FA of every
 * member under Team Settings > Security & Privacy > Two-Factor Authentication
 * Enforcement; with it on, no member reaches team resources without 2FA, so the
 * team setting is the whole control and per-member state adds nothing.
 *
 * That is just as well, because the REST API reports neither. The documented
 * `GET /v2/teams/{id}` response carries `saml.enforced`, `requireVerifiedCommits`
 * and ~100 other fields but no 2FA flag, `GET /v3/teams/{id}/members` has no
 * per-member 2FA field, and there is no 2FA endpoint. Both are dashboard-only.
 *
 * So the check reads an admin's confirmation of the team setting and records it
 * as a self-attestation — never as an observed fact. Evidence always stamps
 * `verificationBasis`, so an auditor can see the difference at a glance. If
 * Vercel ever exposes the flag, this becomes a real read on that field and the
 * variable can go.
 *
 * Maps to: 2FA task
 */
export const twoFactorAuthCheck: IntegrationCheck = {
  id: 'two-factor-auth',
  name: 'Team 2FA Enforcement',
  description:
    "Confirms the Vercel team requires two-factor authentication of every member. Vercel does not expose this setting on its REST API, so it is recorded from an administrator's confirmation rather than observed.",
  service: 'access',
  taskMapping: TASK_TEMPLATES.twoFactorAuth,
  defaultSeverity: 'high',

  variables: [team2faEnforcedVariable],

  run: async (ctx: CheckContext) => {
    ctx.log('Starting Vercel team 2FA enforcement check');

    const resolved = await requireVercelTeam(ctx);
    if (!resolved) return;
    const { teamId, teamName } = resolved;

    // Best-effort: the member count tells an auditor how many accounts the
    // setting covers. Never fatal — the team setting is the control, and
    // failing the whole check over a roster read would report the wrong thing.
    let memberCount: number | null = null;
    try {
      const { members } = await fetchVercelTeamRoster(ctx, teamId);
      memberCount = members.length;
    } catch (error) {
      ctx.warn(`Could not count team members for evidence: ${String(error)}`);
    }

    const enforced = parseTeam2faEnforced(ctx.variables);
    const enforcementSetting =
      'Team Settings > Security & Privacy > Two-Factor Authentication Enforcement';
    const evidence = {
      teamId,
      teamName: teamName ?? null,
      memberCount,
      enforcementSetting,
      // Stamped on both outcomes: the API cannot see this setting, so no result
      // here is an observation, and evidence must never imply otherwise.
      verificationBasis: 'admin-attestation' as const,
      providerExposesTeam2faEnforcement: false,
      providerExposesPerMember2fa: false,
      checkedAt: new Date().toISOString(),
    };

    if (enforced) {
      ctx.pass({
        title: 'Team requires two-factor authentication',
        resourceType: 'vercel',
        resourceId: 'two-factor-auth',
        description: `An administrator has confirmed that ${
          teamName ?? teamId
        } enforces two-factor authentication for every member${
          memberCount === null ? '' : `, covering ${memberCount} account(s)`
        }. Vercel does not report this setting through its API, so it is recorded as an attestation.`,
        evidence: { ...evidence, enforced: true },
      });
      ctx.log('Vercel team 2FA enforcement attested');
      return;
    }

    ctx.fail({
      title: 'Team 2FA enforcement is not confirmed',
      resourceType: 'vercel',
      resourceId: 'two-factor-auth',
      severity: 'high',
      description: `Two-factor authentication enforcement has not been confirmed for ${
        teamName ?? teamId
      }${
        memberCount === null ? '' : `, so its ${memberCount} account(s) may sign in without 2FA`
      }. Vercel exposes neither the team enforcement setting nor per-member 2FA status on its REST API, so this cannot be verified automatically.`,
      remediation: `Turn on ${enforcementSetting} so every member must configure 2FA, then tick "${team2faEnforcedVariable.label}" in this check's settings to record it. Attach a screenshot of the setting as supporting evidence.`,
      evidence: { ...evidence, enforced: false },
    });

    ctx.log('Vercel team 2FA enforcement not attested');
  },
};
