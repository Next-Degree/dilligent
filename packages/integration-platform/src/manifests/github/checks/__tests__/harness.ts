/**
 * Shared test harness for the GitHub checks.
 *
 * Each check only needs a handful of the CheckContext surface, so this builds a
 * context whose HTTP helpers are backed by caller-supplied fakes and whose
 * pass/fail calls are captured for assertions. Anything a test does not stub
 * throws, so an unexpected API call fails loudly instead of silently returning
 * empty data.
 */

import type {
  CheckContext,
  CheckResult,
  CheckVariableValues,
  DirectoryPerson,
  IntegrationCheck,
} from '../../../../types';

export interface CapturedPass {
  resourceId: string;
  title: string;
  description: string;
}

export interface CapturedFail extends CapturedPass {
  severity: CheckResult['severity'];
  evidence?: Record<string, unknown>;
}

export interface RunOutcome {
  passed: CapturedPass[];
  failed: CapturedFail[];
}

export interface HarnessOptions {
  variables: CheckVariableValues;
  /** Single-resource GET. Throw to simulate a 4xx. */
  fetch?: (path: string) => Promise<unknown>;
  /** Paginated GET; returns the full list. */
  fetchAllPages?: (path: string) => Promise<unknown[]>;
  graphql?: (query: string, variables?: Record<string, unknown>) => Promise<unknown>;
  /** People directory. Omit to simulate a host that supplies none. */
  people?: DirectoryPerson[];
}

export const makePerson = (overrides: Partial<DirectoryPerson> = {}): DirectoryPerson => ({
  id: 'mem_1',
  email: 'person@acme.com',
  name: 'A Person',
  isActive: true,
  department: 'engineering',
  jobTitle: 'Engineer',
  offboardDate: null,
  ...overrides,
});

export async function runGithubCheck(
  check: IntegrationCheck,
  options: HarnessOptions,
): Promise<RunOutcome> {
  const passed: CapturedPass[] = [];
  const failed: CapturedFail[] = [];

  const unexpected = (kind: string, path: string): never => {
    throw new Error(`Unexpected ${kind}: ${path}`);
  };

  const ctx: CheckContext = {
    accessToken: 'tok',
    credentials: {},
    variables: options.variables,
    connectionId: 'conn_1',
    organizationId: 'org_1',
    metadata: {},
    log: () => {},
    warn: () => {},
    error: () => {},
    pass: (result) => {
      passed.push({
        resourceId: result.resourceId ?? '',
        title: result.title,
        description: result.description,
      });
    },
    fail: (result) => {
      failed.push({
        resourceId: result.resourceId ?? '',
        title: result.title,
        description: result.description,
        severity: result.severity,
        evidence: result.evidence,
      });
    },
    fetch: (async <T>(path: string): Promise<T> => {
      if (!options.fetch) return unexpected('fetch', path);
      return (await options.fetch(path)) as T;
    }) as CheckContext['fetch'],
    fetchAllPages: (async <T>(path: string): Promise<T[]> => {
      if (!options.fetchAllPages) return unexpected('fetchAllPages', path);
      return (await options.fetchAllPages(path)) as T[];
    }) as CheckContext['fetchAllPages'],
    fetchWithLinkHeader: (async <T>(path: string): Promise<T[]> =>
      unexpected('fetchWithLinkHeader', path)) as CheckContext['fetchWithLinkHeader'],
    fetchWithCursor: (async <T>(path: string): Promise<T[]> =>
      unexpected('fetchWithCursor', path)) as CheckContext['fetchWithCursor'],
    graphql: (async <T>(query: string, variables?: Record<string, unknown>): Promise<T> => {
      if (!options.graphql) throw new Error('GraphQL not stubbed');
      return (await options.graphql(query, variables)) as T;
    }) as CheckContext['graphql'],
    getState: (async () => null) as CheckContext['getState'],
    setState: (async () => {}) as CheckContext['setState'],
    directory: options.people ? { listPeople: async () => options.people ?? [] } : undefined,
  } as CheckContext;

  await check.run(ctx);
  return { passed, failed };
}
