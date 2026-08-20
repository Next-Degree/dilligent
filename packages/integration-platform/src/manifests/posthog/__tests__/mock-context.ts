/**
 * Mock CheckContext for the PostHog checks.
 *
 * Serves the four collections the checks read (organizations, organization detail,
 * members, invites) from fixtures and records everything emitted. Only the surface these
 * checks touch is implemented; anything else throws so an unexpected call is loud rather
 * than silently returning undefined.
 */

import type { CheckContext, CheckVariableValues } from '../../../types';
import type {
  PostHogInvite,
  PostHogOrganization,
  PostHogOrganizationMember,
  PostHogOrganizationSummary,
} from '../types';

export type Emitted = Record<string, unknown>;

export interface MockFixtures {
  organizations?: PostHogOrganizationSummary[];
  /** Detail responses keyed by organization id. Missing ids throw, mimicking a 404. */
  organizationDetail?: Record<string, PostHogOrganization>;
  members?: Record<string, PostHogOrganizationMember[]>;
  invites?: Record<string, PostHogInvite[]>;
  variables?: CheckVariableValues;
  credentials?: Record<string, string | string[]>;
  /** Paths (matched by `includes`) that should reject, keyed to the error thrown. */
  errors?: Record<string, Error>;
}

function paginate<T>(items: T[], params: Record<string, string> | undefined) {
  const limit = Number(params?.limit ?? '100');
  const offset = Number(params?.offset ?? '0');
  const page = items.slice(offset, offset + limit);
  return {
    count: items.length,
    next: offset + limit < items.length ? `?offset=${offset + limit}` : null,
    previous: null,
    results: page,
  };
}

export function createMockContext(fixtures: MockFixtures = {}) {
  const passes: Emitted[] = [];
  const fails: Emitted[] = [];
  const logs: string[] = [];
  const warnings: string[] = [];
  const requests: Array<{ path: string; params?: Record<string, string> }> = [];

  const notImplemented = (name: string) => async () => {
    throw new Error(`ctx.${name} should not be called by the PostHog checks`);
  };

  const fetch = async <T>(
    path: string,
    options?: { params?: Record<string, string> },
  ): Promise<T> => {
    requests.push({ path, params: options?.params });

    for (const [fragment, error] of Object.entries(fixtures.errors ?? {})) {
      if (path.includes(fragment)) throw error;
    }

    if (path === '/api/organizations/') {
      return paginate(fixtures.organizations ?? [], options?.params) as T;
    }

    const members = path.match(/^\/api\/organizations\/([^/]+)\/members\/$/);
    if (members) {
      return paginate(fixtures.members?.[members[1]] ?? [], options?.params) as T;
    }

    const invites = path.match(/^\/api\/organizations\/([^/]+)\/invites\/$/);
    if (invites) {
      return paginate(fixtures.invites?.[invites[1]] ?? [], options?.params) as T;
    }

    const detail = path.match(/^\/api\/organizations\/([^/]+)\/$/);
    if (detail) {
      const organization = fixtures.organizationDetail?.[detail[1]];
      if (!organization) {
        const error = new Error(`HTTP 404: Not Found - ${path}`);
        (error as Error & { status: number }).status = 404;
        throw error;
      }
      return organization as T;
    }

    throw new Error(`Unexpected fetch: ${path}`);
  };

  const ctx = {
    accessToken: '',
    credentials: fixtures.credentials ?? { api_key: 'phx_test' },
    variables: fixtures.variables ?? {},
    connectionId: 'conn-posthog-1',
    organizationId: 'org-1',
    metadata: {},

    log: (message: string) => logs.push(message),
    warn: (message: string) => warnings.push(message),
    error: (message: string) => logs.push(`ERROR: ${message}`),

    pass: (result: Emitted) => passes.push(result),
    fail: (finding: Emitted) => fails.push(finding),
    addPassingResult: (result: Emitted) => passes.push(result),
    addFinding: (finding: Emitted) => fails.push(finding),

    fetch,
    post: notImplemented('post'),
    put: notImplemented('put'),
    patch: notImplemented('patch'),
    delete: notImplemented('delete'),
    graphql: notImplemented('graphql'),
    fetchAllPages: notImplemented('fetchAllPages'),
    fetchWithCursor: notImplemented('fetchWithCursor'),
    fetchWithLinkHeader: notImplemented('fetchWithLinkHeader'),

    getState: async () => null,
    setState: async () => {},

    _passes: passes,
    _fails: fails,
    _logs: logs,
    _warnings: warnings,
    _requests: requests,
  };

  return ctx as unknown as CheckContext & typeof ctx;
}

export const organization = (
  overrides: Partial<PostHogOrganization> & Pick<PostHogOrganization, 'id'>,
): PostHogOrganization => ({
  name: 'Acme',
  slug: 'acme',
  enforce_2fa: true,
  enforce_verified_domains: false,
  member_count: 1,
  ...overrides,
});

export const member = (
  overrides: Partial<PostHogOrganizationMember> & Pick<PostHogOrganizationMember, 'id'>,
): PostHogOrganizationMember => ({
  level: 1,
  joined_at: '2026-01-01T00:00:00Z',
  last_login: '2026-08-01T00:00:00Z',
  is_2fa_enabled: true,
  has_social_auth: false,
  ...overrides,
  user: {
    uuid: `user-${overrides.id}`,
    first_name: 'Test',
    last_name: 'User',
    email: `${overrides.id}@acme.com`,
    is_email_verified: true,
    ...overrides.user,
  },
});

export const invite = (
  overrides: Partial<PostHogInvite> & Pick<PostHogInvite, 'id'>,
): PostHogInvite => ({
  target_email: `${overrides.id}@acme.com`,
  level: 1,
  is_expired: false,
  emailing_attempt_made: true,
  created_at: '2026-08-01T00:00:00Z',
  ...overrides,
});
