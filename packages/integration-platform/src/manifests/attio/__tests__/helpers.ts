import type { CheckContext, CheckVariableValues } from '../../../types';
import type {
  AttioSelfResponse,
  AttioWorkspaceMember,
  AttioWorkspaceMembersResponse,
} from '../types';

export type Emitted = Record<string, unknown>;

export interface MockOptions {
  members?: AttioWorkspaceMember[];
  variables?: CheckVariableValues;
  /** Thrown by ctx.fetch for /v2/workspace_members. */
  membersError?: unknown;
  /** Thrown by ctx.fetch for /v2/self. */
  selfError?: unknown;
  /** Overrides the default /v2/self body. */
  self?: Partial<AttioSelfResponse>;
}

const DEFAULT_SELF: AttioSelfResponse = {
  active: true,
  scope: 'user_management:read',
  workspace_id: 'ws-1',
  workspace_name: 'Acme',
  workspace_slug: 'acme',
  workspace_logo_url: null,
};

/**
 * Mock CheckContext serving Attio fixtures from ctx.fetch and recording what the check
 * emitted. Only the surface the Attio checks touch is implemented; anything else throws
 * so an unexpected call is loud rather than silently returning undefined.
 */
export function createMockContext(options: MockOptions = {}) {
  const { members = [], variables = {}, membersError, selfError, self } = options;

  const passes: Emitted[] = [];
  const fails: Emitted[] = [];
  const logs: string[] = [];
  const warnings: string[] = [];
  const paths: string[] = [];

  const notImplemented = (name: string) => async () => {
    throw new Error(`ctx.${name} should not be called by the Attio checks`);
  };

  const ctx = {
    accessToken: '',
    credentials: { api_key: 'attio_test_key' },
    variables,
    connectionId: 'conn-attio-1',
    organizationId: 'org-1',
    metadata: {},

    log: (msg: string) => logs.push(msg),
    warn: (msg: string) => warnings.push(msg),
    error: (msg: string) => logs.push(`ERROR: ${msg}`),

    pass: (result: Emitted) => passes.push(result),
    fail: (finding: Emitted) => fails.push(finding),
    addPassingResult: (result: Emitted) => passes.push(result),
    addFinding: (finding: Emitted) => fails.push(finding),

    fetch: async <T>(path: string): Promise<T> => {
      paths.push(path);

      if (path === '/v2/self') {
        if (selfError) throw selfError;
        return { ...DEFAULT_SELF, ...self } as T;
      }

      if (path === '/v2/workspace_members') {
        if (membersError) throw membersError;
        return { data: members } satisfies AttioWorkspaceMembersResponse as T;
      }

      throw new Error(`Unexpected Attio path: ${path}`);
    },

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
    _paths: paths,
  };

  return ctx as unknown as CheckContext & typeof ctx;
}

/** Builds a workspace member, defaulting to an active corporate-domain account. */
export function member(
  id: string,
  overrides: Partial<Omit<AttioWorkspaceMember, 'id'>> = {},
): AttioWorkspaceMember {
  return {
    id: { workspace_id: 'ws-1', workspace_member_id: id },
    first_name: 'Test',
    last_name: 'User',
    avatar_url: null,
    email_address: `${id}@acme.com`,
    created_at: '2026-01-01T00:00:00.000Z',
    access_level: 'member',
    ...overrides,
  };
}
