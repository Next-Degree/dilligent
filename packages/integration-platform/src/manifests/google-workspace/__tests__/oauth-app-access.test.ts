import { describe, expect, it } from 'bun:test';
import type { CheckContext, CheckResult, CheckVariableValues } from '../../../types';
import {
  INVENTORY_MARKER_RESOURCE_ID,
  oauthAppAccessCheck,
  SCOPE_CONSENT_RESOURCE_ID,
} from '../checks/oauth-app-access';
import { aggregateGrantsByApp, toAppRows } from '../oauth-app-aggregation';
import { CONSECUTIVE_DENIAL_LIMIT, TOKENS_CONCURRENCY } from '../tokens-fan-out';
import type { GoogleWorkspaceToken, GoogleWorkspaceUser } from '../types';

const makeUser = (
  overrides: Partial<GoogleWorkspaceUser> & { primaryEmail: string },
): GoogleWorkspaceUser => ({
  id: `id_${overrides.primaryEmail}`,
  name: { givenName: 'Test', familyName: 'User', fullName: 'Test User' },
  isAdmin: false,
  isDelegatedAdmin: false,
  isEnrolledIn2Sv: true,
  isEnforcedIn2Sv: true,
  suspended: false,
  archived: false,
  creationTime: '2024-01-01T00:00:00Z',
  lastLoginTime: '2026-01-01T00:00:00Z',
  orgUnitPath: '/',
  ...overrides,
});

const httpError = (status: number): Error => {
  const error = new Error(`HTTP ${status}: denied`);
  (error as Error & { status: number }).status = status;
  return error;
};

interface RunOutcome {
  passed: CheckResult[];
  failed: CheckResult[];
  logs: string[];
  tokenCalls: string[];
  maxInFlight: number;
}

async function runCheck({
  users,
  tokensByUser = {},
  errorsByUser = {},
  variables = {},
}: {
  users: GoogleWorkspaceUser[];
  tokensByUser?: Record<string, GoogleWorkspaceToken[]>;
  errorsByUser?: Record<string, Error>;
  variables?: CheckVariableValues;
}): Promise<RunOutcome> {
  const passed: CheckResult[] = [];
  const failed: CheckResult[] = [];
  const logs: string[] = [];
  const tokenCalls: string[] = [];

  let inFlight = 0;
  let maxInFlight = 0;

  const ctx: CheckContext = {
    accessToken: 'tok',
    credentials: {},
    variables,
    connectionId: 'conn_1',
    organizationId: 'org_1',
    metadata: {},
    log: (message: string) => logs.push(message),
    pass: (result) => passed.push(result as CheckResult),
    fail: (result) => failed.push(result as CheckResult),
    fetch: (async <T,>(path: string): Promise<T> => {
      const tokens = path.match(/^\/admin\/directory\/v1\/users\/([^/]+)\/tokens$/);
      if (tokens) {
        const userKey = decodeURIComponent(tokens[1]);
        tokenCalls.push(userKey);

        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        // Yield so overlapping workers are actually observable.
        await new Promise((resolve) => setTimeout(resolve, 1));
        inFlight--;

        if (errorsByUser[userKey]) {
          throw errorsByUser[userKey];
        }
        return { kind: 'admin#directory#tokens', items: tokensByUser[userKey] ?? [] } as T;
      }

      if (path.includes('/admin/directory/v1/users')) {
        return { kind: 'k', users } as unknown as T;
      }

      throw new Error(`Unexpected fetch: ${path}`);
    }) as CheckContext['fetch'],
    fetchAllPages: (async () => []) as CheckContext['fetchAllPages'],
    graphql: (async () => ({})) as CheckContext['graphql'],
  } as CheckContext;

  await oauthAppAccessCheck.run(ctx);
  return { passed, failed, logs, tokenCalls, maxInFlight };
}

const marker = (passed: CheckResult[]): CheckResult | undefined =>
  passed.find((row) => row.resourceId === INVENTORY_MARKER_RESOURCE_ID);

const evidenceOf = (result: CheckResult | undefined): Record<string, unknown> =>
  (result?.evidence ?? {}) as Record<string, unknown>;

