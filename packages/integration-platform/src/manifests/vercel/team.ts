import type { CheckContext } from '../../types';
import { toHttpReadFailure } from '../http-read-failure';
import type { VercelProject, VercelProjectsResponse, VercelTeamDetails } from './types';

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
 * Resolution is via the projects the token can already read, NOT `GET /v2/teams`.
 * Listing teams is a user-level operation that an integration token is not
 * granted: a team-scoped install answers it `403 "You don't have permission to
 * list the team."` even while holding Team read for its own team. Reading
 * projects is in every install's Read scope, and a team-owned resource's owner
 * id IS the team id (Vercel documents the same field on webhooks as "the unique
 * ID of the team the webhook belongs to").
 *
 * Only auto-resolves an unambiguous answer. If the visible projects name more
 * than one owning account the connection is not scoped to a single team, and
 * picking one would attribute the whole check run to a team nobody chose.
 */
export async function resolveVercelTeamContext(ctx: CheckContext): Promise<VercelTeamContext> {
  const stored = getVercelTeamContext(ctx);
  if (stored.teamId) return stored;

  let projects: VercelProject[];
  try {
    const response = await ctx.fetch<VercelProjectsResponse>('/v9/projects?limit=100');
    projects = response?.projects ?? [];
  } catch (error) {
    ctx.warn(`Could not read Vercel projects to resolve the connection scope: ${String(error)}`);
    return {};
  }

  // Personal-account projects carry a user id here, so requiring the team
  // prefix is what distinguishes a personal install from a team one.
  const teamIds = [
    ...new Set(
      projects
        .map((project) => project.accountId)
        .filter((accountId): accountId is string => typeof accountId === 'string')
        .filter((accountId) => accountId.startsWith('team_')),
    ),
  ];

  if (teamIds.length !== 1) {
    ctx.log(
      teamIds.length === 0
        ? 'No team-owned Vercel projects are visible; treating this as a personal account.'
        : `Visible Vercel projects span ${teamIds.length} teams; cannot infer which one this connection was installed for.`,
    );
    return {};
  }

  const [teamId] = teamIds;
  // Best-effort: reading one specific team IS within an install's Team read
  // scope (unlike listing), but the id alone is enough to scope requests, so a
  // failure here must not discard it.
  let teamName: string | undefined;
  try {
    const team = await fetchVercelTeamDetails(ctx, teamId);
    teamName = team?.name;
  } catch (error) {
    ctx.log(`Resolved team ${teamId} but could not read its name: ${String(error)}`);
  }

  ctx.log(
    `Resolved Vercel team ${teamName ?? teamId} from project ownership (not stored on the connection)`,
  );
  return { teamId, teamName };
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
