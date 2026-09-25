import { describe, expect, it } from 'bun:test';
import {
  CONSECUTIVE_DENIAL_LIMIT,
  fetchTokensForUsers,
  PROGRESS_LOG_INTERVAL,
  TOKENS_CONCURRENCY,
} from '../tokens-fan-out';
import type { GoogleWorkspaceUser } from '../types';

const makeUsers = (count: number): GoogleWorkspaceUser[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `id_${index}`,
    primaryEmail: `user${index}@example.com`,
    name: { givenName: 'Test', familyName: 'User', fullName: 'Test User' },
    isAdmin: false,
    isDelegatedAdmin: false,
    isEnrolledIn2Sv: true,
    isEnforcedIn2Sv: true,
    suspended: false,
    archived: false,
    creationTime: '2024-01-01T00:00:00Z',
    lastLoginTime: '2026-01-01T00:00:00Z',
    orgUnitPath: '/',
  }));

const deniedError = (): Error => {
  const error = new Error('HTTP 403: denied');
  (error as Error & { status: number }).status = 403;
  return error;
};

/** Run the fan-out, yielding between calls so the five workers genuinely interleave. */
async function run({
  userCount,
  fetchTokens,
}: {
  userCount: number;
  fetchTokens?: (userKey: string) => Promise<{ kind: string; items: [] }>;
}) {
  const logs: string[] = [];

  const result = await fetchTokensForUsers({
    users: makeUsers(userCount),
    deps: {
      log: (message: string) => logs.push(message),
      fetchTokens:
        fetchTokens ??
        (async () => {
          await new Promise((resolve) => setTimeout(resolve, 0));
          return { kind: 'admin#directory#tokens', items: [] as [] };
        }),
    },
  });

  return { result, logs, progress: logs.filter((line) => line.startsWith('Inspected ')) };
}

describe('fetchTokensForUsers progress logging', () => {
  it('stays quiet for a directory smaller than one interval', async () => {
    const { progress } = await run({ userCount: PROGRESS_LOG_INTERVAL - 1 });

    expect(progress).toHaveLength(0);
  });

  it('emits one line per interval and never repeats a stride', async () => {
    const userCount = PROGRESS_LOG_INTERVAL * 2 + 10;
    const { progress } = await run({ userCount });

    // Two strides crossed, each exactly once, despite five workers sharing the counter.
    expect(progress).toHaveLength(2);
    expect(progress[0]).toContain(`Inspected ${PROGRESS_LOG_INTERVAL} of ${userCount} users`);
    expect(progress[1]).toContain(`Inspected ${PROGRESS_LOG_INTERVAL * 2} of ${userCount} users`);
    expect(new Set(progress).size).toBe(progress.length);
  });

  it('reports running outcome counters, lagging the claim count by at most the pool size', async () => {
    const { progress } = await run({ userCount: PROGRESS_LOG_INTERVAL });

    expect(progress).toHaveLength(1);
    expect(progress[0]).toContain('0 failed');
    expect(progress[0]).toContain('0 denied');

    // The counter increments when a worker *claims* a user, while `usersSucceeded` only moves
    // once that user's call resolves — so a healthy run reads slightly behind, by no more than
    // the number of calls in flight. Asserting the bound keeps the line honest without
    // pretending the snapshot is atomic.
    const read = Number(progress[0].match(/\((\d+) read/)?.[1]);
    expect(read).toBeGreaterThanOrEqual(PROGRESS_LOG_INTERVAL - TOKENS_CONCURRENCY);
    expect(read).toBeLessThanOrEqual(PROGRESS_LOG_INTERVAL);
  });

  it('does not drown the denial abort, which must stay findable in the log', async () => {
    const { result, logs } = await run({
      userCount: PROGRESS_LOG_INTERVAL * 2,
      fetchTokens: async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
        throw deniedError();
      },
    });

    expect(result.globalDenial).toBe(true);
    expect(
      logs.some((line) => line.includes(`${CONSECUTIVE_DENIAL_LIMIT} consecutive denials`)),
    ).toBe(true);
    // Aborting well inside the first stride means no progress line was ever due.
    expect(logs.filter((line) => line.startsWith('Inspected '))).toHaveLength(0);
  });
});
