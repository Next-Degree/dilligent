/**
 * Neon API client helpers.
 *
 * Paths are relative on purpose: the manifest's baseUrl carries the
 * `/api/v2/` prefix, and a leading slash would drop it (`new URL` treats an
 * absolute path as replacing the base path).
 */

import type { CheckContext } from '../../types';
import type {
  NeonBackupScheduleResponse,
  NeonBranch,
  NeonBranchesResponse,
  NeonBranchStorageNotEnabled,
  NeonBucket,
  NeonBucketsResponse,
  NeonEndpoint,
  NeonEndpointsResponse,
  NeonOrganization,
  NeonOrganizationMember,
  NeonOrganizationMembersResponse,
  NeonOrganizationsResponse,
  NeonProject,
  NeonProjectResponse,
  NeonProjectsResponse,
} from './types';

/**
 * Neon caps the projects `limit` at 400; 100 keeps responses small without many
 * round trips.
 *
 * Note the two paginated endpoints name their next-page token differently, and
 * both spellings are correct per the API reference: `/projects` returns
 * `pagination.cursor`, `/organizations/{id}/members` returns `pagination.next`.
 * Both are sent back as the `cursor` query param. Do not "fix" the mismatch.
 */
const PROJECTS_PAGE_SIZE = 100;
const MEMBERS_PAGE_SIZE = 100;
const MAX_PAGES = 20;

/**
 * The slice of a context these listings need.
 *
 * Narrower than `CheckContext` on purpose: the Configure sheet's option picker
 * runs with a `VariableFetchContext`, whose `fetch` takes a path and nothing
 * else. Typing to that lets the picker and the checks share one definition of
 * "every project this key can reach" instead of keeping two copies of the
 * paging rules in step — and query params fold into the path either way, since
 * the runtime merges a path's own search params.
 */
export interface NeonFetcher {
  fetch: <T = unknown>(path: string) => Promise<T>;
  warn?: (message: string) => void;
}

const status = (error: unknown): number | undefined =>
  (error as { status?: number } | null)?.status;

/** An API key scoped to one organization cannot read user-level routes. */
const isScopeError = (error: unknown): boolean => {
  const code = status(error);
  return code === 401 || code === 403 || code === 404;
};

const segment = (value: string): string => encodeURIComponent(value);

/**
 * Organizations this key can see. An organization-scoped key has no user
 * behind it, so `/users/me/...` answers 401/403 — that is a key shape, not a
 * failure, and resolves to "no organizations to enumerate".
 */
export async function listNeonOrganizations(ctx: NeonFetcher): Promise<NeonOrganization[]> {
  try {
    const response = await ctx.fetch<NeonOrganizationsResponse>('users/me/organizations');
    return response.organizations ?? [];
  } catch (error) {
    if (isScopeError(error)) {
      ctx.warn?.('Could not list Neon organizations; treating the key as organization-scoped');
      return [];
    }
    throw error;
  }
}

/**
 * Every project the key can reach, plus the ids Neon admitted it could not
 * serialize. A personal key only sees organization projects when `org_id` is
 * passed, so each organization is paged separately and the un-scoped listing
 * is added for personal projects; ids are deduped across both.
 */
export async function fetchAllNeonProjects(
  ctx: NeonFetcher,
  organizations: NeonOrganization[],
): Promise<{ projects: NeonProject[]; unavailableProjectIds: string[] }> {
  const byId = new Map<string, NeonProject>();
  const unavailable = new Set<string>();

  const scopes: (string | undefined)[] = [undefined, ...organizations.map((org) => org.id)];

  for (const orgId of scopes) {
    let cursor: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const params = new URLSearchParams({ limit: String(PROJECTS_PAGE_SIZE) });
      if (orgId) params.set('org_id', orgId);
      if (cursor) params.set('cursor', cursor);

      const response = await ctx.fetch<NeonProjectsResponse>(`projects?${params.toString()}`);
      const projects = response.projects ?? [];
      for (const project of projects) {
        if (!byId.has(project.id)) byId.set(project.id, project);
      }
      for (const id of response.unavailable_project_ids ?? []) unavailable.add(id);

      const next = response.pagination?.cursor;
      if (projects.length < PROJECTS_PAGE_SIZE || !next || next === cursor) break;
      cursor = next;
    }
  }

  return {
    projects: Array.from(byId.values()),
    unavailableProjectIds: Array.from(unavailable),
  };
}

/**
 * The full project record.
 *
 * `GET /projects` already carries `settings`, `proxy_host` and
 * `history_retention_seconds`, so this is not needed for those. What only the
 * detail endpoint returns is `owner` (and with it `subscription_type`), `slug`
 * and the consumption figures — plus it is the authoritative record for
 * `settings.audit_log_level`, which is absent from the list endpoint's
 * documented shape.
 */
export async function fetchNeonProject(
  ctx: CheckContext,
  projectId: string,
): Promise<NeonProject | null> {
  const response = await ctx.fetch<NeonProjectResponse>(`projects/${segment(projectId)}`);
  return response.project ?? null;
}

