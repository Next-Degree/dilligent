import type { CheckContext } from '../../types';
import { withTeamId } from './team';
import type { VercelProject, VercelProjectsResponse } from './types';

const PROJECTS_PAGE_SIZE = 100;
const MAX_PROJECT_PAGES = 20;

/**
 * Fetch every project visible to the connection. `/v9/projects` defaults to a
 * small page, so paginate on the cursor timestamp Vercel returns as
 * `pagination.next` and pass it back as `until`.
 */
export async function fetchAllVercelProjects(
  ctx: CheckContext,
  teamId?: string,
): Promise<VercelProject[]> {
  const projects: VercelProject[] = [];
  const seen = new Set<string>();
  let until: number | undefined;

  for (let page = 0; page < MAX_PROJECT_PAGES; page++) {
    const params = withTeamId(new URLSearchParams({ limit: String(PROJECTS_PAGE_SIZE) }), teamId);
    if (typeof until === 'number') {
      params.set('until', String(until));
    }

    const response = await ctx.fetch<VercelProjectsResponse>(`/v9/projects?${params.toString()}`);
    for (const project of response.projects ?? []) {
      if (!seen.has(project.id)) {
        seen.add(project.id);
        projects.push(project);
      }
    }

    const next = response.pagination?.next;
    if (typeof next !== 'number') {
      break;
    }
    until = next;
  }

  return projects;
}
