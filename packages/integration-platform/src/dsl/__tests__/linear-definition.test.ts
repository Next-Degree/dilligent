import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CheckContext } from '../../types';
import { interpretDeclarativeCheck } from '../interpreter';
import type { CheckDefinition } from '../types';
import { validateIntegrationDefinition } from '../validate';

/**
 * Tests for the Linear dynamic integration definition
 * (`integrations-definitions/linear.json`).
 *
 * The definition is data, not code, so these tests do two things a type-checker
 * cannot: prove the JSON still satisfies DynamicIntegrationDefinitionSchema, and
 * prove the check's `code` step behaves against fixture GraphQL responses.
 */

const DEFINITION_PATH = join(
  import.meta.dir,
  '../../../../../integrations-definitions/linear.json',
);

const rawDefinition: unknown = JSON.parse(readFileSync(DEFINITION_PATH, 'utf-8'));

interface LinearUserFixture {
  id: string;
  name?: string;
  displayName?: string;
  email?: string;
  active: boolean;
  admin?: boolean;
  guest?: boolean;
  createdAt?: string;
}

interface GraphqlPage {
  organization: { id: string; name: string; urlKey: string } | null;
  users: {
    nodes: LinearUserFixture[];
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
}

type Emitted = Record<string, unknown>;

/**
 * Mock CheckContext that serves `pages` from ctx.graphql one call at a time and
 * records what the check emitted. Only the surface the Linear check touches is
 * implemented; everything else throws so an unexpected call is loud.
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
      const page = pages[call];
      call += 1;
      if (!page) throw new Error(`No fixture page for graphql call ${call}`);
      return page as T;
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
  nodes: LinearUserFixture[],
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

const user = (
  overrides: Partial<LinearUserFixture> & Pick<LinearUserFixture, 'id'>,
): LinearUserFixture => ({
  name: 'Test User',
  email: `${overrides.id}@acme.test`,
  active: true,
  admin: false,
  guest: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

/** Builds the check straight from the committed JSON — no re-declared logic. */
function buildCheck() {
  const parsed = validateIntegrationDefinition(rawDefinition);
  if (!parsed.success || !parsed.data) {
    throw new Error(`Definition is invalid: ${JSON.stringify(parsed.errors)}`);
  }

  const check = parsed.data.checks.find((c) => c.checkSlug === 'linear_employee_access');
  if (!check) throw new Error('linear_employee_access check not found');

  return interpretDeclarativeCheck({
    id: check.checkSlug,
    name: check.name,
    description: check.description,
    definition: check.definition as CheckDefinition,
    taskMapping: check.taskMapping,
    defaultSeverity: check.defaultSeverity,
  });
}

describe('linear.json definition', () => {
  it('satisfies DynamicIntegrationDefinitionSchema', () => {
    const result = validateIntegrationDefinition(rawDefinition);
    expect(result.errors).toBeUndefined();
    expect(result.success).toBe(true);
  });

  it('declares api_key auth on the Authorization header so buildHeaders injects it', () => {
    const def = validateIntegrationDefinition(rawDefinition).data!;
    expect(def.authConfig.type).toBe('api_key');
    expect(def.authConfig.config.in).toBe('header');
    expect(def.authConfig.config.name).toBe('Authorization');
    // No prefix: Linear personal API keys are sent raw, unlike OAuth bearer tokens.
    expect(def.authConfig.config.prefix).toBeUndefined();
  });

  it('keeps setup instructions where getProvider looks for them', () => {
    const def = validateIntegrationDefinition(rawDefinition).data!;
    expect('setupInstructions' in def.authConfig.config).toBe(true);
    expect(String(def.authConfig.config.setupInstructions)).toContain('Personal API keys');
  });

  it('maps the check to the Employee Access task template', () => {
    const def = validateIntegrationDefinition(rawDefinition).data!;
    expect(def.checks[0].taskMapping).toBe('frk_tt_68406ca292d9fffb264991b9');
  });

  it('matches the public catalog contract (slug, category, single check)', () => {
    const def = validateIntegrationDefinition(rawDefinition).data!;
    expect(def.slug).toBe('linear');
    expect(def.category).toBe('Development');
    expect(def.capabilities).toEqual(['checks']);
    expect(def.supportsMultipleConnections).toBe(false);
    expect(def.checks).toHaveLength(1);
    expect(def.checks[0].checkSlug).toBe('linear_employee_access');
  });
});

describe('linear_employee_access check', () => {
  it('emits one passing row per active member, keyed by lowercased email', async () => {
    const ctx = createMockContext({
      pages: [
        page([
          user({ id: 'u1', name: 'Ada', email: 'Ada@Acme.TEST' }),
          user({ id: 'u2', name: 'Grace', email: 'grace@acme.test' }),
        ]),
      ],
    });

    await buildCheck().run(ctx);

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

    await buildCheck().run(ctx);

    expect(ctx._calls).toBe(3);
    // First request sends no cursor; each subsequent one sends the previous endCursor.
    expect(ctx._cursors).toEqual([null, 'cursor-1', 'cursor-2']);
    expect(ctx._passes).toHaveLength(3);
  });

  it('excludes inactive members from the roster', async () => {
    const ctx = createMockContext({
      pages: [page([user({ id: 'active-1' }), user({ id: 'deactivated', active: false })])],
    });

    await buildCheck().run(ctx);

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

    await buildCheck().run(ctx);

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

    await buildCheck().run(ctx);

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

    await buildCheck().run(ctx);

    expect(ctx._passes).toHaveLength(1);
    expect(ctx._passes[0].resourceType).toBe('organization');
  });

  it('skips a member with no email and warns instead of crashing', async () => {
    const ctx = createMockContext({
      pages: [page([user({ id: 'ghost', email: undefined }), user({ id: 'real' })])],
    });

    await buildCheck().run(ctx);

    expect(ctx._passes).toHaveLength(1);
    expect(ctx._passes[0].resourceId).toBe('real@acme.test');
    expect(ctx._warnings.some((w) => w.includes('ghost'))).toBe(true);
  });

  it('propagates a GraphQL error instead of silently passing with no rows', async () => {
    const ctx = createMockContext({
      graphqlError: new Error('GraphQL: Authentication required, not authenticated'),
    });

    await expect(buildCheck().run(ctx)).rejects.toThrow('Authentication required');

    // The critical assertion: a failed run must not look like a clean empty review.
    expect(ctx._passes).toHaveLength(0);
  });

  it('warns when the page cap truncates the roster', async () => {
    // 20 pages is the cap; every page reports another page waiting.
    const pages = Array.from({ length: 20 }, (_, i) =>
      page([user({ id: `u${i}` })], {
        hasNextPage: true,
        endCursor: `cursor-${i}`,
      }),
    );
    const ctx = createMockContext({ pages });

    await buildCheck().run(ctx);

    expect(ctx._calls).toBe(20);
    expect(ctx._warnings.some((w) => w.includes('truncated'))).toBe(true);
    expect(ctx._passes).toHaveLength(20);
    expect((ctx._passes[0].evidence as Record<string, unknown>).truncated).toBe(true);
  });

  it('does not warn about truncation on a complete roster', async () => {
    const ctx = createMockContext({ pages: [page([user({ id: 'u1' })])] });

    await buildCheck().run(ctx);

    expect(ctx._warnings).toHaveLength(0);
    expect((ctx._passes[0].evidence as Record<string, unknown>).truncated).toBe(false);
  });
});
