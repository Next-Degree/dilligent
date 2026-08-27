import type {
  CheckContext,
  CheckFindingResult,
  CheckPassingResult,
  CheckVariableValues,
} from '../../../types';
import type {
  NeonBackupScheduleEntry,
  NeonBranch,
  NeonEndpoint,
  NeonOrganization,
  NeonOrganizationMember,
  NeonProject,
} from '../types';

export interface RecordedRun {
  ctx: CheckContext;
  passes: CheckPassingResult[];
  fails: CheckFindingResult[];
  requests: string[];
}

/** The HTTP error shape the runtime throws: an `Error` carrying a `.status`. */
export function httpError(status: number, message = 'Forbidden'): Error {
  const error = new Error(`HTTP ${status}: ${message}`) as Error & { status: number };
  error.status = status;
  return error;
}

/** A fixture entry is either the value the API returns, or an error it throws. */
type Fixture<T> = T | Error;

export interface NeonFixture {
  /** Omit to simulate an organization-scoped key, which cannot read the user route. */
  organizations?: Fixture<NeonOrganization[]>;
  projects?: Fixture<NeonProject[]>;
  unavailableProjectIds?: string[];
  /** Keyed by project id. Falls back to the matching entry in `projects`. */
  projectDetail?: Record<string, Fixture<NeonProject>>;
  branches?: Record<string, Fixture<NeonBranch[]>>;
  endpoints?: Record<string, Fixture<NeonEndpoint[]>>;
  /** Keyed by `${projectId}:${branchId}`. */
  backupSchedule?: Record<string, Fixture<NeonBackupScheduleEntry[]>>;
  /** Keyed by organization id. */
  members?: Record<string, Fixture<NeonOrganizationMember[]>>;
}

const unwrap = <T>(value: Fixture<T> | undefined, fallback: T): T => {
  if (value instanceof Error) throw value;
  return value ?? fallback;
};

export const makeProject = (overrides: Partial<NeonProject> & { id: string }): NeonProject => ({
  name: overrides.id,
  org_id: 'org-1',
  region_id: 'aws-us-east-2',
  pg_version: 17,
  proxy_host: 'us-east-2.aws.neon.tech',
  history_retention_seconds: 86_400,
  ...overrides,
});

export const makeEndpoint = (overrides: Partial<NeonEndpoint> & { id: string }): NeonEndpoint => ({
  host: `${overrides.id}.us-east-2.aws.neon.tech`,
  type: 'read_write',
  disabled: false,
  current_state: 'idle',
  branch_id: 'br-main',
  ...overrides,
});

export const makeBranch = (overrides: Partial<NeonBranch> & { id: string }): NeonBranch => ({
  name: overrides.id,
  default: true,
  current_state: 'ready',
  ...overrides,
});

export const makeMember = (
  email: string,
  overrides: {
    hasMfa?: boolean | undefined;
    deactivatedAt?: string;
    role?: 'admin' | 'member';
  } = {},
): NeonOrganizationMember => ({
  member: {
    id: `mem-${email}`,
    user_id: `usr-${email}`,
    org_id: 'org-1',
    role: overrides.role ?? 'member',
    joined_at: '2026-01-01T00:00:00Z',
  },
  user: {
    email,
    ...(overrides.hasMfa === undefined ? {} : { has_mfa: overrides.hasMfa }),
    ...(overrides.deactivatedAt ? { deactivated_at: overrides.deactivatedAt } : {}),
  },
});

/**
 * A CheckContext backed by fixtures rather than a hand-written path switch, so
 * a test states what Neon holds and not how the client asks for it.
 */
export function makeNeonContext(
  fixture: NeonFixture,
  variables?: CheckVariableValues,
): RecordedRun {
  const passes: CheckPassingResult[] = [];
  const fails: CheckFindingResult[] = [];
  const requests: string[] = [];

  const serve = (path: string): unknown => {
    if (path === 'users/me/organizations') {
      if (fixture.organizations instanceof Error) throw fixture.organizations;
      // No fixture means an organization-scoped key: the user route is denied.
      if (!fixture.organizations) throw httpError(403, 'Forbidden');
      return { organizations: fixture.organizations };
    }

    if (path === 'projects') {
      return {
        projects: unwrap(fixture.projects, []),
        ...(fixture.unavailableProjectIds
          ? { unavailable_project_ids: fixture.unavailableProjectIds }
          : {}),
      };
    }

    const detail = /^projects\/([^/]+)$/.exec(path);
    if (detail) {
      const id = decodeURIComponent(detail[1]!);
      const override = fixture.projectDetail?.[id];
      if (override instanceof Error) throw override;
      const listed = unwrap(fixture.projects, []).find((project) => project.id === id);
      return { project: override ?? listed };
    }

    const branches = /^projects\/([^/]+)\/branches$/.exec(path);
    if (branches) {
      const id = decodeURIComponent(branches[1]!);
      return { branches: unwrap(fixture.branches?.[id], []) };
    }

    const endpoints = /^projects\/([^/]+)\/endpoints$/.exec(path);
    if (endpoints) {
      const id = decodeURIComponent(endpoints[1]!);
      return { endpoints: unwrap(fixture.endpoints?.[id], []) };
    }

    const schedule = /^projects\/([^/]+)\/branches\/([^/]+)\/backup_schedule$/.exec(path);
    if (schedule) {
      const key = `${decodeURIComponent(schedule[1]!)}:${decodeURIComponent(schedule[2]!)}`;
      return { schedule: unwrap(fixture.backupSchedule?.[key], []) };
    }

    const members = /^organizations\/([^/]+)\/members$/.exec(path);
    if (members) {
      const id = decodeURIComponent(members[1]!);
      return { members: unwrap(fixture.members?.[id], []) };
    }

    throw new Error(`Unexpected Neon request: ${path}`);
  };

  const ctx = {
    accessToken: '',
    credentials: { api_key: 'napi_test' },
    variables,
    connectionId: 'conn_1',
    organizationId: 'org_1',
    log: () => {},
    warn: () => {},
    error: () => {},
    pass: (result: CheckPassingResult) => {
      passes.push(result);
    },
    fail: (finding: CheckFindingResult) => {
      fails.push(finding);
    },
    fetch: (async <T>(path: string, options?: { params?: Record<string, string> }): Promise<T> => {
      const query = options?.params ? new URLSearchParams(options.params).toString() : '';
      requests.push(query ? `${path}?${query}` : path);
      return serve(path) as T;
    }) as CheckContext['fetch'],
    fetchAllPages: (async () => []) as CheckContext['fetchAllPages'],
    graphql: (async () => ({})) as CheckContext['graphql'],
  } as unknown as CheckContext;

  return { ctx, passes, fails, requests };
}

export const findByResourceId = <T extends { resourceId: string }>(
  results: T[],
  resourceId: string,
): T | undefined => results.find((result) => result.resourceId === resourceId);