describe('oauthAppAccessCheck aggregation', () => {
  it('emits one row per app rather than per user-app pair', async () => {
    const users = [
      makeUser({ primaryEmail: 'a@example.com' }),
      makeUser({ primaryEmail: 'b@example.com' }),
    ];
    const slack: GoogleWorkspaceToken = {
      clientId: 'slack.client',
      displayText: 'Slack',
      scopes: ['https://www.googleapis.com/auth/userinfo.email'],
    };

    const { passed, failed } = await runCheck({
      users,
      tokensByUser: { 'id_a@example.com': [slack], 'id_b@example.com': [slack] },
    });

    const appRows = passed.filter((row) => row.resourceType === 'oauth_app');
    expect(appRows).toHaveLength(1);
    expect(appRows[0].resourceId).toBe('slack.client');
    expect(evidenceOf(appRows[0]).granteeCount).toBe(2);
    // Access is an inventory, not a violation.
    expect(failed).toHaveLength(0);
  });

  it('deduplicates scopes into a catalogue and stores per-grantee indices', () => {
    const scope = 'https://www.googleapis.com/auth/drive.readonly';
    const grants = new Map([
      [
        'u1',
        {
          user: { userKey: 'u1', email: 'a@example.com' },
          tokens: [{ clientId: 'app', displayText: 'App', scopes: [scope] }],
        },
      ],
      [
        'u2',
        {
          user: { userKey: 'u2', email: 'b@example.com' },
          tokens: [{ clientId: 'app', displayText: 'App', scopes: [scope] }],
        },
      ],
    ]);

    const [app] = aggregateGrantsByApp(grants);

    expect(app.scopeCatalog).toEqual([scope]);
    expect(app.grantees.map((g) => g.scopeIndices)).toEqual([[0], [0]]);
  });

  it('spills past 500 grantees into numbered parts without discarding anyone', () => {
    const grantees = Array.from({ length: 1201 }, (_, index) => [
      `u${index}`,
      {
        user: { userKey: `u${index}`, email: `user${index}@example.com` },
        tokens: [{ clientId: 'big.app', displayText: 'Big', scopes: [] }],
      },
    ]) as [string, { user: { userKey: string; email: string }; tokens: GoogleWorkspaceToken[] }][];

    const rows = toAppRows(aggregateGrantsByApp(new Map(grantees)));

    expect(rows.map((row) => row.resourceId)).toEqual([
      'big.app',
      'big.app#2',
      'big.app#3',
    ]);
    expect(rows.every((row) => row.partCount === 3)).toBe(true);
    expect(rows.every((row) => row.granteeCount === 1201)).toBe(true);
    // No grantee silently dropped.
    expect(rows.reduce((total, row) => total + row.grantees.length, 0)).toBe(1201);
    expect(rows.every((row) => row.truncated === false)).toBe(true);
  });
});

describe('oauthAppAccessCheck resilience', () => {
  it('continues past a single denied user without throwing', async () => {
    const users = [
      makeUser({ primaryEmail: 'ok@example.com' }),
      makeUser({ primaryEmail: 'denied@example.com' }),
      makeUser({ primaryEmail: 'also-ok@example.com' }),
    ];

    const { passed } = await runCheck({
      users,
      errorsByUser: { 'id_denied@example.com': httpError(403) },
      tokensByUser: {
        'id_ok@example.com': [{ clientId: 'app', displayText: 'App' }],
        'id_also-ok@example.com': [{ clientId: 'app', displayText: 'App' }],
      },
    });

    const evidence = evidenceOf(marker(passed));
    expect(evidence.usersInspected).toBe(3);
    expect(evidence.usersSucceeded).toBe(2);
    expect(evidence.usersDenied).toBe(1);
    // One unreadable user in three is over the 20% bar, so the run declines to claim it
    // saw everything — the point being that it still collected and emitted what it could.
    expect(evidence.complete).toBe(false);
    expect(passed.filter((row) => row.resourceType === 'oauth_app')).toHaveLength(1);
  });

  it('stops issuing requests once denials look global', async () => {
    const users = Array.from({ length: 50 }, (_, index) =>
      makeUser({ primaryEmail: `u${index}@example.com` }),
    );
    const errorsByUser = Object.fromEntries(
      users.map((user) => [user.id, httpError(403)]),
    );

    const { passed, failed, tokenCalls } = await runCheck({ users, errorsByUser });

    // Early exit turns a 50-call quota burn into roughly the denial limit, allowing for
    // requests already in flight across the worker pool when the limit is reached.
    expect(tokenCalls.length).toBeLessThanOrEqual(
      CONSECUTIVE_DENIAL_LIMIT + TOKENS_CONCURRENCY,
    );
    expect(tokenCalls.length).toBeLessThan(users.length);

    const consent = failed.find((row) => row.resourceId === SCOPE_CONSENT_RESOURCE_ID);
    expect(consent).toBeDefined();
    expect(evidenceOf(marker(passed)).complete).toBe(false);
    expect(evidenceOf(marker(passed)).globalDenial).toBe(true);
  });

  it('never runs more than the configured number of requests concurrently', async () => {
    const users = Array.from({ length: 40 }, (_, index) =>
      makeUser({ primaryEmail: `u${index}@example.com` }),
    );

    const { maxInFlight } = await runCheck({ users });

    expect(maxInFlight).toBeLessThanOrEqual(TOKENS_CONCURRENCY);
  });

  it('does not write employee emails into run logs', async () => {
    const users = [
      makeUser({ primaryEmail: 'sensitive.person@example.com' }),
      makeUser({ primaryEmail: 'another@example.com' }),
    ];

    const { logs } = await runCheck({
      users,
      tokensByUser: {
        'id_sensitive.person@example.com': [{ clientId: 'app', displayText: 'App' }],
      },
      errorsByUser: { 'id_another@example.com': httpError(500) },
    });

    const combined = logs.join('\n');
    expect(combined).not.toContain('sensitive.person@example.com');
    expect(combined).not.toContain('another@example.com');
    expect(combined).not.toContain('@example.com');
  });
});

