/**
 * Shared Trigger.dev API helpers.
 *
 * Every check reads some mix of organizations, projects, environments and members, so
 * the requests, paging and error translation live here rather than per check.
 */

import type { CheckContext } from '../../types';
import type {
  TriggerCurrentWorkerResponse,
  TriggerEnvironment,
  TriggerMembersResponse,
  TriggerOrganization,
  TriggerProject,
  TriggerRun,
  TriggerRunsPage,
} from './types';

/** Trigger.dev Cloud. Self-hosted instances serve the same API from their own origin. */
export const TRIGGER_API_URL = 'https://api.trigger.dev';

export const TRIGGER_DASHBOARD_URL = 'https://cloud.trigger.dev';

/** Where a customer creates the Personal Access Token this integration needs. */
export const TRIGGER_TOKENS_URL = `${TRIGGER_DASHBOARD_URL}/account/tokens`;

export const teamSettingsUrl = (organization: TriggerOrganization): string =>
  `${TRIGGER_DASHBOARD_URL}/orgs/${organization.slug}/settings/team`;

export const projectUrl = (project: TriggerProject): string =>
  `${TRIGGER_DASHBOARD_URL}/orgs/${project.organization.slug}/projects/${project.slug}`;

const PAT_PREFIX = 'tr_pat_';

/** Runs list page size; 100 is the API's maximum. */
const RUNS_PAGE_SIZE = 100;

/**
 * Runaway guard for the runs list — 10 pages is 1,000 runs, plenty to measure a failure
 * rate. A busier environment is sampled (newest first) and the result says so.
 */
const MAX_RUN_PAGES = 10;

function errorStatus(error: unknown): number | undefined {
  return (error as { status?: number } | null)?.status;
}

/**
 * The stored token, or null when it is not a Personal Access Token.
 *
 * Environment secret keys (`tr_prod_...`, `tr_stg_...`) authenticate against one
 * environment and are refused by every organization-level endpoint, so running the
 * checks with one would report a wall of 401s instead of the actual problem.
 */
export function readPersonalAccessToken(ctx: CheckContext): string | null {
  const raw = ctx.credentials.api_key;
  const token = (Array.isArray(raw) ? raw[0] : raw)?.trim() ?? '';
  return token.startsWith(PAT_PREFIX) ? token : null;
}

/** Record the wrong-token finding once; returns false so callers can `return` on it. */
export function requirePersonalAccessToken(ctx: CheckContext): boolean {
  if (readPersonalAccessToken(ctx)) return true;

  ctx.fail({
    title: 'Trigger.dev connection needs a Personal Access Token',
    description:
      'The stored credential is not a Personal Access Token (tr_pat_...). Environment secret keys only reach a single environment and cannot read organization members or projects, so none of the Trigger.dev checks can run.',
    resourceType: 'trigger_dev_connection',
    resourceId: 'credentials',
    severity: 'medium',
    remediation: `Create a Personal Access Token at ${TRIGGER_TOKENS_URL} from an account with the Admin role and reconnect the integration.`,
    evidence: { checkedAt: new Date().toISOString() },
  });
  return false;
}

export async function listOrganizations(ctx: CheckContext): Promise<TriggerOrganization[]> {
  return (await ctx.fetch<TriggerOrganization[]>('/api/v1/orgs')) ?? [];
}

export async function listProjects(ctx: CheckContext): Promise<TriggerProject[]> {
  return (await ctx.fetch<TriggerProject[]>('/api/v1/projects')) ?? [];
}

export async function listEnvironments(
  ctx: CheckContext,
  projectRef: string,
): Promise<TriggerEnvironment[]> {
  return (
    (await ctx.fetch<TriggerEnvironment[]>(
      `/api/v1/projects/${encodeURIComponent(projectRef)}/environments`,
    )) ?? []
  );
}

export async function getMembers(
  ctx: CheckContext,
  organizationId: string,
): Promise<TriggerMembersResponse> {
  const response = await ctx.fetch<TriggerMembersResponse>(
    `/api/v1/orgs/${encodeURIComponent(organizationId)}/members`,
  );
  return { members: response?.members ?? [], invites: response?.invites ?? [] };
}

/**
 * The version currently serving production, or null when nothing has been deployed.
 * The API answers 404 for "no current worker", which is a finding, not an error.
 */
export async function getCurrentProductionWorker(
  ctx: CheckContext,
  projectRef: string,
): Promise<TriggerCurrentWorkerResponse | null> {
  try {
    return await ctx.fetch<TriggerCurrentWorkerResponse>(
      `/api/v1/projects/${encodeURIComponent(projectRef)}/prod/workers/current`,
    );
  } catch (error) {
    if (errorStatus(error) === 404) return null;
    throw error;
  }
}

/** Newest-first runs for one environment within a window like `7d`. */
export async function listRecentRuns(
  ctx: CheckContext,
  options: { projectRef: string; environmentSlug: string; period: string },
): Promise<{ runs: TriggerRun[]; truncated: boolean }> {
  const runs: TriggerRun[] = [];
  let cursor: string | undefined;

  for (let page = 0; page < MAX_RUN_PAGES; page++) {
    const params: Record<string, string> = {
      'filter[env]': options.environmentSlug,
      'filter[createdAt][period]': options.period,
      'page[size]': String(RUNS_PAGE_SIZE),
    };
    if (cursor) params['page[after]'] = cursor;

    const response = await ctx.fetch<TriggerRunsPage>(
      `/api/v1/projects/${encodeURIComponent(options.projectRef)}/runs`,
      { params },
    );
    const data = response?.data ?? [];
    runs.push(...data);

    cursor = response?.pagination?.next;
    if (!cursor || data.length === 0) return { runs, truncated: false };
  }

  return { runs, truncated: true };
}
