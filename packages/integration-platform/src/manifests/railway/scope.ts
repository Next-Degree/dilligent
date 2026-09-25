/**
 * Shared scope resolution for the Railway checks.
 *
 * Every check first answers the same questions: which workspaces can this
 * token read, and did any read fail or stop short. Answering them here keeps
 * the failure wording identical across checks, and makes sure a read that
 * went wrong is always reported rather than read as "nothing to check".
 */

import type { CheckContext } from '../../types';
import { remediationForReadFailure, toHttpReadFailure } from '../http-read-failure';
import {
  ENVIRONMENTS_PER_PROJECT,
  INSTANCES_PER_ENVIRONMENT,
  fetchRailwayWorkspace,
  listRailwayProjects,
  listRailwayWorkspaces,
  type InstanceSelection,
  type RailwayProjectListing,
} from './client';
import type {
  RailwayEnvironment,
  RailwayProject,
  RailwayServiceInstance,
  RailwayWorkspace,
  RailwayWorkspaceMember,
  RailwayWorkspaceRef,
} from './types';

const TOKEN_REMEDIATION =
  'Confirm the Railway token is valid and has not been revoked, then re-run the check. Use an account or workspace token; project tokens cannot read workspace data.';

/** Report a failed read, telling a permissions problem apart from a transient one. */
function failRead(
  ctx: CheckContext,
  {
    error,
    fallback,
    evidence,
    ...finding
  }: {
    error: unknown;
    title: string;
    description: string;
    resourceType: string;
    resourceId: string;
    fallback: string;
    evidence: Record<string, unknown>;
  },
): void {
  const failure = toHttpReadFailure(error);
  ctx.fail({
    ...finding,
    description: `${finding.description}: ${failure.error}`,
    severity: 'high',
    remediation: remediationForReadFailure(failure, fallback),
    evidence: { ...evidence, error: failure.error, denied: failure.denied },
  });
}

export async function resolveRailwayScope(
  ctx: CheckContext,
): Promise<{ workspaces: RailwayWorkspaceRef[]; checkedAt: string } | null> {
  const checkedAt = new Date().toISOString();

  let workspaces: RailwayWorkspaceRef[];
  try {
    workspaces = await listRailwayWorkspaces(ctx);
  } catch (error) {
    failRead(ctx, {
      error,
      title: 'Failed to list Railway workspaces',
      description: 'Could not determine which Railway workspaces this token covers',
      resourceType: 'railway',
      resourceId: 'workspaces',
      fallback: TOKEN_REMEDIATION,
      evidence: { checkedAt },
    });
    return null;
  }

  if (workspaces.length === 0) {
    ctx.fail({
      title: 'No Railway workspace found',
      description: 'This token resolves to no Railway workspace, so there is nothing to evidence.',
      resourceType: 'railway',
      resourceId: 'workspaces',
      severity: 'medium',
      remediation:
        'Create a workspace token (Account Settings > Tokens, then pick the workspace) and reconnect Railway.',
      evidence: { checkedAt },
    });
    return null;
  }

  ctx.log(`Railway scope resolved: ${workspaces.length} workspace(s)`);
  return { workspaces, checkedAt };
}

/** The workspace with its members, or null after reporting why it could not be read. */
export async function loadWorkspace(
  ctx: CheckContext,
  { workspace, checkedAt }: { workspace: RailwayWorkspaceRef; checkedAt: string },
): Promise<RailwayWorkspace | null> {
  try {
    return await fetchRailwayWorkspace(ctx, workspace.id);
  } catch (error) {
    failRead(ctx, {
      error,
      title: `Could not read Railway workspace ${workspace.name}`,
      description: 'Reading the workspace and its members failed',
      resourceType: 'railway_workspace',
      resourceId: workspace.id,
      fallback:
        'Member details are only visible to workspace admins. Create the token from an admin account and re-run the check.',
      evidence: { workspaceId: workspace.id, checkedAt },
    });
    return null;
  }
}

export const memberLabel = (member: RailwayWorkspaceMember) =>
  member.email || member.name || member.id;

/** Identity fields every per-member result repeats, so evidence rows are comparable. */
export const memberEvidence = (member: RailwayWorkspaceMember, workspace: RailwayWorkspace) => ({
  verification: 'api-verified',
  workspaceId: workspace.id,
  workspaceName: workspace.name,
  memberId: member.id,
  email: member.email,
  role: member.role,
});

/** One service running in one environment, with the context a result needs. */
export interface ScopedInstance {
  workspace: RailwayWorkspaceRef;
  project: RailwayProject;
  environment: RailwayEnvironment;
  instance: RailwayServiceInstance;
}

/**
 * Every service instance in the workspace, with only the `selection` fields
 * read. Any listing that stopped short is reported as a coverage finding, so
 * a cap never reads as "everything passed".
 */
export async function loadInstances(
  ctx: CheckContext,
  {
    workspace,
    checkedAt,
    selection,
  }: { workspace: RailwayWorkspaceRef; checkedAt: string; selection: InstanceSelection },
): Promise<{ projects: RailwayProject[]; instances: ScopedInstance[] } | null> {
  let listing: RailwayProjectListing;
  try {
    listing = await listRailwayProjects(ctx, { workspaceId: workspace.id, selection });
  } catch (error) {
    failRead(ctx, {
      error,
      title: `Could not list projects in Railway workspace ${workspace.name}`,
      description: "Reading the workspace's projects failed",
      resourceType: 'railway_workspace',
      resourceId: workspace.id,
      fallback: TOKEN_REMEDIATION,
      evidence: { workspaceId: workspace.id, checkedAt },
    });
    return null;
  }

  const truncated: string[] = [];
  if (listing.truncated) truncated.push(`workspace ${workspace.name}: project list`);

  const instances: ScopedInstance[] = [];
  for (const project of listing.projects) {
    if (project.environments.pageInfo.hasNextPage) {
      truncated.push(`project ${project.name}: more than ${ENVIRONMENTS_PER_PROJECT} environments`);
    }
    for (const { node: environment } of project.environments.edges) {
      if (environment.serviceInstances.pageInfo.hasNextPage) {
        truncated.push(
          `project ${project.name} / ${environment.name}: more than ${INSTANCES_PER_ENVIRONMENT} services`,
        );
      }
      for (const { node: instance } of environment.serviceInstances.edges) {
        instances.push({ workspace, project, environment, instance });
      }
    }
  }

  if (truncated.length > 0) {
    ctx.fail({
      title: `Railway coverage incomplete in ${workspace.name}`,
      description: `Some resources were not read in this run: ${truncated.join('; ')}.`,
      resourceType: 'railway_workspace',
      resourceId: `${workspace.id}:coverage`,
      severity: 'low',
      remediation:
        'Split very large projects or remove stale environments so every service is covered by a run.',
      evidence: { workspaceId: workspace.id, truncated, checkedAt },
    });
  }

  return { projects: listing.projects, instances };
}

/** Identity fields every per-service result repeats, so evidence rows are comparable. */
export const instanceEvidence = ({
  workspace,
  project,
  environment,
  instance,
}: ScopedInstance) => ({
  workspaceId: workspace.id,
  workspaceName: workspace.name,
  projectId: project.id,
  projectName: project.name,
  environmentId: environment.id,
  environmentName: environment.name,
  ephemeralEnvironment: environment.isEphemeral,
  serviceId: instance.serviceId,
  serviceName: instance.serviceName,
});
