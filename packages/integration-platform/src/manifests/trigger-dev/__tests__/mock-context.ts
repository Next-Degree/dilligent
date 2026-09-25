/**
 * Mock CheckContext for the Trigger.dev checks.
 *
 * Serves the endpoints the checks read from fixtures and records everything emitted.
 * Anything else throws, so an unexpected call is loud rather than silently undefined.
 */

import type { CheckContext, CheckVariableValues, DirectoryPerson } from '../../../types';
import type {
  TriggerCurrentWorkerResponse,
  TriggerEnvironment,
  TriggerMembersResponse,
  TriggerOrganization,
  TriggerProject,
  TriggerRun,
} from '../types';

export type Emitted = Record<string, unknown>;

export interface MockFixtures {
  organizations?: TriggerOrganization[];
  projects?: TriggerProject[];
  /** Keyed by project ref. */
  environments?: Record<string, TriggerEnvironment[]>;
  /** Keyed by organization id. */
  members?: Record<string, TriggerMembersResponse>;
  /** Keyed by project ref; a missing ref answers 404 ("nothing deployed"). */
  workers?: Record<string, TriggerCurrentWorkerResponse>;
  /** Keyed by project ref; served in pages of `page[size]`. */
  runs?: Record<string, TriggerRun[]>;
  /** `undefined` means no directory was supplied to the run. */
  people?: DirectoryPerson[];
  variables?: CheckVariableValues;
  token?: string;
  /** Paths (matched by `includes`) that reject, keyed to the HTTP status thrown. */
  errors?: Record<string, number>;
}

function httpError(status: number, path: string): Error {
  const error = new Error(`HTTP ${status}: ${path}`);
  (error as Error & { status: number }).status = status;
  return error;
}

export function createMockContext(fixtures: MockFixtures = {}) {
  const passes: Emitted[] = [];
  const fails: Emitted[] = [];
  const warnings: string[] = [];
  const requests: Array<{ path: string; params?: Record<string, string> }> = [];

  const notImplemented = (name: string) => async () => {
    throw new Error(`ctx.${name} should not be called by the Trigger.dev checks`);
  };

  const fetch = async <T>(
    path: string,
    options?: { params?: Record<string, string> },
  ): Promise<T> => {
    requests.push({ path, params: options?.params });

    for (const [fragment, status] of Object.entries(fixtures.errors ?? {})) {
      if (path.includes(fragment)) throw httpError(status, path);
    }

    if (path === '/api/v1/orgs') return (fixtures.organizations ?? []) as T;
    if (path === '/api/v1/projects') return (fixtures.projects ?? []) as T;

    const members = path.match(/^\/api\/v1\/orgs\/([^/]+)\/members$/);
    if (members) {
      const roster = fixtures.members?.[members[1]];
      if (!roster) throw httpError(404, path);
      return roster as T;
    }

    const environments = path.match(/^\/api\/v1\/projects\/([^/]+)\/environments$/);
    if (environments) return (fixtures.environments?.[environments[1]] ?? []) as T;

    const worker = path.match(/^\/api\/v1\/projects\/([^/]+)\/prod\/workers\/current$/);
    if (worker) {
      const current = fixtures.workers?.[worker[1]];
      if (!current) throw httpError(404, path);
      return current as T;
    }

    const runs = path.match(/^\/api\/v1\/projects\/([^/]+)\/runs$/);
    if (runs) {
      const all = fixtures.runs?.[runs[1]] ?? [];
      const size = Number(options?.params?.['page[size]'] ?? '100');
      const after = options?.params?.['page[after]'];
      const start = after ? all.findIndex((run) => run.id === after) + 1 : 0;
      const data = all.slice(start, start + size);
      const hasMore = start + size < all.length;
      return { data, pagination: hasMore ? { next: data[data.length - 1]?.id } : {} } as T;
    }

    throw new Error(`Unexpected fetch: ${path}`);
  };

  const ctx = {
    accessToken: '',
    credentials: { api_key: fixtures.token ?? 'tr_pat_test' },
    variables: fixtures.variables ?? {},
    connectionId: 'conn-trigger-1',
    organizationId: 'org-1',
    metadata: {},
    directory: fixtures.people ? { listPeople: async () => fixtures.people ?? [] } : undefined,

    log: () => {},
    warn: (message: string) => warnings.push(message),
    error: () => {},

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
    _warnings: warnings,
    _requests: requests,
  };

  return ctx as unknown as CheckContext & typeof ctx;
}

export const ORG: TriggerOrganization = { id: 'org_acme', title: 'Acme', slug: 'acme' };

export const person = (
  overrides: Partial<DirectoryPerson> & Pick<DirectoryPerson, 'id' | 'email'>,
): DirectoryPerson => ({
  linkedEmails: [],
  name: null,
  isActive: true,
  department: null,
  jobTitle: null,
  offboardDate: null,
  ...overrides,
});

export const member = (email: string, role: 'ADMIN' | 'MEMBER' = 'MEMBER') => ({
  id: `mem_${email}`,
  role,
  user: { id: `usr_${email}`, name: null, email },
});

export const project = (ref: string, name = ref): TriggerProject => ({
  id: `id_${ref}`,
  externalRef: ref,
  name,
  slug: name.toLowerCase(),
  organization: ORG,
});

export const environment = (
  type: TriggerEnvironment['type'],
  overrides: Partial<TriggerEnvironment> = {},
): TriggerEnvironment => ({
  id: `env_${type}`,
  slug: { PRODUCTION: 'prod', STAGING: 'stg', DEVELOPMENT: 'dev', PREVIEW: 'preview' }[type],
  type,
  isBranchableEnvironment: type === 'PREVIEW',
  branchName: null,
  paused: false,
  ...overrides,
});

export const worker = (taskCount = 2): TriggerCurrentWorkerResponse => ({
  worker: {
    id: 'worker_1',
    version: '20260920.1',
    sdkVersion: '4.0.0',
    tasks: Array.from({ length: taskCount }, (_, i) => ({ id: `task_${i}`, slug: `task-${i}` })),
  },
});

export const runs = (statuses: Record<string, number>): TriggerRun[] =>
  Object.entries(statuses).flatMap(([status, count]) =>
    Array.from({ length: count }, (_, i) => ({
      id: `run_${status}_${i}`,
      status,
      taskIdentifier: 'task-0',
      createdAt: '2026-09-20T00:00:00Z',
    })),
  );
