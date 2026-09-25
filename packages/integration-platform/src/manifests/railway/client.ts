/**
 * Railway GraphQL client helpers.
 *
 * Railway's API is GraphQL-only, served at `/graphql/v2` (the manifest's
 * `graphqlEndpoint`). `ctx.graphql` throws on an `errors[]` array returned
 * with HTTP 200, which is how Railway reports an authorization denial ("Not
 * Authorized"), so a denied read can never pass as an empty result.
 *
 * Every query here was validated against the introspected public schema. The
 * rate limit is low (100 requests/hour on the Free plan), so project data is
 * read in one nested query per page rather than one call per service, and
 * each check selects only the service fields it reads.
 */

import type { CheckContext } from '../../types';
import type {
  RailwayConnection,
  RailwayProject,
  RailwayWorkspace,
  RailwayWorkspaceRef,
} from './types';

const PROJECTS_PAGE_SIZE = 20;
const MAX_PROJECT_PAGES = 10;
/** Nested page sizes. A connection that reports more is flagged as truncated. */
export const ENVIRONMENTS_PER_PROJECT = 25;
export const INSTANCES_PER_ENVIRONMENT = 50;

type RailwayGraphql = Pick<CheckContext, 'graphql'>;

const TOKEN_WORKSPACES_QUERY = `query RailwayTokenWorkspaces {
  apiToken { workspaces { id name } }
}`;

const USER_WORKSPACES_QUERY = `query RailwayUserWorkspaces {
  me { workspaces { id name } }
}`;

const WORKSPACE_MEMBERS_QUERY = `query RailwayWorkspaceMembers($workspaceId: String!) {
  workspace(workspaceId: $workspaceId) {
    id
    name
    has2FAEnforcement
    members { id email name role twoFactorAuthEnabled }
  }
}`;

/** The service fields each check reads, so neither pays for the other's. */
const INSTANCE_FIELDS = {
  deployments: `cronSchedule
    latestDeployment { id status createdAt }
    activeDeployments { id status createdAt }`,
  domains: `domains {
    customDomains {
      id
      domain
      status {
        certificateStatus
        certificateErrorMessage
        cdnProvider
        verified
        certificates { domainNames expiresAt issuedAt keyType }
      }
    }
    serviceDomains { id domain }
  }`,
} as const;

export type InstanceSelection = keyof typeof INSTANCE_FIELDS;

export const workspaceProjectsQuery = (
  selection: InstanceSelection,
) => `query RailwayWorkspaceProjects($workspaceId: String!, $after: String) {
  workspace(workspaceId: $workspaceId) {
    projects(first: ${PROJECTS_PAGE_SIZE}, after: $after) {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          id
          name
          primaryEnvironmentId
          environments(first: ${ENVIRONMENTS_PER_PROJECT}) {
            pageInfo { hasNextPage endCursor }
            edges {
              node {
                id
                name
                isEphemeral
                serviceInstances(first: ${INSTANCES_PER_ENVIRONMENT}) {
                  pageInfo { hasNextPage endCursor }
                  edges { node { id serviceId serviceName ${INSTANCE_FIELDS[selection]} } }
                }
              }
            }
          }
        }
      }
    }
  }
}`;

/**
 * Workspaces this token can read.
 *
 * A workspace token cannot query `me` (it has no user behind it), and
 * `apiToken` names exactly the workspaces a token is scoped to, so that is
 * tried first. An account token falls back to the user's own workspace list.
 * When both fail, the first error is the one reported.
 */
export async function listRailwayWorkspaces(ctx: RailwayGraphql): Promise<RailwayWorkspaceRef[]> {
  let firstError: unknown;
  try {
    const data = await ctx.graphql<{ apiToken: { workspaces: RailwayWorkspaceRef[] } }>(
      TOKEN_WORKSPACES_QUERY,
    );
    const workspaces = data.apiToken?.workspaces ?? [];
    if (workspaces.length > 0) return workspaces;
  } catch (error) {
    firstError = error;
  }

  try {
    const data = await ctx.graphql<{ me: { workspaces: RailwayWorkspaceRef[] } }>(
      USER_WORKSPACES_QUERY,
    );
    return data.me?.workspaces ?? [];
  } catch (error) {
    throw firstError ?? error;
  }
}

export async function fetchRailwayWorkspace(
  ctx: RailwayGraphql,
  workspaceId: string,
): Promise<RailwayWorkspace> {
  const data = await ctx.graphql<{ workspace: RailwayWorkspace }>(WORKSPACE_MEMBERS_QUERY, {
    workspaceId,
  });
  return data.workspace;
}

export interface RailwayProjectListing {
  projects: RailwayProject[];
  /** True when the project listing itself stopped at the page cap. */
  truncated: boolean;
}

export async function listRailwayProjects(
  ctx: RailwayGraphql,
  { workspaceId, selection }: { workspaceId: string; selection: InstanceSelection },
): Promise<RailwayProjectListing> {
  const query = workspaceProjectsQuery(selection);
  const projects: RailwayProject[] = [];
  let after: string | null = null;

  for (let page = 0; page < MAX_PROJECT_PAGES; page++) {
    const data: { workspace: { projects: RailwayConnection<RailwayProject> } } = await ctx.graphql(
      query,
      { workspaceId, after },
    );
    const connection = data.workspace.projects;
    projects.push(...connection.edges.map((edge) => edge.node));

    const next = connection.pageInfo.endCursor ?? null;
    if (!connection.pageInfo.hasNextPage || !next || next === after) {
      return { projects, truncated: false };
    }
    after = next;
  }

  return { projects, truncated: true };
}
