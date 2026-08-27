import { describe, expect, it } from 'bun:test';
import type { CheckContext } from '../../../../types';
import { getVercelTeamContext, requireVercelTeamId, withTeamId } from '../../team';

/**
 * Regression cover for the bug that made every Vercel connection report itself
 * as a personal account whatever it was installed against.
 *
 * Under the OAuth install the team had to be recovered, and all three available
 * mechanisms failed in production: the token exchange response was read from a
 * `ctx.metadata.oauth.team.id` shape nothing ever wrote (and the check runner
 * passes no metadata to `runAllChecks` at all); a `GET /v2/teams` fallback is a
 * user-level call an integration token answers with 403; and inferring the team
 * from project ownership required an unscoped project read, which is the very
 * thing that fails on a team install.
 *
 * The team is now a supplied credential, so there is nothing to infer. These
 * tests build the context by hand so a harness that drifts back to a
 * metadata-shaped stub cannot make them pass.
 */
function makeCtx(options: {
  credentials?: Record<string, string | string[]>;
  metadata?: Record<string, unknown>;
}): CheckContext {
  return {
    accessToken: 'tok',
    credentials: options.credentials ?? {},
    metadata: options.metadata,
    connectionId: 'conn_1',
    organizationId: 'org_1',
    log: () => {},
    warn: () => {},
    error: () => {},
  } as unknown as CheckContext;
}

describe('getVercelTeamContext', () => {
  it('reads the team from the credentials the connection supplies', () => {
    expect(getVercelTeamContext(makeCtx({ credentials: { team_id: 'team_abc' } }))).toEqual({
      teamId: 'team_abc',
    });
  });

  it('ignores a team on ctx.metadata, which the runtime never populates', () => {
    const ctx = makeCtx({
      metadata: { oauth: { team: { id: 'team_from_metadata', name: 'Ghost' } } },
    });

    expect(getVercelTeamContext(ctx)).toEqual({});
  });

  it('treats an empty team id as no team', () => {
    expect(getVercelTeamContext(makeCtx({ credentials: { team_id: '' } }))).toEqual({});
  });

  it('treats a non-string team id as no team', () => {
    // `credentials` is Record<string, string | string[]>; an array must not be
    // coerced into a query parameter.
    expect(getVercelTeamContext(makeCtx({ credentials: { team_id: ['team_a'] } }))).toEqual({});
  });
});

describe('withTeamId', () => {
  it('scopes a request to the team', () => {
    const params = withTeamId(new URLSearchParams({ limit: '100' }), 'team_abc');

    expect(params.get('teamId')).toBe('team_abc');
  });

  it('adds nothing when there is no team', () => {
    const params = withTeamId(new URLSearchParams({ limit: '100' }), undefined);

    expect(params.has('teamId')).toBe(false);
  });
});

describe('requireVercelTeamId', () => {
  const record = () => {
    const fails: Array<{ resourceId: string; title: string; remediation?: string }> = [];
    const ctx = {
      accessToken: 'tok',
      credentials: {} as Record<string, string | string[]>,
      connectionId: 'conn_1',
      organizationId: 'org_1',
      log: () => {},
      warn: () => {},
      error: () => {},
      fail: (finding: { resourceId: string; title: string; remediation?: string }) => {
        fails.push(finding);
      },
    } as unknown as CheckContext & { credentials: Record<string, string | string[]> };
    return { ctx, fails };
  };

  it('returns the configured team without reporting anything', () => {
    const { ctx, fails } = record();
    ctx.credentials.team_id = 'team_abc';

    expect(requireVercelTeamId(ctx)).toBe('team_abc');
    expect(fails).toHaveLength(0);
  });

  it('reports the missing team rather than letting the run look empty', () => {
    // An unscoped Vercel request succeeds and returns the token owner's own
    // resources, so without this the checks report "no projects" — a plausible
    // green — instead of a misconfiguration. This is also what a connection
    // carried over from the OAuth install hits, since it has no Team ID.
    const { ctx, fails } = record();

    expect(requireVercelTeamId(ctx)).toBeNull();
    expect(fails).toHaveLength(1);
    expect(fails[0]?.resourceId).toBe('team');
    expect(fails[0]?.remediation).toContain('Team ID');
  });
});