export async function listNeonBranches(
  ctx: CheckContext,
  projectId: string,
): Promise<NeonBranch[]> {
  const response = await ctx.fetch<NeonBranchesResponse>(`projects/${segment(projectId)}/branches`);
  return response.branches ?? [];
}

/** `primary` is the deprecated spelling of `default`; the API returns both. */
const isDefaultBranch = (branch: NeonBranch): boolean =>
  branch.default === true || branch.primary === true;

/**
 * The project's default branch, or `undefined` when none is flagged.
 *
 * Deliberately does NOT fall back to `branches[0]`. Both `default` and
 * `primary` can be false on every branch a page returns, and a check that
 * silently substituted an arbitrary branch would go on to assert "the default
 * branch of X" about it — passing a project whose production branch has no
 * backups because some dev branch happened to sort first. Callers must handle
 * `undefined` and say so.
 */
export function pickDefaultBranch(branches: NeonBranch[]): NeonBranch | undefined {
  return branches.find(isDefaultBranch);
}

export async function listNeonEndpoints(
  ctx: CheckContext,
  projectId: string,
): Promise<NeonEndpoint[]> {
  const response = await ctx.fetch<NeonEndpointsResponse>(
    `projects/${segment(projectId)}/endpoints`,
  );
  return response.endpoints ?? [];
}

export async function fetchNeonBackupSchedule(
  ctx: CheckContext,
  projectId: string,
  branchId: string,
): Promise<NeonBackupScheduleResponse> {
  return ctx.fetch<NeonBackupScheduleResponse>(
    `projects/${segment(projectId)}/branches/${segment(branchId)}/backup_schedule`,
  );
}

export async function listNeonOrganizationMembers(
  ctx: CheckContext,
  orgId: string,
): Promise<NeonOrganizationMember[]> {
  const members: NeonOrganizationMember[] = [];
  let cursor: string | undefined;

  for (let page = 0; page < MAX_PAGES; page++) {
    const params: Record<string, string> = {
      limit: String(MEMBERS_PAGE_SIZE),
      ...(cursor ? { cursor } : {}),
    };
    const response = await ctx.fetch<NeonOrganizationMembersResponse>(
      `organizations/${segment(orgId)}/members`,
      { params },
    );
    const pageMembers = response.members ?? [];
    members.push(...pageMembers);

    const next = response.pagination?.next;
    if (pageMembers.length < MEMBERS_PAGE_SIZE || !next || next === cursor) break;
    cursor = next;
  }

  return members;
}

/**
 * Human-readable plan for a project, when the detail endpoint supplied it.
 * `GET /projects` omits `owner` entirely, so this is null for a list record.
 */
export const projectPlan = (project: NeonProject): string | null =>
  project.owner?.subscription_type ?? null;

/**
 * Pull the machine-readable `reason` out of a 404 body.
 *
 * The runtime throws a plain `Error` carrying only `.status` and folds the
 * response body into the message (`HTTP 404: Not Found - {...}`), so the
 * structured field has to be parsed back out. Returns null on anything
 * unparseable — a truncated body must not read as a known reason.
 */
function reasonFromError(error: unknown): string | null {
  if (!(error instanceof Error)) return null;
  const start = error.message.indexOf('{');
  if (start === -1) return null;
  try {
    const body = JSON.parse(error.message.slice(start)) as NeonBranchStorageNotEnabled;
    return typeof body.reason === 'string' ? body.reason : null;
  } catch {
    return null;
  }
}

/**
 * Whether branchable object storage is usable on a branch.
 *
 * `reason: null` means Neon answered 404 but the body carried no readable
 * reason. That is deliberately distinct from a documented reason: an HTML error
 * page or a changed body shape must not be reported as "the feature is off",
 * which would green-light the control it gates.
 */
export type NeonBranchStorage = { available: true } | { available: false; reason: string | null };

/**
 * Read the object storage state of a branch.
 *
 * A 404 here is an answer, not an error: the body carries a machine-readable
 * `reason`, and three of the four documented ones mean the feature simply is
 * not on for this branch. Only `branch_not_found` implies the caller may have
 * lost access. The 200 body carries no field any check reads, so availability
 * and the reason are all that is returned.
 */
export async function fetchNeonBranchStorage(
  ctx: CheckContext,
  projectId: string,
  branchId: string,
): Promise<NeonBranchStorage> {
  try {
    await ctx.fetch<unknown>(
      `projects/${segment(projectId)}/branches/${segment(branchId)}/storage`,
    );
    return { available: true };
  } catch (error) {
    if (status(error) !== 404) throw error;
    return { available: false, reason: reasonFromError(error) };
  }
}

/**
 * Every bucket visible on a branch, including those inherited from ancestor
 * branches. The endpoint takes no pagination parameters and returns the whole
 * list in one response, so there is nothing to page and no reason to sample.
 */
export async function listNeonBranchBuckets(
  ctx: CheckContext,
  projectId: string,
  branchId: string,
): Promise<NeonBucket[]> {
  const response = await ctx.fetch<NeonBucketsResponse>(
    `projects/${segment(projectId)}/branches/${segment(branchId)}/buckets`,
  );
  return response.buckets ?? [];
}
