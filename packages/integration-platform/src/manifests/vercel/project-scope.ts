import type { CheckContext } from '../../types';
import { remediationForReadFailure, toHttpReadFailure } from '../http-read-failure';
import { fetchAllVercelProjects } from './projects';
import { resolveVercelTeam } from './team';
import type { VercelProject } from './types';
import {
  applyVercelProjectFilter,
  parseVercelProjectFilter,
  type VercelProjectFilter,
} from './variables';

export interface VercelProjectScope {
  teamId: string;
  teamName?: string;
  /** Every project on the team, before the configured filter. */
  allProjects: VercelProject[];
  /** Projects the configured filter selects. */
  scopedProjects: VercelProject[];
  /** Projects this run actually covers, after the per-run cap. */
  projectsToCheck: VercelProject[];
  filter: VercelProjectFilter;
  checkedAt: string;
}

export interface VercelProjectScopeOptions {
  /** Per-run cap for checks that make one request per project. */
  maxProjects: number;
  /** `resourceId` for the finding raised when the cap drops projects. */
  coverageResourceId: string;
  /** What is unknown about the projects the cap dropped. */
  unknownAspect: string;
}

/**
 * Resolve the team, its projects and the configured project filter for a check
 * that reads one project at a time.
 *
 * Returns null when the caller should stop — every reason to stop (no team, an
 * unreadable project list, a filter that selects nothing) is reported here as a
 * finding first, because a check that quietly does nothing looks like a pass.
 */
export async function resolveVercelProjectScope(
  ctx: CheckContext,
  options: VercelProjectScopeOptions,
): Promise<VercelProjectScope | null> {
  const team = await resolveVercelTeam(ctx);
  const teamId = team?.teamId;
  if (!teamId) return null;
  const teamName = team.teamName;
  const checkedAt = new Date().toISOString();

  let allProjects: VercelProject[];
  try {
    allProjects = await fetchAllVercelProjects(ctx, teamId);
  } catch (error) {
    const failure = toHttpReadFailure(error);
    ctx.fail({
      title: 'Failed to fetch Vercel projects',
      resourceType: 'vercel',
      resourceId: 'projects',
      severity: 'high',
      description: `Could not fetch projects: ${failure.error}`,
      remediation: remediationForReadFailure(
        failure,
        'Ensure the Vercel connection has access to your projects, then re-run the check.',
      ),
      evidence: { teamId, error: failure.error, denied: failure.denied },
    });
    return null;
  }

  const filter = parseVercelProjectFilter(ctx.variables);
  const scopedProjects = applyVercelProjectFilter(allProjects, filter);

  if (filter.mode !== 'all' && scopedProjects.length === 0) {
    ctx.fail({
      title: 'Project filter matched no projects',
      resourceType: 'vercel',
      resourceId: 'project-filter',
      severity: 'medium',
      description: `Filter mode "${filter.mode}" with ${filter.selectedIds.size} selected project(s) resolved to zero projects in scope. This may indicate deleted or renamed projects.`,
      remediation: 'Open the Configure sheet for this automation and review the selected projects.',
      evidence: {
        filterMode: filter.mode,
        selectedProjectIds: Array.from(filter.selectedIds),
        availableProjectIds: allProjects.map((project) => project.id),
      },
    });
    return null;
  }

  const projectsToCheck = scopedProjects.slice(0, options.maxProjects);
  const skipped = scopedProjects.slice(options.maxProjects);

  if (skipped.length > 0) {
    // Never let a coverage cap read as "everything passed".
    ctx.fail({
      title: `${skipped.length} project(s) not checked`,
      resourceType: 'vercel',
      resourceId: options.coverageResourceId,
      severity: 'low',
      description: `This run covered ${projectsToCheck.length} of ${scopedProjects.length} projects in scope; the ${options.unknownAspect} of the rest is unknown.`,
      remediation:
        'Narrow the project filter in the Configure sheet so every project you need evidence for is covered by a run.',
      evidence: {
        checkedProjectCount: projectsToCheck.length,
        scopedProjectCount: scopedProjects.length,
        skippedProjectIds: skipped.map((project) => project.id),
        maxProjectsPerRun: options.maxProjects,
        checkedAt,
      },
    });
  }

  return { teamId, teamName, allProjects, scopedProjects, projectsToCheck, filter, checkedAt };
}
