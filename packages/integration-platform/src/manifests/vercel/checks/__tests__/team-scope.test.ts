import { describe, expect, it } from 'bun:test';
import type { CheckContext } from '../../../../types';
import { getVercelTeamContext, resolveVercelTeamContext } from '../../team';

/**
 * Regression cover for the bug that made every Vercel connection report itself
 * as a personal account: the team was read from `ctx.metadata.oauth.team.id`,
 * a shape nothing ever wrote. The check runner does not pass metadata to
 * `runAllChecks` at all, and Vercel returns a flat `team_id` rather than a
 * nested object, so the value was undefined on every run regardless of how the
 * integration was installed.
 *
 * These build the context by hand rather than through the harness, so a harness
 * that drifts back to a metadata-shaped stub cannot make them pass.
 */
function makeCtx(options: {
  credentials?: Record<string, string | string[]>;
  projects?: Array<{ id: string; name: string; accountId: string }>;
  projectsError?: Error;
  teamDetails?: { id: string; name?: string };
  teamDetailsError?: Error;
  metadata?: Record<string, unknown>;
}): { ctx: CheckContext; requests: string[] } {
  const requests: string[] = [];
  const ctx = {
    accessToken: 'tok',
    credentials: options.credentials ?? {},
    metadata: options.metadata,
    connectionId: 'conn_1',
    organizationId: 'org_1',
    log: () => {},
    warn: () => {},
    error: () => {},
    fetch: (async (path: string) => {
      requests.push(path);
      if (path.startsWith('/v9/projects')) {
        if (options.projectsError) throw options.projectsError;
        return { projects: options.projects ?? [] };
      }
      if (path.startsWith('/v2/teams/')) {
        if (options.teamDetailsError) throw options.teamDetailsError;
        return options.teamDetails ?? { id: 'team_abc' };
      }
      throw new Error(`Unexpected fetch: ${path}`);
    }) as CheckContext['fetch'],
  } as unknown as CheckContext;
  return { ctx, requests };
}

const project = (accountId: string, name = 'proj') => ({
  id: `prj_${name}`,
  name,
  accountId,
});

describe('getVercelTeamContext', () => {
  it('reads the team from the credentials the host persists', () => {
    const { ctx } = makeCtx({ credentials: { team_id: 'team_abc' } });

    expect(getVercelTeamContext(ctx)).toEqual({ teamId: 'team_abc' });
  });

  it('ignores a team on ctx.metadata, which the runtime never populates', () => {
    const { ctx } = makeCtx({
      metadata: { oauth: { team: { id: 'team_from_metadata', name: 'Ghost' } } },
    });

    expect(getVercelTeamContext(ctx)).toEqual({});
  });

  it('treats an empty team id as no team', () => {
    const { ctx } = makeCtx({ credentials: { team_id: '' } });

    expect(getVercelTeamContext(ctx)).toEqual({});
  });
});

describe('resolveVercelTeamContext', () => {
  it('uses the stored team without calling the API', async () => {
    const { ctx, requests } = makeCtx({ credentials: { team_id: 'team_abc' } });

    expect(await resolveVercelTeamContext(ctx)).toEqual({ teamId: 'team_abc' });
    expect(requests).toHaveLength(0);
  });

  it('resolves the team from project ownership for a pre-fix connection', async () => {
    const { ctx, requests } = makeCtx({
      projects: [project('team_abc', 'a'), project('team_abc', 'b')],
      teamDetails: { id: 'team_abc', name: 'Pickle' },
    });

    expect(await resolveVercelTeamContext(ctx)).toEqual({
      teamId: 'team_abc',
      teamName: 'Pickle',
    });
    expect(requests[0]).toContain('/v9/projects');
  });

  it('never lists teams, which an integration token is forbidden from doing', async () => {
    // A team-scoped install answers GET /v2/teams with 403 "You don't have
    // permission to list the team." even while holding Team read for its own
    // team, so the resolution path must not depend on it.
    const { ctx, requests } = makeCtx({ projects: [project('team_abc')] });

    await resolveVercelTeamContext(ctx);

    expect(requests.some((path) => /^\/v2\/teams(\?|$)/.test(path))).toBe(false);
  });

  it('keeps the team id when its name cannot be read', async () => {
    const { ctx } = makeCtx({
      projects: [project('team_abc')],
      teamDetailsError: new Error('HTTP 403: Forbidden'),
    });

    // The id alone is enough to scope requests; the name is cosmetic.
    expect(await resolveVercelTeamContext(ctx)).toEqual({ teamId: 'team_abc' });
  });

  it('treats user-owned projects as a personal account', async () => {
    const { ctx } = makeCtx({ projects: [project('usr_xyz')] });

    expect(await resolveVercelTeamContext(ctx)).toEqual({});
  });

  it('does not guess when visible projects span two teams', async () => {
    const { ctx } = makeCtx({
      projects: [project('team_a', 'a'), project('team_b', 'b')],
    });

    expect(await resolveVercelTeamContext(ctx)).toEqual({});
  });

  it('reports no team when the connection can see no projects', async () => {
    const { ctx } = makeCtx({ projects: [] });

    expect(await resolveVercelTeamContext(ctx)).toEqual({});
  });

  it('degrades to no team when the project read fails rather than throwing', async () => {
    const { ctx } = makeCtx({ projectsError: new Error('HTTP 403: Forbidden') });

    expect(await resolveVercelTeamContext(ctx)).toEqual({});
  });
});
