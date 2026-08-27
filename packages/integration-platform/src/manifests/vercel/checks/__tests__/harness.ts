import type {
  CheckContext,
  CheckFindingResult,
  CheckPassingResult,
  CheckVariableValues,
  DirectoryPerson,
} from '../../../../types';

export interface RecordedRun {
  ctx: CheckContext;
  passes: CheckPassingResult[];
  fails: CheckFindingResult[];
  requests: string[];
}

/** Build the HTTP error shape the runtime throws (`Error` with a `.status`). */
export function httpError(status: number, message = 'Forbidden'): Error {
  const error = new Error(`HTTP ${status}: ${message}`) as Error & { status: number };
  error.status = status;
  return error;
}

/**
 * Minimal CheckContext for manifest checks: `handle` answers requests by path
 * (throw to simulate an API error), and every pass/fail is recorded.
 */
/** Matches the GitHub manifest's harness so directory fixtures read the same. */
export const makePerson = (overrides: Partial<DirectoryPerson> = {}): DirectoryPerson => ({
  id: 'mem_1',
  email: 'person@acme.com',
  linkedEmails: [],
  name: 'A Person',
  isActive: true,
  department: 'engineering',
  jobTitle: 'Engineer',
  offboardDate: null,
  ...overrides,
});

/** A person whose Vercel account is registered under a different address. */
export const makePersonWithLinkedVercel = ({
  email,
  linked,
  ...overrides
}: Partial<DirectoryPerson> & { linked: string }): DirectoryPerson =>
  makePerson({
    ...overrides,
    email: email ?? 'person@acme.com',
    linkedEmails: [{ source: 'vercel', email: linked }],
  });

export function makeCheckContext(options: {
  handle: (path: string) => unknown;
  variables?: CheckVariableValues;
  teamId?: string;
  teamName?: string;
  /** People directory. Omit to simulate a host that supplies none. */
  people?: DirectoryPerson[];
  /** Simulate the directory read itself throwing. */
  directoryError?: Error;
}): RecordedRun {
  const passes: CheckPassingResult[] = [];
  const fails: CheckFindingResult[] = [];
  const requests: string[] = [];

  const ctx = {
    accessToken: 'tok',
    // Mirrors the host: Vercel's token exchange returns a flat `team_id`, which
    // is persisted with the token and arrives on ctx.credentials. Deliberately
    // NOT ctx.metadata — the check runner never passes metadata to
    // runAllChecks, so a metadata-shaped stub would test a fiction.
    credentials: options.teamId ? { team_id: options.teamId } : {},
    variables: options.variables,
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
    fetch: (async <T>(path: string): Promise<T> => {
      requests.push(path);
      return options.handle(path) as T;
    }) as CheckContext['fetch'],
    fetchAllPages: (async () => []) as CheckContext['fetchAllPages'],
    graphql: (async () => ({})) as CheckContext['graphql'],
    directory:
      options.people || options.directoryError
        ? {
            listPeople: async () => {
              if (options.directoryError) throw options.directoryError;
              return options.people ?? [];
            },
          }
        : undefined,
  } as unknown as CheckContext;

  return { ctx, passes, fails, requests };
}

export const findByResourceId = <T extends { resourceId: string }>(
  results: T[],
  resourceId: string,
): T | undefined => results.find((result) => result.resourceId === resourceId);
