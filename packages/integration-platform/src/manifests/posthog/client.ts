/**
 * Shared PostHog API helpers.
 *
 * Both checks read the same two collections (organizations and their members), so the
 * paging and error-translation live here rather than being duplicated per check.
 */

import type { CheckContext } from '../../types';
import {
  POSTHOG_LEVEL_ADMIN,
  POSTHOG_LEVEL_OWNER,
  type PostHogOrganization,
  type PostHogOrganizationSummary,
  type PostHogPaginated,
} from './types';

/**
 * PostHog Cloud US — the only region this integration supports. Requests go here via the
 * manifest's `baseUrl`; the constant is exported so remediation text can link to the same
 * instance the checks actually read.
 */
export const POSTHOG_HOST = 'https://us.posthog.com';

/** PostHog's limit/offset page size. 100 is its documented maximum for these endpoints. */
const PAGE_SIZE = 100;

/**
 * Runaway guard — 50 pages is 5,000 records, well beyond any real PostHog organization.
 * Hitting it means paging is not advancing, so the caller reports truncation rather than
 * presenting a partial roster as the whole organization.
 */
const MAX_PAGES = 50;

/**
 * Walk every page of a PostHog limit/offset collection.
 *
 * Stops on the first short page as well as on a missing `next`, so a backend that omits
 * the envelope's cursor can never spin the loop to MAX_PAGES.
 */
export async function fetchAllResults<T>(
  ctx: CheckContext,
  options: { path: string; params?: Record<string, string> },
): Promise<{ items: T[]; truncated: boolean }> {
  const items: T[] = [];
  let truncated = false;

  for (let page = 0; page < MAX_PAGES; page++) {
    const response = await ctx.fetch<PostHogPaginated<T>>(options.path, {
      params: {
        ...options.params,
        limit: String(PAGE_SIZE),
        offset: String(page * PAGE_SIZE),
      },
    });

    const results = response?.results ?? [];
    items.push(...results);

    if (!response?.next || results.length < PAGE_SIZE) break;
    if (page === MAX_PAGES - 1) truncated = true;
  }

  return { items, truncated };
}

/**
 * Every organization the personal API key can see.
 *
 * A key scoped to a single organization (or one missing `organization:read`) cannot list
 * them, so the `@current` alias is the fallback — it resolves to the key owner's current
 * organization and keeps the checks working on the narrowest possible key.
 */
export async function listOrganizations(ctx: CheckContext): Promise<PostHogOrganizationSummary[]> {
  try {
    const { items } = await fetchAllResults<PostHogOrganizationSummary>(ctx, {
      path: '/api/organizations/',
    });
    if (items.length > 0) return items;
    ctx.warn('PostHog returned no organizations for this key; falling back to @current');
  } catch (error) {
    ctx.warn(
      `Could not list PostHog organizations (${errorMessage(error)}); falling back to @current`,
    );
  }

  return [await ctx.fetch<PostHogOrganization>('/api/organizations/@current/')];
}

/**
 * Organization detail (adds `enforce_2fa` / `enforce_verified_domains`, which the list
 * endpoint omits). Returns null instead of throwing: a key without `organization:read`
 * can still read members, and losing the org-level settings must not fail the whole run.
 */
export async function getOrganizationDetail(
  ctx: CheckContext,
  organizationId: string,
): Promise<PostHogOrganization | null> {
  try {
    return await ctx.fetch<PostHogOrganization>(`/api/organizations/${organizationId}/`);
  } catch (error) {
    ctx.warn(
      `Could not read PostHog organization ${organizationId} settings (${errorMessage(error)})`,
    );
    return null;
  }
}

/** Most-privileged label wins: owner outranks admin, both outrank member. */
export function describeLevel(level: number | null | undefined): string {
  if (level === POSTHOG_LEVEL_OWNER) return 'Owner';
  if (level === POSTHOG_LEVEL_ADMIN) return 'Admin';
  return 'Member';
}

/** Admins and owners can change org settings and invite people, so their findings escalate. */
export function isPrivilegedLevel(level: number | null | undefined): boolean {
  return typeof level === 'number' && level >= POSTHOG_LEVEL_ADMIN;
}

export function normalizeEmail(email: string | null | undefined): string {
  return String(email ?? '')
    .toLowerCase()
    .trim();
}

/**
 * Deliberately permissive: this rejects the shapes PostHog should never store (blank,
 * spaces, no `@`, no dot in the domain) without trying to re-implement RFC 5322, which
 * would reject valid addresses and turn a compliance check into a false-positive engine.
 */
export function isValidEmailFormat(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function emailDomain(email: string): string {
  const at = email.lastIndexOf('@');
  return at === -1 ? '' : email.slice(at + 1);
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Turns a raw transport error into something a customer can act on. The runtime throws
 * `HTTP <status>: ...` with the status attached, which is how PostHog reports a revoked
 * key (401) or a key missing the scopes these checks need (403).
 */
export function friendlyError(error: unknown): Error {
  const status = (error as { status?: number } | null)?.status;
  const message = errorMessage(error);

  if (status === 401) {
    return new Error(
      `PostHog rejected the API key (401). Create a new personal API key under ` +
        `${POSTHOG_HOST}/settings/user-api-keys and reconnect the integration.`,
    );
  }

  if (status === 403) {
    return new Error(
      `PostHog denied access (403). The personal API key needs the "organization:read" and ` +
        `"organization_member:read" scopes — edit the key under ${POSTHOG_HOST}/settings/user-api-keys ` +
        `and reconnect the integration.`,
    );
  }

  return error instanceof Error ? error : new Error(message);
}
