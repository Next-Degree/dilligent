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

const status = (error: unknown): number | undefined =>
  (error as { status?: number } | null)?.status;

/** An API key scoped to one organization cannot read user-level routes. */
const isScopeError = (error: unknown): boolean => {
  const code = status(error);
  return code === 401 || code === 403 || code === 404;
};

export const segment = (value: string): string => encodeURIComponent(value);

/**
 * Organizations this key can see. An organization-scoped key has no user
 * behind it, so `/users/me/...` answers 401/403 — that is a key shape, not a
 * failure, and resolves to "no organizations to enumerate".
 */
export async function listNeonOrganizations(ctx: CheckContext): Promise<NeonOrganization[]> {
  try {
    const response = await ctx.fetch<NeonOrganizationsResponse>('users/me/organizations');
    return response.organizations ?? [];
  } catch (error) {
    if (isScopeError(error)) {
      ctx.warn('Could not list Neon organizations; treating the key as organization-scoped');
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
  ctx: CheckContext,
  organizations: NeonOrganization[],
): Promise<{ projects: NeonProject[]; unavailableProjectIds: string[] }> {
  const byId = new Map<string, NeonProject>();
  const unavailable = new Set<string>();

  const scopes: (Record<string, string> | undefined)[] = [
    undefined,
    ...organizations.map((org) => ({ org_id: org.id })),
  ];

  for (const scope of scopes) {
    let cursor: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const params: Record<string, string> = {
        limit: String(PROJECTS_PAGE_SIZE),
        ...(scope ?? {}),
        ...(cursor ? { cursor } : {}),
      };

      const response = await ctx.fetch<NeonProjectsResponse>('projects', { params });
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
