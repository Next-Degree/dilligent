import { toHttpReadFailure } from '../http-read-failure';
import type { GoogleWorkspaceToken, GoogleWorkspaceTokensResponse, GoogleWorkspaceUser } from './types';

/** One API call per user, so concurrency is the whole cost model. */
export const TOKENS_CONCURRENCY = 5;

/**
 * Consecutive denials before the run gives up. A tenant that has not consented to the
 * tokens scope denies *every* user, so without this a 5,000-user directory burns 5,000
 * calls of quota to learn one fact. Consecutive rather than total, so a handful of
 * scattered per-user denials does not abort an otherwise healthy run.
 */
export const CONSECUTIVE_DENIAL_LIMIT = 5;

/**
 * Users between progress lines. The fan-out is one API call per user at concurrency 5, so a
 * large tenant spends most of the run here; without a heartbeat the trace is silent for
 * minutes and a slow run is indistinguishable from a hung one.
 */
export const PROGRESS_LOG_INTERVAL = 250;

/**
 * Upper bound on users inspected in one run. Beyond this the run reports
 * `complete: false` rather than running past its time budget — an incomplete marker is
 * safe (reconciliation declines to withdraw), a timeout mid-write is not.
 */
export const MAX_USERS_PER_RUN = 3000;

export interface TokensFanOutUser {
  userKey: string;
  email: string;
}

export interface TokensFanOutResult {
  /** Grants keyed by user, in the order users were inspected. */
  grantsByUser: Map<string, { user: TokensFanOutUser; tokens: GoogleWorkspaceToken[] }>;
  usersInspected: number;
  usersSucceeded: number;
  usersFailed: number;
  usersDenied: number;
  /** True when the run stopped early on consecutive denials — a global consent problem. */
  globalDenial: boolean;
  /** True when the user ceiling truncated the run. */
  ceilingReached: boolean;
  /** First denial message seen, for remediation copy. Never contains an email. */
  denialSample?: string;
}

interface FanOutDeps {
  fetchTokens: (userKey: string) => Promise<GoogleWorkspaceTokensResponse>;
  log: (message: string) => void;
}

/**
 * Fetch third-party OAuth grants for each user through a bounded worker pool.
 *
 * Deliberately has no retry of its own: the check context already retries 429/5xx/401,
 * and a second layer would multiply a throttled tenant's backoff into the time budget.
 *
 * Never throws for a single user — one unreadable user is a counter, not a dead run.
 */
export async function fetchTokensForUsers({
  users,
  deps,
}: {
  users: GoogleWorkspaceUser[];
  deps: FanOutDeps;
}): Promise<TokensFanOutResult> {
  const targets: TokensFanOutUser[] = users.map((user) => ({
    userKey: user.id,
    email: user.primaryEmail,
  }));

  const ceilingReached = targets.length > MAX_USERS_PER_RUN;
  const inScope = ceilingReached ? targets.slice(0, MAX_USERS_PER_RUN) : targets;

  if (ceilingReached) {
    deps.log(
      `User ceiling reached: inspecting ${MAX_USERS_PER_RUN} of ${targets.length} users; ` +
        'run will report incomplete',
    );
  }

  const result: TokensFanOutResult = {
    grantsByUser: new Map(),
    usersInspected: 0,
    usersSucceeded: 0,
    usersFailed: 0,
    usersDenied: 0,
    globalDenial: false,
    ceilingReached,
  };

  // Consecutive denials are tracked across workers: a consent failure denies every user
  // regardless of which worker picks it up.
  let consecutiveDenials = 0;
  let cursor = 0;
  let stopped = false;

  const worker = async (): Promise<void> => {
    while (!stopped) {
      const index = cursor++;
      if (index >= inScope.length) {
        return;
      }

      const target = inScope[index];
      result.usersInspected++;

      // `++` is not interleaved by the event loop, so each stride is crossed exactly once
      // even though five workers share the counter.
      if (result.usersInspected % PROGRESS_LOG_INTERVAL === 0) {
        deps.log(
          `Inspected ${result.usersInspected} of ${inScope.length} users ` +
            `(${result.usersSucceeded} read, ${result.usersFailed} failed, ` +
            `${result.usersDenied} denied)`,
        );
      }

      try {
        const response = await deps.fetchTokens(target.userKey);
        consecutiveDenials = 0;
        result.usersSucceeded++;

        const tokens = response.items ?? [];
        if (tokens.length > 0) {
          result.grantsByUser.set(target.userKey, { user: target, tokens });
        }
      } catch (error) {
        const failure = toHttpReadFailure(error);

        if (failure.denied) {
          result.usersDenied++;
          consecutiveDenials++;
          result.denialSample ??= failure.error;

          if (consecutiveDenials >= CONSECUTIVE_DENIAL_LIMIT) {
            result.globalDenial = true;
            stopped = true;
            deps.log(
              `Stopping after ${CONSECUTIVE_DENIAL_LIMIT} consecutive denials — ` +
                'the connection most likely lacks the required scope',
            );
            return;
          }
          continue;
        }

        consecutiveDenials = 0;
        result.usersFailed++;
      }
    }
  };

  const poolSize = Math.min(TOKENS_CONCURRENCY, inScope.length);
  await Promise.all(Array.from({ length: poolSize }, () => worker()));

  return result;
}