describe('oauthAppAccessCheck run marker', () => {
  it('reports complete when every user was read', async () => {
    const users = [makeUser({ primaryEmail: 'a@example.com' })];

    const { passed } = await runCheck({
      users,
      tokensByUser: { 'id_a@example.com': [{ clientId: 'app', displayText: 'App' }] },
    });

    const evidence = evidenceOf(marker(passed));
    expect(evidence.complete).toBe(true);
    expect(evidence.schemaVersion).toBe(1);
    expect(evidence.usersInspected).toBe(1);
    expect(evidence.appCount).toBe(1);
    expect(evidence.grantCount).toBe(1);
  });

  it('reports complete with a zero app count for a genuinely empty inventory', async () => {
    const users = [makeUser({ primaryEmail: 'a@example.com' })];

    const { passed } = await runCheck({ users, tokensByUser: {} });

    const evidence = evidenceOf(marker(passed));
    // The only path to reconciling an empty inventory: nobody has authorized anything.
    expect(evidence.complete).toBe(true);
    expect(evidence.appCount).toBe(0);
  });

  it('reports incomplete when more than a fifth of users could not be read', async () => {
    const users = Array.from({ length: 10 }, (_, index) =>
      makeUser({ primaryEmail: `u${index}@example.com` }),
    );
    const errorsByUser = {
      id_u0: httpError(500),
      id_u1: httpError(500),
      id_u2: httpError(500),
    } as Record<string, Error>;

    const { passed } = await runCheck({
      users,
      errorsByUser: Object.fromEntries(
        Object.entries(errorsByUser).map(([key, error]) => [`${key}@example.com`, error]),
      ),
    });

    const evidence = evidenceOf(marker(passed));
    expect(evidence.usersFailed).toBe(3);
    expect(evidence.complete).toBe(false);
  });

  it('emits exactly one marker even when no users match the filters', async () => {
    const users = [makeUser({ primaryEmail: 'a@example.com', suspended: true })];

    const { passed } = await runCheck({ users });

    const markers = passed.filter((row) => row.resourceType === 'inventory');
    expect(markers).toHaveLength(1);
    // Zero users inspected can never be read as "everything was revoked".
    expect(evidenceOf(markers[0]).complete).toBe(false);
    expect(evidenceOf(markers[0]).usersInspected).toBe(0);
    // The run never stores zero rows.
    expect(passed.length).toBeGreaterThan(0);
  });

  it('reuses the shared user filter so suspended and out-of-OU users are skipped', async () => {
    const users = [
      makeUser({ primaryEmail: 'in@example.com', orgUnitPath: '/Staff' }),
      makeUser({ primaryEmail: 'out@example.com', orgUnitPath: '/Contractors' }),
      makeUser({ primaryEmail: 'suspended@example.com', orgUnitPath: '/Staff', suspended: true }),
    ];

    const { passed, tokenCalls } = await runCheck({
      users,
      variables: { target_org_units: ['/Staff'] },
    });

    expect(tokenCalls).toEqual(['id_in@example.com']);
    expect(evidenceOf(marker(passed)).usersInspected).toBe(1);
  });
});
