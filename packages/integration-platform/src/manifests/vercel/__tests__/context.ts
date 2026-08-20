import type {
  CheckContext,
  CheckFindingResult,
  CheckPassingResult,
  CheckVariableValues,
  OrganizationMemberSummary,
} from '../../../types';

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
/** Build a roster member, defaulting to an active employee with one email. */
export function makeEmployee(
  overrides: Partial<OrganizationMemberSummary> & { email: string },
): OrganizationMemberSummary {
  const email = overrides.email.toLowerCase();
  return {
    linkedEmailSource: null,
    name: 'Employee',
    role: 'employee',
    isActive: true,
    department: null,
    offboardDate: null,
    ...overrides,
    email,
    emails: overrides.emails ?? [email],
  };
}

export function makeCheckContext(options: {
  handle: (path: string) => unknown;
  variables?: CheckVariableValues;
  teamId?: string;
  teamName?: string;
  /** Omit to simulate a runtime with no roster provider. */
  members?: OrganizationMemberSummary[];
  rosterError?: Error;
}): RecordedRun {
  const passes: CheckPassingResult[] = [];
  const fails: CheckFindingResult[] = [];
  const requests: string[] = [];

  const ctx = {
    accessToken: 'tok',
    credentials: {},
    variables: options.variables,
    connectionId: 'conn_1',
    organizationId: 'org_1',
    metadata: options.teamId
      ? { oauth: { team: { id: options.teamId, name: options.teamName ?? 'Team' } } }
      : {},
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
    listOrganizationMembers:
      options.members || options.rosterError
        ? async () => {
            if (options.rosterError) throw options.rosterError;
            return options.members ?? [];
          }
        : undefined,
  } as unknown as CheckContext;

  return { ctx, passes, fails, requests };
}

export const findByResourceId = <T extends { resourceId: string }>(
  results: T[],
  resourceId: string,
): T | undefined => results.find((result) => result.resourceId === resourceId);
