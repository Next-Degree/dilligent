import type { z } from 'zod';
import { getApiUrl } from './env';

const TRUST_ACCESS_PREFIX = '/v1/trust-access';
const DEFAULT_REVALIDATE_SECONDS = 60;

export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; message: string };

type FetchParams<S extends z.ZodTypeAny> = {
  path: string;
  schema: S;
  /** ISR window in seconds. Pass 0 for uncached (token gated) requests. */
  revalidate?: number;
};

/** Server side GET against the public trust-access API, validated by zod. */
export async function fetchTrust<S extends z.ZodTypeAny>(
  params: FetchParams<S>,
): Promise<ApiResult<z.infer<S>>> {
  const { path, schema, revalidate = DEFAULT_REVALIDATE_SECONDS } = params;
  try {
    const response = await fetch(`${getApiUrl()}${TRUST_ACCESS_PREFIX}${path}`, {
      headers: { Accept: 'application/json' },
      ...(revalidate === 0 ? { cache: 'no-store' as const } : { next: { revalidate } }),
    });

    if (!response.ok) {
      return { ok: false, status: response.status, message: response.statusText };
    }

    const parsed = schema.safeParse(await response.json());
    if (!parsed.success) {
      return { ok: false, status: 502, message: 'Unexpected API response' };
    }
    return { ok: true, data: parsed.data };
  } catch {
    return { ok: false, status: 503, message: 'API unreachable' };
  }
}

/** Returns the data or the given fallback when the request failed. */
export function orFallback<T>(result: ApiResult<T>, fallback: T): T {
  return result.ok ? result.data : fallback;
}
