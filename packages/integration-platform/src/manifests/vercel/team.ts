import type { CheckContext } from '../../types';
import { toHttpReadFailure } from '../http-read-failure';
import type { VercelTeamDetails } from './types';

export interface VercelTeamContext {
  teamId?: string;
  teamName?: string;
}

/**
 * The team the connection was installed for.
 *
 * Vercel's token exchange returns a flat `team_id` (null for a personal-account
 * install), which the host persists alongside the token — so it arrives on
 * `ctx.credentials`, the same route Zoho's `api_domain` takes. It is NOT on
 * `ctx.metadata`: the check runner never passes metadata to `runAllChecks`, so
 * anything read from there is always undefined.
 */
export function getVercelTeamContext(ctx: CheckContext): VercelTeamContext {
  const teamId = ctx.credentials?.team_id;
  return typeof teamId === 'string' && teamId ? { teamId } : {};
}

/**
 * The team, resolving it from the API when the connection predates `team_id`
 * being persisted.
 *
 * Without this, every connection made before that fix stays broken until it is
 * disconnected and reconnected — and the symptom ('not scoped to a team') tells
 * the user to do exactly that, which would not have helped.
 *
 * Only auto-resolves an unambiguous answer. A team-scoped token lists the one
 * team it was installed for; a personal token can list every team the user
 * belongs to, and picking one of those would attribute the whole check run to a
 * team nobody chose.
 */
export async function resolveVercelTeamContext(ctx: CheckContext): Promise<VercelTeamContext> {
  const stored = getVercelTeamContext(ctx);
  if (stored.teamId) return stored;

  try {
    const response = await ctx.fetch<{ teams?: Array<{ id?: string; name?: string }> }>(
      '/v2/teams?limit=2',
    );
    const teams = (response?.teams ?? []).filter((team) => typeof team.id === 'string');
    if (teams.length !== 1) {
      ctx.log(
        teams.length === 0
          ? 'Connection lists no Vercel teams; treating it as a personal account.'
          : 'Connection lists more than one Vercel team; cannot infer which it was installed for.',
      );
      return {};
    }

    const [team] = teams;
    ctx.log(
      `Resolved Vercel team ${team.name ?? team.id} from the API (not stored on the connection)`,
    );
    return { teamId: team.id, teamName: team.name };
  } catch (error) {
    ctx.warn(`Could not list Vercel teams to resolve the connection scope: ${String(error)}`);
    return {};
  }
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
  const { teamId, teamName } = await resolveVercelTeamContext(ctx);

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
