import type { CheckContext } from '../../types';
import { toHttpReadFailure } from '../http-read-failure';
import type { VercelTeamDetails } from './types';

export interface VercelTeamContext {
  teamId?: string;
  teamName?: string;
}

interface VercelTeamsResponse {
  teams?: Array<{ id?: string; name?: string; slug?: string }>;
}

/** Teams the token can see. Two is enough to know the answer is ambiguous. */
const TEAM_LOOKUP_LIMIT = 10;

/**
 * The team this token belongs to, or null after reporting why there isn't one.
 *
 * Derived from the token rather than configured, so connecting needs nothing but
 * the token itself. `GET /v2/teams` lists the teams the authenticated user is a
 * member of — a user-level operation, which is why this works here and did not
 * under the previous OAuth install, where an integration token is refused it
 * with `403 "You don't have permission to list the team."`
 *
 * Only an unambiguous answer is accepted. A token scoped to one team sees that
 * team; a token scoped to a personal account sees every team its owner belongs
 * to, and choosing among those would silently report on a team nobody picked —
 * the worst outcome available, since it looks like a clean result. So the
 * ambiguous case is reported with the names, and the fix is to scope the token.
 *
 * Every check needs this: Vercel answers an unscoped request in the token
 * owner's own scope, which reads as an empty account rather than an error.
 */
export async function resolveVercelTeam(ctx: CheckContext): Promise<VercelTeamContext | null> {
  let teams: Array<{ id?: string; name?: string; slug?: string }>;
  try {
    const response = await ctx.fetch<VercelTeamsResponse>(`/v2/teams?limit=${TEAM_LOOKUP_LIMIT}`);
    teams = (response?.teams ?? []).filter((team) => typeof team.id === 'string');
  } catch (error) {
    const failure = toHttpReadFailure(error);
    ctx.fail({
      title: 'Could not read the Vercel team for this token',
      resourceType: 'vercel',
      resourceId: 'team',
      severity: 'high',
      description: `Listing the teams this token belongs to failed, so there is no team whose resources can be reviewed: ${failure.error}`,
      remediation: failure.denied
        ? 'The Vercel access token was rejected. Create a new token under Account Settings > Tokens, scoped to the team you want reviewed, and update it in the integration settings.'
        : 'Re-run the check; if it keeps failing, contact support.',
      evidence: {
        error: failure.error,
        denied: failure.denied,
        checkedAt: new Date().toISOString(),
      },
    });
    return null;
  }

  if (teams.length === 1) {
    const [team] = teams;
    return { teamId: team.id, teamName: team.name };
  }

  if (teams.length === 0) {
    ctx.fail({
      title: 'Vercel token is not scoped to a team',
      resourceType: 'vercel',
      resourceId: 'team',
      severity: 'medium',
      description:
        'This token belongs to no Vercel team, so there are no team members or team projects to review. Account and offboarding evidence can only be collected for a team.',
      remediation:
        'Create a token under Vercel > Account Settings > Tokens with its scope set to the team you want reviewed, then update it in the integration settings.',
      evidence: { teamCount: 0, checkedAt: new Date().toISOString() },
    });
    return null;
  }

  const names = teams.map((team) => team.name ?? team.slug ?? team.id).join(', ');
  ctx.fail({
    title: 'Vercel token spans more than one team',
    resourceType: 'vercel',
    resourceId: 'team',
    severity: 'medium',
    description: `This token can see ${teams.length} teams (${names}), so which one to review is ambiguous. Reporting on a team nobody chose would look like a clean result while describing the wrong organization, so no team is assumed.`,
    remediation:
      'Create a token under Vercel > Account Settings > Tokens with its scope set to a single team — the one you want reviewed — then update it in the integration settings.',
    evidence: {
      teamCount: teams.length,
      teams: teams.map((team) => ({ id: team.id, name: team.name ?? null })),
      checkedAt: new Date().toISOString(),
    },
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
  const resolved = await resolveVercelTeam(ctx);
  if (!resolved?.teamId) return null;
  const { teamId, teamName } = resolved;

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
