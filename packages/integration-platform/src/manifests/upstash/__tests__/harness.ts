import type {
  CheckContext,
  CheckFindingResult,
  CheckPassingResult,
  CheckVariableValues,
} from '../../../types';
import type { UpstashDatabase } from '../types';

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

export interface UpstashFixture {
  databases?: Fixture<UpstashDatabase[]>;
}

const unwrap = <T>(value: Fixture<T> | undefined, fallback: T): T => {
  if (value instanceof Error) throw value;
  return value ?? fallback;
};

export const makeDatabase = (
  overrides: Partial<UpstashDatabase> & { database_id: string },
): UpstashDatabase => ({
  database_name: overrides.database_id,
  region: 'us-east-1',
  type: 'paid',
  state: 'active',
  tls: true,
  securityAddons: { ipWhitelisting: true },
  ...overrides,
});

/**
 * A CheckContext backed by fixtures rather than a hand-written path switch,
 * so a test states what Upstash holds and not how the client asks for it.
 */
export function makeUpstashContext(
  fixture: UpstashFixture,
  variables?: CheckVariableValues,
): RecordedRun {
  const passes: CheckPassingResult[] = [];
  const fails: CheckFindingResult[] = [];
  const requests: string[] = [];

  const serve = (path: string): unknown => {
    if (path === 'redis/databases') {
      return unwrap(fixture.databases, []);
    }
    throw new Error(`Unexpected Upstash request: ${path}`);
  };

  const ctx = {
    accessToken: '',
    credentials: { email: 'admin@example.com', api_key: 'test-key' },
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
    fetch: (async <T>(path: string): Promise<T> => {
      requests.push(path);
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
