/**
 * Upstash API client helpers.
 *
 * Paths are relative on purpose: the manifest's baseUrl carries the `/v2/`
 * prefix, and a leading slash would drop it (`new URL` treats an absolute
 * path as replacing the base path).
 */

import type { UpstashDatabase } from './types';

/**
 * The slice of a context this listing needs. Narrower than `CheckContext` on
 * purpose: the Configure sheet's option picker runs with a
 * `VariableFetchContext`, whose `fetch` takes a path and nothing else. Typing
 * to that lets the picker and the checks share one definition of "every
 * database this key can reach" instead of keeping two copies in step.
 */
export interface UpstashFetcher {
  fetch: <T = unknown>(path: string) => Promise<T>;
}

/**
 * Every Redis database the key can see. Upstash returns the full list in one
 * response (no pagination on this endpoint), so there is nothing to page.
 */
export async function listUpstashDatabases(ctx: UpstashFetcher): Promise<UpstashDatabase[]> {
  const databases = await ctx.fetch<UpstashDatabase[]>('redis/databases');
  return databases ?? [];
}
