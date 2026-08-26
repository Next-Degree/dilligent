import type { CheckContext } from '../../types';
import { toHttpReadFailure } from '../http-read-failure';
import type { VercelTeamDetails } from './types';

interface VercelOAuthMetadata {
  team?: { id?: string; name?: string };
  user?: { id?: string; username?: string };
}

export interface VercelTeamContext {
  teamId?: string;
  teamName?: string;
}

/**
 * Team context comes from the OAuth token response: installing the integration
 * for a team stores the team there, installing for a personal account does not.
 */
export function getVercelTeamContext(ctx: CheckContext): VercelTeamContext {
  const oauth = (ctx.metadata?.oauth ?? {}) as VercelOAuthMetadata;
  return { teamId: oauth.team?.id, teamName: oauth.team?.name };
}

/** Add `teamId` to query params when the connection is team-scoped. */
export function withTeamId(params: URLSearchParams, teamId?: string): URLSearchParams {
  if (teamId) {
    params.set('teamId', teamId);
  }
  return params;
}

export async function fetchVercelTeamDetails(
  ctx: CheckContext,
  teamId: string,
): Promise<VercelTeamDetails> {
  return ctx.fetch<VercelTeamDetails>(`/v2/teams/${encodeURIComponent(teamId)}`);
}

/**
 * Resolve the team the identity checks operate on, emitting the finding itself
 * when it cannot: a personal-account connection has no member roster, and a
 * failed team read must be reported rather than silently skipped.
 *
 * Returns null when the caller should stop — the finding is already recorded.
 */
export async function requireVercelTeam(
  ctx: CheckContext,
): Promise<{ teamId: string; teamName?: string; team: VercelTeamDetails } | null> {
  const { teamId, teamName } = getVercelTeamContext(ctx);

  if (!teamId) {
    ctx.fail({
      title: 'Vercel connection is not scoped to a team',
      resourceType: 'vercel',
      resourceId: 'team',
      severity: 'medium',
      description:
        'This connection authorized a personal Vercel account, which has no team members. Account, offboarding and 2FA evidence can only be collected for a Vercel team.',
      remediation:
        'Reconnect the Vercel integration and choose your team (not your personal account) on the Vercel install screen.',
      evidence: { checkedAt: new Date().toISOString() },
    });
    return null;
  }

  try {
    const team = await fetchVercelTeamDetails(ctx, teamId);
    return { teamId, teamName: teamName ?? team.name, team };
  } catch (error) {
    const failure = toHttpReadFailure(error);
    ctx.fail({
      title: 'Failed to read Vercel team settings',
      resourceType: 'vercel',
      resourceId: teamId,
      severity: 'medium',
      description: `Could not read the team's settings: ${failure.error}`,
      remediation: failure.denied
        ? 'Reconnect the Vercel integration with an account that has Owner access to this team.'
        : 'Re-run the check; if it keeps failing, contact support.',
      evidence: { teamId, error: failure.error, denied: failure.denied },
    });
    return null;
  }
}
