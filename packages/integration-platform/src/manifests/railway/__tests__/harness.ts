import type {
  CheckContext,
  CheckFindingResult,
  CheckPassingResult,
  CheckVariableValues,
  DirectoryPerson,
} from '../../../types';
import type {
  RailwayCustomDomain,
  RailwayEnvironment,
  RailwayProject,
  RailwayServiceInstance,
  RailwayWorkspace,
  RailwayWorkspaceRef,
} from '../types';

export interface RecordedRun {
  ctx: CheckContext;
  passes: CheckPassingResult[];
  fails: CheckFindingResult[];
  operations: string[];
  endpoints: string[];
}

/** A fixture entry is either the value the API returns, or an error it throws. */
type Fixture<T> = T | Error;

export interface RailwayFixture {
  tokenWorkspaces?: Fixture<RailwayWorkspaceRef[]>;
  userWorkspaces?: Fixture<RailwayWorkspaceRef[]>;
  workspaces?: Record<string, Fixture<RailwayWorkspace>>;
  /** Project pages per workspace id, served in order. */
  projectPages?: Record<string, Fixture<{ projects: RailwayProject[]; hasNextPage?: boolean }>[]>;
  people?: DirectoryPerson[];
}

const unwrap = <T>(value: Fixture<T> | undefined, fallback: T): T => {
  if (value instanceof Error) throw value;
  return value ?? fallback;
};

const connection = <T>(nodes: T[], hasNextPage = false) => ({
  edges: nodes.map((node) => ({ node })),
  pageInfo: { hasNextPage, endCursor: hasNextPage ? `cursor-${nodes.length}` : null },
});

export const makeInstance = (
  overrides: Partial<RailwayServiceInstance> & { serviceId: string },
): RailwayServiceInstance => ({
  id: `si-${overrides.serviceId}`,
  serviceName: overrides.serviceId,
  cronSchedule: null,
  latestDeployment: {
    id: `d-${overrides.serviceId}`,
    status: 'SUCCESS',
    createdAt: '2026-09-01T00:00:00Z',
  },
  activeDeployments: [],
  domains: { customDomains: [], serviceDomains: [] },
  ...overrides,
});

export const makeEnvironment = (
  overrides: Partial<Omit<RailwayEnvironment, 'serviceInstances'>> & { id: string },
  instances: RailwayServiceInstance[],
  hasMoreInstances = false,
): RailwayEnvironment => ({
  name: 'production',
  isEphemeral: false,
  ...overrides,
  serviceInstances: connection(instances, hasMoreInstances),
});

export const makeProject = (
  overrides: Partial<Omit<RailwayProject, 'environments'>> & { id: string },
  environments: RailwayEnvironment[],
): RailwayProject => ({
  name: overrides.id,
  primaryEnvironmentId: null,
  ...overrides,
  environments: connection(environments),
});

export const makeCustomDomain = (
  overrides: Partial<RailwayCustomDomain['status']> & { id: string; domain: string },
): RailwayCustomDomain => {
  const { id, domain, ...status } = overrides;
  return {
    id,
    domain,
    status: {
      certificateStatus: 'CERTIFICATE_STATUS_TYPE_VALID',
      certificateErrorMessage: null,
      cdnProvider: null,
      verified: true,
      certificates: [
        {
          domainNames: [domain],
          expiresAt: daysFromNow(60),
          issuedAt: daysFromNow(-30),
          keyType: 'KEY_TYPE_ECDSA',
        },
      ],
      ...status,
    },
  };
};

export const daysFromNow = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();

export const makePerson = (
  overrides: Partial<DirectoryPerson> & { email: string },
): DirectoryPerson => ({
  id: `person-${overrides.email}`,
  linkedEmails: [],
  name: null,
  isActive: true,
  department: null,
  jobTitle: null,
  offboardDate: null,
  ...overrides,
});

const operationName = (query: string) => /query\s+(\w+)/.exec(query)?.[1] ?? 'anonymous';

/**
 * A CheckContext backed by fixtures, routed by GraphQL operation name, so a
 * test states what Railway holds and not how the client asks for it.
 */
export function makeRailwayContext(
  fixture: RailwayFixture,
  variables?: CheckVariableValues,
): RecordedRun {
  const passes: CheckPassingResult[] = [];
  const fails: CheckFindingResult[] = [];
  const operations: string[] = [];
  const endpoints: string[] = [];
  const pageCursor = new Map<string, number>();

  const serve = (operation: string, vars: Record<string, unknown> = {}): unknown => {
    const workspaceId = String(vars.workspaceId ?? '');
    switch (operation) {
      case 'RailwayTokenWorkspaces':
        return { apiToken: { workspaces: unwrap(fixture.tokenWorkspaces, []) } };
      case 'RailwayUserWorkspaces':
        return { me: { workspaces: unwrap(fixture.userWorkspaces, []) } };
      case 'RailwayWorkspaceMembers': {
        const workspace = unwrap(fixture.workspaces?.[workspaceId], undefined);
        if (!workspace) throw new Error(`GraphQL: Not Authorized`);
        return { workspace };
      }
      case 'RailwayWorkspaceProjects': {
        const pages = fixture.projectPages?.[workspaceId] ?? [];
        const index = pageCursor.get(workspaceId) ?? 0;
        pageCursor.set(workspaceId, index + 1);
        const page = unwrap(pages[index], { projects: [] });
        return { workspace: { projects: connection(page.projects, page.hasNextPage ?? false) } };
      }
      default:
        throw new Error(`Unexpected Railway operation: ${operation}`);
    }
  };

  const ctx = {
    accessToken: '',
    credentials: { api_key: 'test-token' },
    variables,
    connectionId: 'conn_1',
    organizationId: 'org_1',
    log: () => {},
    warn: () => {},
    error: () => {},
    pass: (result: CheckPassingResult) => passes.push(result),
    fail: (finding: CheckFindingResult) => fails.push(finding),
    graphql: (async <T>(
      query: string,
      vars?: Record<string, unknown>,
      options?: { endpoint?: string },
    ): Promise<T> => {
      const operation = operationName(query);
      operations.push(operation);
      endpoints.push(options?.endpoint ?? '');
      return serve(operation, vars) as T;
    }) as CheckContext['graphql'],
    directory: fixture.people ? { listPeople: async () => fixture.people ?? [] } : undefined,
  } as unknown as CheckContext;

  return { ctx, passes, fails, operations, endpoints };
}

export const findByResourceId = <T extends { resourceId: string }>(
  results: T[],
  resourceId: string,
): T | undefined => results.find((result) => result.resourceId === resourceId);

export const WORKSPACE: RailwayWorkspaceRef = { id: 'ws-1', name: 'Acme' };
