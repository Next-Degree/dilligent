import { describe, expect, it } from 'bun:test';
import type { CheckContext, CheckFindingResult } from '../../../../types';
import { resolveVercelTeam, withTeamId } from '../../team';

/**
 * The team is derived from the access token rather than configured, so
 * connecting Vercel needs nothing but the token.
 *
 * `GET /v2/teams` is a user-level operation, which is why it works for an access
 * token and did not under the previous OAuth install — an integration token is
 * refused it with 403. That refusal, plus a token-exchange field that was read
 * from a context shape nothing ever wrote, is what made every connection report
 * itself as a personal account no matter how it was installed.
 *
 * The rule these pin: only an unambiguous answer is accepted. Reporting on a
 * team nobody chose is the worst outcome available, because it looks like a
 * clean result while describing the wrong organization.
 */
function makeCtx(options: {
  teams?: Array<{ id?: string; name?: string; slug?: string }>;
  error?: Error;
}): { ctx: CheckContext; fails: CheckFindingResult[]; requests: string[] } {
  const fails: CheckFindingResult[] = [];
  const requests: string[] = [];
  const ctx = {
    accessToken: 'tok',
    credentials: { api_key: 'vcp_test' },
    connectionId: 'conn_1',
    organizationId: 'org_1',
    log: () => {},
    warn: () => {},
    error: () => {},
    fail: (finding: CheckFindingResult) => {
      fails.push(finding);
    },
    fetch: (async (path: string) => {
      requests.push(path);
      if (options.error) throw options.error;
      return { teams: options.teams ?? [] };
    }) as CheckContext['fetch'],
  } as unknown as CheckContext;
  return { ctx, fails, requests };
}

const httpError = (status: number, message = 'Forbidden'): Error => {
  const error = new Error(`HTTP ${status}: ${message}`) as Error & { status: number };
  error.status = status;
  return error;
};

describe('resolveVercelTeam', () => {
  it('derives the team from the token when it is scoped to exactly one', async () => {
    const { ctx, fails, requests } = makeCtx({ teams: [{ id: 'team_abc', name: 'Pickle' }] });

    expect(await resolveVercelTeam(ctx)).toEqual({ teamId: 'team_abc', teamName: 'Pickle' });
    expect(fails).toHaveLength(0);
    expect(requests[0]).toContain('/v2/teams');
  });

  it('refuses to choose when the token can see more than one team', async () => {
    const { ctx, fails } = makeCtx({
      teams: [
        { id: 'team_a', name: 'Acme' },
        { id: 'team_b', name: 'Beta' },
      ],
    });

    expect(await resolveVercelTeam(ctx)).toBeNull();
    expect(fails).toHaveLength(1);
    // The names belong in the finding: the fix is to pick one, so the reader
    // needs to know what the choices were.
    expect(fails[0]?.description).toContain('Acme');
    expect(fails[0]?.description).toContain('Beta');
    expect(fails[0]?.remediation).toContain('single team');
  });

  it('reports a token that belongs to no team', async () => {
    const { ctx, fails } = makeCtx({ teams: [] });

    expect(await resolveVercelTeam(ctx)).toBeNull();
    expect(fails[0]?.title).toBe('Vercel token is not scoped to a team');
  });

  it('reports a rejected token as a credential problem, not an empty account', async () => {
    // An unscoped Vercel request succeeds and returns the token owner's own
    // resources, so a failure here must never be allowed to read as "no team".
    const { ctx, fails } = makeCtx({ error: httpError(403) });

    expect(await resolveVercelTeam(ctx)).toBeNull();
    expect(fails[0]?.severity).toBe('high');
    expect(fails[0]?.remediation).toContain('Account Settings > Tokens');
  });

  it('reports a transient failure without blaming the token', async () => {
    const { ctx, fails } = makeCtx({ error: httpError(500, 'Internal Server Error') });

    expect(await resolveVercelTeam(ctx)).toBeNull();
    expect(fails[0]?.remediation).toContain('Re-run the check');
  });

  it('ignores entries with no id rather than scoping requests to undefined', async () => {
    const { ctx } = makeCtx({ teams: [{ name: 'No Id' }, { id: 'team_abc', name: 'Pickle' }] });

    expect(await resolveVercelTeam(ctx)).toEqual({ teamId: 'team_abc', teamName: 'Pickle' });
  });
});

describe('withTeamId', () => {
  it('scopes a request to the team', () => {
    expect(withTeamId(new URLSearchParams({ limit: '100' }), 'team_abc').get('teamId')).toBe(
      'team_abc',
    );
  });

  it('adds nothing when there is no team', () => {
    expect(withTeamId(new URLSearchParams({ limit: '100' }), undefined).has('teamId')).toBe(false);
  });
});
