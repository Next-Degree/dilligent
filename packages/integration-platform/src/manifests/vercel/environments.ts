import type { CheckContext } from '../../types';
import { toHttpReadFailure } from '../http-read-failure';
import { withTeamId } from './team';
import type {
  VercelCustomEnvironment,
  VercelCustomEnvironmentsResponse,
  VercelProject,
  VercelProjectEnvVar,
  VercelProjectEnvsResponse,
} from './types';

/**
 * Reads behind the Vercel environment separation check. The analysis these
 * feed lives in `environment-analysis.ts`.
 */

export async function fetchCustomEnvironments({
  ctx,
  projectId,
  teamId,
}: {
  ctx: CheckContext;
  projectId: string;
  teamId?: string;
}): Promise<VercelCustomEnvironment[]> {
  const params = withTeamId(new URLSearchParams(), teamId);
  const query = params.toString();
  const response = await ctx.fetch<VercelCustomEnvironmentsResponse>(
    `/v9/projects/${encodeURIComponent(projectId)}/custom-environments${query ? `?${query}` : ''}`,
  );
  return response?.environments ?? [];
}

export async function fetchProjectEnvVars({
  ctx,
  projectId,
  teamId,
}: {
  ctx: CheckContext;
  projectId: string;
  teamId?: string;
}): Promise<VercelProjectEnvVar[]> {
  const params = withTeamId(new URLSearchParams(), teamId);
  const query = params.toString();
  const response = await ctx.fetch<VercelProjectEnvsResponse>(
    `/v10/projects/${encodeURIComponent(projectId)}/env${query ? `?${query}` : ''}`,
  );
  return response?.envs ?? [];
}

/** Whether the listed project carries any protection field at all. */
function hasProtectionField(project: VercelProject): boolean {
  return (
    project.ssoProtection !== undefined ||
    project.passwordProtection !== undefined ||
    project.trustedIps !== undefined
  );
}

export interface VercelProjectDetail {
  project: VercelProject;
  /** Set when the detail read failed and the listed project is being used. */
  error?: string;
  /**
   * Whether the deployment protection state is actually KNOWN. False means the
   * detail read failed and the listing carried no protection field either — so
   * the answer is "unknown", which must not be reported as "unprotected".
   */
  protectionKnown: boolean;
}

/**
 * Read the full project.
 *
 * Always a separate read rather than trusting the listing: `/v9/projects` has
 * been seen to return a trimmed projection, and the two fields this check
 * reports on — the git link carrying `productionBranch`, and the deployment
 * protection state — are exactly the ones a projection drops. Guessing either
 * from a listing that omits it would report the production branch as unknown
 * on every project, or report protection as off on a protected one.
 *
 * A failed read falls back to the listed project rather than discarding it:
 * the environment variables were already read successfully, so the
 * configuration half of the check still stands.
 */
export async function fetchProjectDetail({
  ctx,
  project,
  teamId,
}: {
  ctx: CheckContext;
  project: VercelProject;
  teamId?: string;
}): Promise<VercelProjectDetail> {
  const params = withTeamId(new URLSearchParams(), teamId);
  const query = params.toString();
  try {
    const detailed = await ctx.fetch<VercelProject>(
      `/v9/projects/${encodeURIComponent(project.id)}${query ? `?${query}` : ''}`,
    );
    if (detailed?.id) return { project: detailed, protectionKnown: true };
    return { project, protectionKnown: hasProtectionField(project) };
  } catch (error) {
    const { error: message } = toHttpReadFailure(error);
    ctx.log(`Vercel env-separation: project detail unreadable for ${project.name} — ${message}`);
    return { project, error: message, protectionKnown: hasProtectionField(project) };
  }
}

/**
 * Collect the per-project facts. Custom environments are optional: some plans
 * do not offer them, and a project without any still has Production, Preview
 * and Development to separate, so an unreadable list is recorded and the
 * evaluation continues rather than reporting the project as unverifiable.
 */
export async function readProjectEnvironments({
  ctx,
  project,
  teamId,
}: {
  ctx: CheckContext;
  project: VercelProject;
  teamId: string;
}) {
  let customEnvironments: VercelCustomEnvironment[] = [];
  let customEnvironmentsError: string | undefined;
  try {
    customEnvironments = await fetchCustomEnvironments({ ctx, projectId: project.id, teamId });
  } catch (error) {
    customEnvironmentsError = toHttpReadFailure(error).error;
    ctx.log(
      `Vercel env-separation: custom environments unreadable for ${project.name} — ${customEnvironmentsError}`,
    );
  }

  const envVars = await fetchProjectEnvVars({ ctx, projectId: project.id, teamId });
  return { customEnvironments, customEnvironmentsError, envVars };
}

/** The one-line-per-project row that makes the summary readable on its own. */
