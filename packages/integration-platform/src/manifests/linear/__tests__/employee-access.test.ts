import { describe, expect, it } from 'bun:test';
import { registry } from '../../../registry';
import type { CheckContext } from '../../../types';
import { employeeAccessCheck } from '../checks/employee-access';
import { linearManifest } from '../index';
import type { LinearEmployeeAccessResponse, LinearUser } from '../types';

type Emitted = Record<string, unknown>;

interface GraphqlPage {
  organization: { id: string; name: string; urlKey: string } | null;
  users: {
    nodes: LinearUser[];
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
}

/**
 * Mock CheckContext serving `pages` from ctx.graphql one call at a time and recording
 * what the check emitted. Only the surface this check touches is implemented; anything
 * else throws so an unexpected call is loud rather than silently returning undefined.
 */
function createMockContext(options: { pages?: GraphqlPage[]; graphqlError?: Error }) {
  const { pages = [], graphqlError } = options;

  const passes: Emitted[] = [];
  const fails: Emitted[] = [];
  const logs: string[] = [];
  const warnings: string[] = [];
  const cursors: Array<string | null | undefined> = [];

  let call = 0;

  const notImplemented = (name: string) => async () => {
    throw new Error(`ctx.${name} should not be called by the Linear check`);
  };

  const ctx = {
    accessToken: '',
    credentials: { api_key: 'lin_api_test' },
    variables: {},
    connectionId: 'conn-linear-1',
    organizationId: 'org-1',
    metadata: {},

    log: (msg: string) => logs.push(msg),
    warn: (msg: string) => warnings.push(msg),
    error: (msg: string) => logs.push(`ERROR: ${msg}`),

    pass: (result: Emitted) => passes.push(result),
    fail: (finding: Emitted) => fails.push(finding),
    addPassingResult: (result: Emitted) => passes.push(result),
    addFinding: (finding: Emitted) => fails.push(finding),

    graphql: async <T>(_query: string, variables?: Record<string, unknown>): Promise<T> => {
      if (graphqlError) throw graphqlError;
      cursors.push(variables?.after as string | null | undefined);
      const nextPage = pages[call];
      call += 1;
      if (!nextPage) throw new Error(`No fixture page for graphql call ${call}`);
      return nextPage as T;
    },

    fetch: notImplemented('fetch'),
    post: notImplemented('post'),
    put: notImplemented('put'),
    patch: notImplemented('patch'),
    delete: notImplemented('delete'),
    fetchAllPages: notImplemented('fetchAllPages'),
    fetchWithCursor: notImplemented('fetchWithCursor'),
    fetchWithLinkHeader: notImplemented('fetchWithLinkHeader'),

    getState: async () => null,
    setState: async () => {},

    _passes: passes,
    _fails: fails,
    _logs: logs,
    _warnings: warnings,
    _cursors: cursors,
    get _calls() {
      return call;
    },
  };

  return ctx as unknown as CheckContext & typeof ctx;
}

function page(
  nodes: LinearUser[],
  opts: { hasNextPage?: boolean; endCursor?: string | null } = {},
): GraphqlPage {
  return {
    organization: { id: 'org_1', name: 'Acme', urlKey: 'acme' },
    users: {
      nodes,
      pageInfo: {
        hasNextPage: opts.hasNextPage ?? false,
        endCursor: opts.endCursor ?? null,
      },
    },
  };
}

const user = (overrides: Partial<LinearUser> & Pick<LinearUser, 'id'>): LinearUser => ({
  name: 'Test User',
  email: `${overrides.id}@acme.test`,
  active: true,
  admin: false,
  guest: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

describe('linear manifest', () => {
  it('is registered in the registry as a code manifest', () => {
    expect(registry.getManifest('linear')).toBeDefined();
    // Code manifests can never be shadowed by a DB-backed definition of the same slug,
    // and — critically — their failures are reported plainly rather than held as
    // 'inconclusive' the way dynamic-provider runs are.
    expect(registry.isCodeManifest('linear')).toBe(true);
  });

  it('sends the API key raw on the Authorization header', () => {
    expect(linearManifest.auth.type).toBe('api_key');
    if (linearManifest.auth.type !== 'api_key') throw new Error('unreachable');

    expect(linearManifest.auth.config.in).toBe('header');
    expect(linearManifest.auth.config.name).toBe('Authorization');
    // Linear personal API keys carry no "Bearer " prefix — only its OAuth tokens do.
    expect(linearManifest.auth.config.prefix).toBeUndefined();
  });

  it('exposes setup instructions and an api_key credential field to the connect form', () => {
    if (linearManifest.auth.type !== 'api_key') throw new Error('unreachable');
    expect(linearManifest.auth.config.setupInstructions).toContain('Personal API keys');

    const field = linearManifest.credentialFields?.[0];
    expect(field?.id).toBe('api_key');
    expect(field?.type).toBe('password');
    expect(field?.required).toBe(true);
  });

  it('matches the public catalog contract', () => {
    expect(linearManifest.id).toBe('linear');
    expect(linearManifest.category).toBe('Development');
    expect(linearManifest.capabilities).toEqual(['checks']);
    expect(linearManifest.supportsMultipleConnections).toBe(false);
    expect(linearManifest.checks).toHaveLength(1);
    expect(linearManifest.checks?.[0].id).toBe('linear_employee_access');
  });

  it('derives the GraphQL endpoint ctx.graphql will call from baseUrl', () => {
    // ctx.graphql defaults to `${baseUrl}/graphql`.
    expect(`${linearManifest.baseUrl}/graphql`).toBe('https://api.linear.app/graphql');
  });

  it('maps the check to the Employee Access task template', () => {
    expect(employeeAccessCheck.taskMapping).toBe('frk_tt_68406ca292d9fffb264991b9');
  });
});

describe('linear employee access check', () => {
  it('emits one passing row per active member, keyed by lowercased email', async () => {
    const ctx = createMockContext({
      pages: [
        page([
          user({ id: 'u1', name: 'Ada', email: 'Ada@Acme.TEST' }),
          user({ id: 'u2', name: 'Grace', email: 'grace@acme.test' }),
        ]),
      ],
    });

    await employeeAccessCheck.run(ctx);

    expect(ctx._fails).toHaveLength(0);
    expect(ctx._passes).toHaveLength(2);
    expect(ctx._passes.map((p) => p.resourceId)).toEqual(['ada@acme.test', 'grace@acme.test']);
    expect(ctx._passes.every((p) => p.resourceType === 'user')).toBe(true);
    expect(ctx._passes.every((p) => p.title === 'Employee Access')).toBe(true);
  });

  it('follows the cursor across pages and collects every member', async () => {
    const ctx = createMockContext({
      pages: [
        page([user({ id: 'u1' })], { hasNextPage: true, endCursor: 'cursor-1' }),
        page([user({ id: 'u2' })], { hasNextPage: true, endCursor: 'cursor-2' }),
        page([user({ id: 'u3' })]),
      ],
    });

    await employeeAccessCheck.run(ctx);

    expect(ctx._calls).toBe(3);
    // First request sends no cursor; each later one sends the previous endCursor.
    expect(ctx._cursors).toEqual([null, 'cursor-1', 'cursor-2']);
    expect(ctx._passes).toHaveLength(3);
  });

  it('excludes inactive members from the roster', async () => {
    const ctx = createMockContext({
      pages: [page([user({ id: 'active-1' }), user({ id: 'deactivated', active: false })])],
    });

    await employeeAccessCheck.run(ctx);

    expect(ctx._passes).toHaveLength(1);
    expect(ctx._passes[0].resourceId).toBe('active-1@acme.test');
  });

  it('labels admins, guests and members distinctly', async () => {
    const ctx = createMockContext({
      pages: [
        page([
          user({ id: 'boss', admin: true }),
          user({ id: 'visitor', guest: true }),
          user({ id: 'regular' }),
        ]),
      ],
    });

    await employeeAccessCheck.run(ctx);

    const roles = ctx._passes.map((p) => (p.evidence as Record<string, unknown>).role);
    expect(roles).toEqual(['Admin', 'Guest', 'Member']);

    const adminEvidence = ctx._passes[0].evidence as Record<string, unknown>;
    expect(adminEvidence.isAdmin).toBe(true);
    expect(adminEvidence.isGuest).toBe(false);
    expect(adminEvidence.workspace).toBe('Acme');
    expect(adminEvidence.externalId).toBe('boss');
  });

  it('emits exactly one org-level row when no member is active, never zero rows', async () => {
    const ctx = createMockContext({
      pages: [page([user({ id: 'gone', active: false })])],
    });

    await employeeAccessCheck.run(ctx);

    expect(ctx._passes).toHaveLength(1);
    expect(ctx._passes[0].resourceType).toBe('organization');
    expect(ctx._passes[0].resourceId).toBe('acme');
    expect(ctx._passes[0].title).toBe('Employee Access List');

    const evidence = ctx._passes[0].evidence as Record<string, unknown>;
    expect(evidence.totalUsers).toBe(0);
    expect(evidence.inspectedUsers).toBe(1);
  });

  it('emits an org-level row for a workspace with no members at all', async () => {
    const ctx = createMockContext({ pages: [page([])] });

    await employeeAccessCheck.run(ctx);

    expect(ctx._passes).toHaveLength(1);
    expect(ctx._passes[0].resourceType).toBe('organization');
  });

  it('skips a member with no email and warns instead of crashing', async () => {
    const ctx = createMockContext({
      pages: [page([user({ id: 'ghost', email: null }), user({ id: 'real' })])],
    });

    await employeeAccessCheck.run(ctx);

    expect(ctx._passes).toHaveLength(1);
    expect(ctx._passes[0].resourceId).toBe('real@acme.test');
    expect(ctx._warnings.some((w) => w.includes('ghost'))).toBe(true);
  });

  it('surfaces an auth failure as actionable guidance, not a clean empty review', async () => {
    const ctx = createMockContext({
      graphqlError: new Error('GraphQL: Authentication required, not authenticated'),
    });

    await expect(employeeAccessCheck.run(ctx)).rejects.toThrow(
      /Linear rejected the API key.*Security & Access/s,
    );

    // The critical assertion: a failed run must never look like an empty workspace.
    expect(ctx._passes).toHaveLength(0);
  });

  it('flags a schema drift error as the check needing an update', async () => {
    const ctx = createMockContext({
      graphqlError: new Error("GraphQL: Cannot query field 'guest' on type 'User'"),
    });

    await expect(employeeAccessCheck.run(ctx)).rejects.toThrow(
      /schema no longer matches this check's query/,
    );
  });

  it('passes through an unrecognised error unchanged', async () => {
    const ctx = createMockContext({
      graphqlError: new Error('socket hang up'),
    });

    await expect(employeeAccessCheck.run(ctx)).rejects.toThrow('socket hang up');
  });

  it('warns when the page cap truncates the roster', async () => {
    // Every page claims another page waits, so the check runs into the 20-page cap.
    const pages = Array.from({ length: 20 }, (_, i) =>
      page([user({ id: `u${i}` })], { hasNextPage: true, endCursor: `cursor-${i}` }),
    );
    const ctx = createMockContext({ pages });

    await employeeAccessCheck.run(ctx);

    expect(ctx._calls).toBe(20);
    expect(ctx._warnings.some((w) => w.includes('truncated'))).toBe(true);
    expect(ctx._passes).toHaveLength(20);
    expect((ctx._passes[0].evidence as Record<string, unknown>).truncated).toBe(true);
  });

  it('does not warn about truncation on a complete roster', async () => {
    const ctx = createMockContext({ pages: [page([user({ id: 'u1' })])] });

    await employeeAccessCheck.run(ctx);

    expect(ctx._warnings).toHaveLength(0);
    expect((ctx._passes[0].evidence as Record<string, unknown>).truncated).toBe(false);
  });
});

/**
 * Fixtures below are the real shape returned by a live Linear workspace: installed
 * OAuth apps and Linear's own integration appear in users() as active members with
 * synthetic addresses on *.linear.app subdomains.
 */
describe('linear application accounts', () => {
  const stephanie = user({
    id: 'ab16b7bc',
    name: 'Stephanie Marzan',
    displayName: 'stephanie.marzan',
    email: 'stephanie.marzan@nextdegree.org',
  });
  const holly = user({
    id: '012ae60c',
    name: 'holly.thacker@nextdegree.org',
    displayName: 'holly.thacker',
    email: 'holly.thacker@nextdegree.org',
    admin: true,
  });
  const codex = user({
    id: '9879e524',
    name: 'Codex',
    displayName: 'codex',
    email: 'a4bc02c9-24f5-44c3-a1d1-03a2e3042a99@oauthapp.linear.app',
  });
  const linearApp = user({
    id: '2337b84d',
    name: 'Linear',
    displayName: 'linear',
    email: 'linear-e0179658-cc75-40f1-9734-024ed3f006b3@linear.linear.app',
  });
  const cursor = user({
    id: 'd790b6c5',
    name: 'Cursor',
    displayName: 'cursor',
    email: 'afd5064f-8c2e-4f60-a91a-2b753321d325@oauthapp.linear.app',
  });

  it('keeps app accounts out of the employee roster', async () => {
    const ctx = createMockContext({
      pages: [page([stephanie, holly, codex, linearApp, cursor])],
    });

    await employeeAccessCheck.run(ctx);

    const peopleRows = ctx._passes.filter((p) => p.resourceType === 'user');
    expect(peopleRows.map((p) => p.resourceId)).toEqual([
      'stephanie.marzan@nextdegree.org',
      'holly.thacker@nextdegree.org',
    ]);
  });

  it('still records app accounts under a separate resource type', async () => {
    const ctx = createMockContext({
      pages: [page([stephanie, holly, codex, linearApp, cursor])],
    });

    await employeeAccessCheck.run(ctx);

    const appRows = ctx._passes.filter((p) => p.resourceType === 'service_account');
    expect(appRows).toHaveLength(3);
    expect(appRows.every((p) => p.title === 'Application Access')).toBe(true);
    expect((appRows[0].evidence as Record<string, unknown>).isApplication).toBe(true);
    // Every row is still accounted for — nothing is silently dropped.
    expect(ctx._passes).toHaveLength(5);
  });

  it('treats a real @linear.app address as a person, not an app', async () => {
    // Linear's own staff would be on the bare domain; only subdomains are synthetic.
    const linearEmployee = user({ id: 'staff', email: 'someone@linear.app' });
    const ctx = createMockContext({ pages: [page([linearEmployee])] });

    await employeeAccessCheck.run(ctx);

    expect(ctx._passes).toHaveLength(1);
    expect(ctx._passes[0].resourceType).toBe('user');
  });

  it('emits the org-level row when a workspace has apps but no people', async () => {
    const ctx = createMockContext({ pages: [page([codex, cursor])] });

    await employeeAccessCheck.run(ctx);

    const orgRows = ctx._passes.filter((p) => p.resourceType === 'organization');
    expect(orgRows).toHaveLength(1);

    const evidence = orgRows[0].evidence as Record<string, unknown>;
    expect(evidence.totalUsers).toBe(0);
    expect(evidence.applicationAccounts).toBe(2);

    // The apps are still recorded alongside it.
    expect(ctx._passes.filter((p) => p.resourceType === 'service_account')).toHaveLength(2);
  });
});

/** Guards the response type against drifting from what the check actually reads. */
describe('linear types', () => {
  it('models the employee-access response shape the check consumes', () => {
    const response: LinearEmployeeAccessResponse = {
      organization: { id: 'org_1', name: 'Acme', urlKey: 'acme' },
      users: {
        nodes: [user({ id: 'u1' })],
        pageInfo: { hasNextPage: false, endCursor: null },
      },
    };

    expect(response.users.nodes[0].active).toBe(true);
  });
});
