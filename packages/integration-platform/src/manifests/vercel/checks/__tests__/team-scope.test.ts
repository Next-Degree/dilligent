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
  teams?: Array<{ id?: string; name?: string }>;
  teamsError?: Error;
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
      if (options.teamsError) throw options.teamsError;
      return { teams: options.teams ?? [] };
    }) as CheckContext['fetch'],
  } as unknown as CheckContext;
  return { ctx, requests };
}

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

  it('resolves the team from the API for a connection made before it was persisted', async () => {
    const { ctx, requests } = makeCtx({ teams: [{ id: 'team_abc', name: 'Pickle' }] });

    expect(await resolveVercelTeamContext(ctx)).toEqual({
      teamId: 'team_abc',
      teamName: 'Pickle',
    });
    expect(requests[0]).toContain('/v2/teams');
  });

  it('does not guess when the token can see more than one team', async () => {
    // A personal-account token lists every team the user belongs to; picking one
    // would attribute the run to a team nobody chose.
    const { ctx } = makeCtx({
      teams: [
        { id: 'team_a', name: 'A' },
        { id: 'team_b', name: 'B' },
      ],
    });

    expect(await resolveVercelTeamContext(ctx)).toEqual({});
  });

  it('reports a genuine personal account as having no team', async () => {
    const { ctx } = makeCtx({ teams: [] });

    expect(await resolveVercelTeamContext(ctx)).toEqual({});
  });

  it('degrades to no team when the lookup fails rather than throwing', async () => {
    const { ctx } = makeCtx({ teamsError: new Error('HTTP 403: Forbidden') });

    expect(await resolveVercelTeamContext(ctx)).toEqual({});
  });
});
