/**
 * Shared project-scope resolution for the Neon checks.
 *
 * Every check answers the same three questions before it can look at
 * anything: which projects can this key see, which of them did the customer
 * scope the automation to, and did any part of that listing come back
 * incomplete. Answering them once here keeps the failure wording identical
 * across checks — and keeps a coverage gap from ever reading as a clean pass.
 */

import type { CheckContext } from '../../types';
import { remediationForReadFailure, toHttpReadFailure } from '../http-read-failure';
import { fetchAllNeonProjects, listNeonOrganizations } from './client';
import type { NeonOrganization, NeonProject } from './types';
import {
  applyNeonProjectFilter,
  parseNeonProjectFilter,
  type NeonProjectFilter,
} from './variables';

/** Per-project checks issue one or more requests each — bound the run and say so. */
export const MAX_PROJECTS_PER_RUN = 50;

export interface NeonScope {
  projects: NeonProject[];
  totalProjectCount: number;
  organizations: NeonOrganization[];
  filter: NeonProjectFilter;
  checkedAt: string;
}

export async function resolveNeonScope(ctx: CheckContext): Promise<NeonScope | null> {
  const checkedAt = new Date().toISOString();

  let organizations: NeonOrganization[] = [];
  let projects: NeonProject[] = [];
  let unavailableProjectIds: string[] = [];

  try {
    organizations = await listNeonOrganizations(ctx);
    const result = await fetchAllNeonProjects(ctx, organizations);
    projects = result.projects;
    unavailableProjectIds = result.unavailableProjectIds;
  } catch (error) {
    const failure = toHttpReadFailure(error);
    ctx.fail({
      title: 'Failed to list Neon projects',
      description: `Could not read the Neon project list: ${failure.error}`,
      resourceType: 'neon',
      resourceId: 'projects',
      severity: 'high',
      remediation: remediationForReadFailure(
        failure,
        'Check that the Neon API key is valid and has not been revoked, then re-run the check. Organization projects need either an organization API key or a personal key that is a member of the organization.',
      ),
      evidence: { error: failure.error, denied: failure.denied, checkedAt },
    });
    return null;
  }

  if (unavailableProjectIds.length > 0) {
    // Neon told us these exist but could not return them. Left unsaid, the run
    // would report on a subset while looking exhaustive.
    ctx.fail({
      title: `${unavailableProjectIds.length} Neon project(s) could not be read`,
      description:
        'Neon reported projects that exist but whose details it could not return, so their configuration is unknown for this run.',
      resourceType: 'neon',
      resourceId: 'project-coverage',
      severity: 'medium',
      remediation:
        'Re-run the check. If the same projects stay unreadable, confirm they are not suspended and that the API key still has access to them.',
      evidence: { unavailableProjectIds, checkedAt },
    });
  }

  if (projects.length === 0) {
    ctx.fail({
      title: 'No Neon projects found',
      description: 'The Neon API key can see no projects, so there is nothing to evidence.',
      resourceType: 'neon',
      resourceId: 'projects',
      severity: 'medium',
      remediation:
        'Create the API key from the organization that owns your projects (Neon Console > Organization settings > API keys), or add the key owner to that organization.',
      evidence: {
        organizationIds: organizations.map((org) => org.id),
        checkedAt,
      },
    });
    return null;
  }

  const filter = parseNeonProjectFilter(ctx.variables);
  const scoped = applyNeonProjectFilter(projects, filter);

  if (filter.mode !== 'all' && scoped.length === 0) {
    ctx.fail({
      title: 'Project filter matched no projects',
      description: `Filter mode "${filter.mode}" with ${filter.selectedIds.size} selected project(s) resolved to zero projects in scope. This usually means a selected project was deleted or renamed.`,
      resourceType: 'neon',
      resourceId: 'project-filter',
      severity: 'medium',
      remediation:
        'Open the Configure sheet for this automation and review the selected Neon projects.',
      evidence: {
        filterMode: filter.mode,
        selectedProjectIds: Array.from(filter.selectedIds),
        availableProjectIds: projects.map((project) => project.id),
        checkedAt,
      },
    });
    return null;
  }

  ctx.log(
    `Neon scope resolved: ${scoped.length} of ${projects.length} project(s) (filter mode=${filter.mode})`,
  );

  return {
    projects: scoped,
    totalProjectCount: projects.length,
    organizations,
    filter,
    checkedAt,
  };
}

/**
 * Trim the scope to what one run will actually read, recording the remainder
 * as a finding. A coverage cap must never read as "everything passed".
 */
export function limitProjects(
  ctx: CheckContext,
  scope: NeonScope,
  max: number = MAX_PROJECTS_PER_RUN,
): NeonProject[] {
  const covered = scope.projects.slice(0, max);
  const skipped = scope.projects.slice(max);

  if (skipped.length > 0) {
    ctx.fail({
      title: `${skipped.length} project(s) not checked`,
      description: `This run covered ${covered.length} of ${scope.projects.length} projects in scope; the rest were not read.`,
      resourceType: 'neon',
      resourceId: 'project-coverage',
      severity: 'low',
      remediation:
        'Narrow the project filter in the Configure sheet so every project you need evidence for is covered by a run.',
      evidence: {
        checkedProjectCount: covered.length,
        scopedProjectCount: scope.projects.length,
        skippedProjectIds: skipped.map((project) => project.id),
        maxProjectsPerRun: max,
        checkedAt: scope.checkedAt,
      },
    });
  }

  return covered;
}

/** Identity fields every Neon result repeats, so evidence rows are comparable. */
export function projectEvidence(project: NeonProject): Record<string, unknown> {
  return {
    projectId: project.id,
    projectName: project.name ?? project.id,
    organizationId: project.org_id ?? null,
    regionId: project.region_id ?? null,
  };
}
