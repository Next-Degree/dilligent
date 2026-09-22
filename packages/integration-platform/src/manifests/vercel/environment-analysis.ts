import type {
  VercelCustomEnvironment,
  VercelProject,
  VercelProjectEnvVar,
  VercelProtectionSetting,
} from './types';

/**
 * Pure analysis of how a Vercel project separates production from its
 * non-production environments. No I/O — `environments.ts` does the reading.
 *
 * Vercel does not model environments as separate accounts the way AWS or GCP
 * do: every project carries the built-in Production, Preview and Development
 * environments plus any custom ones. So separation here is not "are there two
 * projects with different names", it is whether production configuration and
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
 * Whether a protection method is actually switched on.
 *
 * The object's presence is NOT the answer: Vercel returns a configured-then-
 * disabled method as `{ enabled: false, deploymentType: null }`, so reading
 * presence as "protected" would report restricted access on a project anyone
 * with the URL can reach. Only an explicit `enabled: false` is treated as off,
 * because the older shape omits `enabled` entirely and returns `null` when the
 * method was never configured at all.
 */
function isProtectionEnabled(setting: VercelProtectionSetting | null | undefined): boolean {
  if (!setting) return false;
  return setting.enabled !== false;
}

/**
 * What stands between the internet and this project's non-production
 * deployments. Every `deploymentType` Vercel documents includes preview
 * deployments and there is no production-only option, so an enabled method is
 * read as covering non-production.
 */
export function summarizePreviewProtection(project: VercelProject): VercelPreviewProtection {
  const methods: string[] = [];
  const sso = isProtectionEnabled(project.ssoProtection);
  const password = isProtectionEnabled(project.passwordProtection);
  const trustedIps = isProtectionEnabled(project.trustedIps);
  if (sso) methods.push('Vercel Authentication');
  if (password) methods.push('Password Protection');
  if (trustedIps) methods.push('Trusted IPs');

  return {
    isProtected: methods.length > 0,
    methods,
    ssoDeploymentType: sso ? (project.ssoProtection?.deploymentType ?? null) : null,
    passwordDeploymentType: password ? (project.passwordProtection?.deploymentType ?? null) : null,
    trustedIpsDeploymentType: trustedIps ? (project.trustedIps?.deploymentType ?? null) : null,
  };
}
