import type { CheckContext } from '../../types';
import { withTeamId } from './team';
import type {
  VercelCustomEnvironment,
  VercelCustomEnvironmentsResponse,
  VercelProject,
  VercelProjectEnvVar,
  VercelProjectEnvsResponse,
} from './types';

/**
 * Reading and analysing how a Vercel project separates production from its
 * non-production environments.
 *
 * Vercel does not model environments as separate accounts the way AWS or GCP
 * do — every project carries the built-in Production, Preview and Development
 * environments plus any custom ones. So separation here is not "are there two
 * projects with different names": it is whether production configuration and
 * production access actually stop at the production boundary.
 */

/** The built-in environments every Vercel project has. */
export const BUILT_IN_ENVIRONMENTS = ['production', 'preview', 'development'] as const;

/** Built-in targets that are NOT production. */
const NON_PRODUCTION_TARGETS: ReadonlySet<string> = new Set(['preview', 'development']);

const PRODUCTION_TARGET = 'production';

/**
 * Variable types that carry a credential rather than public configuration.
 * `plain` is readable config and `system` is Vercel's own (VERCEL_URL and
 * friends), which is always present in every environment by design — flagging
 * either would bury the finding that matters under noise.
 */
const SECRET_ENV_TYPES: ReadonlySet<string> = new Set(['encrypted', 'secret', 'sensitive']);

/** Cap the key list carried in evidence so one project cannot flood a run. */
const MAX_REPORTED_KEYS = 25;

export interface VercelEnvironmentSeparation {
  /** Custom environment slugs, production ones marked. */
  customEnvironments: Array<{ slug: string; type: string }>;
  totalVariableCount: number;
  /** Secrets assigned to production and to nothing outside it. */
  productionOnlySecretCount: number;
  /** Secrets assigned only to non-production environments. */
  nonProductionOnlySecretCount: number;
  /** Secret keys assigned to production AND a non-production environment. */
  sharedSecretKeys: string[];
  sharedSecretCount: number;
  /** Plain (non-secret) variables spanning the boundary — recorded, not failed. */
  sharedPlainVariableCount: number;
}

export interface VercelPreviewProtection {
  /** Whether non-production deployments require anything to view them. */
  isProtected: boolean;
  /** Human-readable methods in force, for the finding description. */
  methods: string[];
  ssoDeploymentType: string | null;
  passwordDeploymentType: string | null;
  trustedIpsDeploymentType: string | null;
}

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

/** A custom environment counts as production only when it says it is. */
function partitionCustomEnvironmentIds(customEnvironments: readonly VercelCustomEnvironment[]): {
  production: Set<string>;
  nonProduction: Set<string>;
} {
  const production = new Set<string>();
  const nonProduction = new Set<string>();
  for (const environment of customEnvironments) {
    if (!environment.id) continue;
    if (environment.type === PRODUCTION_TARGET) {
      production.add(environment.id);
      continue;
    }
    nonProduction.add(environment.id);
  }
  return { production, nonProduction };
}

function intersects(ids: readonly string[] | undefined, set: ReadonlySet<string>): boolean {
  return (ids ?? []).some((id) => set.has(id));
}

/**
 * Classify every variable on a project against the production boundary.
 *
 * A secret assigned to production AND to a non-production environment is the
 * finding that matters: it means preview and development deployments run
 * against the production database, queue or API key, which is exactly the
 * segregation the control asks to see proof of.
 */
export function analyzeEnvironmentSeparation({
  envVars,
  customEnvironments,
}: {
  envVars: readonly VercelProjectEnvVar[];
  customEnvironments: readonly VercelCustomEnvironment[];
}): VercelEnvironmentSeparation {
  const customIds = partitionCustomEnvironmentIds(customEnvironments);

  let productionOnlySecretCount = 0;
  let nonProductionOnlySecretCount = 0;
  let sharedPlainVariableCount = 0;
  const sharedSecretKeys: string[] = [];
  let sharedSecretCount = 0;
  let totalVariableCount = 0;

  for (const variable of envVars) {
    if (variable.system === true || variable.type === 'system') continue;
    totalVariableCount++;

    const targets = variable.target ?? [];
    const touchesProduction =
      targets.includes(PRODUCTION_TARGET) ||
      intersects(variable.customEnvironmentIds, customIds.production);
    const touchesNonProduction =
      targets.some((target) => NON_PRODUCTION_TARGETS.has(target)) ||
      intersects(variable.customEnvironmentIds, customIds.nonProduction);
    const isSecret = SECRET_ENV_TYPES.has(variable.type ?? '');

    if (touchesProduction && touchesNonProduction) {
      if (!isSecret) {
        sharedPlainVariableCount++;
        continue;
      }
      sharedSecretCount++;
      if (sharedSecretKeys.length < MAX_REPORTED_KEYS) {
        sharedSecretKeys.push(variable.key ?? variable.id ?? 'unnamed variable');
      }
      continue;
    }

    if (!isSecret) continue;
    if (touchesProduction) productionOnlySecretCount++;
    else if (touchesNonProduction) nonProductionOnlySecretCount++;
  }

  return {
    customEnvironments: customEnvironments.map((environment) => ({
      slug: environment.slug ?? environment.id ?? 'unnamed',
      type: environment.type ?? 'unknown',
    })),
    totalVariableCount,
    productionOnlySecretCount,
    nonProductionOnlySecretCount,
    sharedSecretKeys,
    sharedSecretCount,
    sharedPlainVariableCount,
  };
}

/**
 * What stands between the internet and this project's non-production
 * deployments. Any non-null protection setting is read as covering preview:
 * every `deploymentType` Vercel documents includes preview deployments, and
 * there is no production-only option to mistake one for.
 */
export function summarizePreviewProtection(project: VercelProject): VercelPreviewProtection {
  const methods: string[] = [];
  if (project.ssoProtection) methods.push('Vercel Authentication');
  if (project.passwordProtection) methods.push('Password Protection');
  if (project.trustedIps) methods.push('Trusted IPs');

  return {
    isProtected: methods.length > 0,
    methods,
    ssoDeploymentType: project.ssoProtection?.deploymentType ?? null,
    passwordDeploymentType: project.passwordProtection?.deploymentType ?? null,
    trustedIpsDeploymentType: project.trustedIps?.deploymentType ?? null,
  };
}

/**
 * The project as the protection fields require it: `/v9/projects` has been seen
 * to omit them entirely, and "the field was absent" is not the same answer as
 * "protection is off" — reporting the second for the first would tell a
 * customer to fix something already in place. So an absent field, and only an
 * absent field, costs one extra read.
 */
export async function resolveProjectWithProtection({
  ctx,
  project,
  teamId,
}: {
  ctx: CheckContext;
  project: VercelProject;
  teamId?: string;
}): Promise<VercelProject> {
  const known =
    project.ssoProtection !== undefined ||
    project.passwordProtection !== undefined ||
    project.trustedIps !== undefined;
  if (known) return project;

  const params = withTeamId(new URLSearchParams(), teamId);
  const query = params.toString();
  const detailed = await ctx.fetch<VercelProject>(
    `/v9/projects/${encodeURIComponent(project.id)}${query ? `?${query}` : ''}`,
  );
  return detailed ?? project;
}
