import type { CheckContext } from '../../types';
import { toHttpReadFailure } from '../http-read-failure';
import type { VercelTeamDetails } from './types';

export interface VercelTeamContext {
  teamId?: string;
  teamName?: string;
}

/**
 * The team this connection is scoped to.
 *
 * Supplied directly as a credential when the integration is connected, so there
 * is nothing to infer and nothing to fail: Vercel resolves team resources only
 * for requests carrying the team id, and asking for it up front is the only way
 * to be sure we have the right one.
 *
 * This replaced an OAuth install, where the team had to be recovered from the
 * token exchange, the install redirect, or the installation record — three
 * mechanisms, each of which failed differently in production.
 */
export function getVercelTeamContext(ctx: CheckContext): VercelTeamContext {
  const teamId = ctx.credentials?.team_id;
  return typeof teamId === 'string' && teamId ? { teamId } : {};
}

/**
 * The configured team, or null after reporting that there isn't one.
 *
 * Every check needs the team: Vercel resolves team resources only for requests
 * carrying its id, and answers an unscoped request in the token owner's own
 * scope — which reads as "no projects" rather than as an error. Saying so once,
 * up front, beats every check inventing its own way to look empty.
 */
export function requireVercelTeamId(ctx: CheckContext): string | null {
  const { teamId } = getVercelTeamContext(ctx);
  if (teamId) return teamId;

  ctx.fail({
    title: 'No Vercel team is configured',
    resourceType: 'vercel',
    resourceId: 'team',
    severity: 'medium',
    description:
      "This connection has no Vercel Team ID, so there is no team whose resources can be reviewed. Vercel answers unscoped requests in the token owner's personal scope, which would look like an empty account rather than a misconfiguration.",
    remediation:
      'Open the Vercel integration settings and enter your Team ID, found in Vercel under Team Settings > General > Team ID.',
    evidence: { checkedAt: new Date().toISOString() },
  });
  return null;
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
  const { teamName } = getVercelTeamContext(ctx);
  const teamId = requireVercelTeamId(ctx);
  if (!teamId) return null;

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
        ? 'Check that the Vercel access token is still valid and was created by an account with Owner access to this team.'
        : 'Re-run the check; if it keeps failing, contact support.',
      evidence: { teamId, error: failure.error, denied: failure.denied },
    });
    return null;
  }
}
