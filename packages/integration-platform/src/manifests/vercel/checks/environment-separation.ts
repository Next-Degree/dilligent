import { TASK_TEMPLATES } from '../../../task-mappings';
import type { CheckContext, IntegrationCheck } from '../../../types';
import { remediationForReadFailure, toHttpReadFailure } from '../../http-read-failure';
import {
  BUILT_IN_ENVIRONMENTS,
  analyzeEnvironmentSeparation,
  fetchCustomEnvironments,
  fetchProjectEnvVars,
  resolveProjectWithProtection,
  summarizePreviewProtection,
} from '../environments';
import { resolveVercelProjectScope } from '../project-scope';
import type { VercelCustomEnvironment, VercelProject } from '../types';
import { filteredProjectsVariable, projectFilterModeVariable } from '../variables';

/** Two to three reads per project — bound the run and say what was skipped. */
const MAX_PROJECTS_PER_RUN = 25;

const PROTECTION_SUFFIX = ':preview-protection';

/**
 * Collect the per-project facts. Custom environments are optional: some plans
 * do not offer them, and a project without any still has Production, Preview
 * and Development to separate, so an unreadable list is recorded and the
 * evaluation continues rather than reporting the project as unverifiable.
 */
async function readProjectEnvironments({
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

/**
 * Vercel separation of environments
 *
 * Vercel keeps every environment inside one project, so separation cannot be
 * inferred from the project footprint the way it is for AWS accounts or GCP
 * projects. This check evaluates the boundary itself, per project:
 *
 * 1. Configuration — no secret (encrypted or sensitive) environment variable is
 *    assigned to production AND to a non-production environment. A shared
 *    secret means preview and development deployments run against production
 *    credentials, which is the opposite of the segregation being evidenced.
 * 2. Access — non-production deployments are not open to anyone with the URL,
 *    via Vercel Authentication, Password Protection or Trusted IPs.
 *
 * Maps to: Separation of Environments
 */
export const environmentSeparationCheck: IntegrationCheck = {
  id: 'environment-separation',
  name: 'Vercel separation of environments',
  description:
    'Verify production configuration and access are separated from preview and development environments in each Vercel project',
  service: 'security',
  taskMapping: TASK_TEMPLATES.separationOfEnvironments,
  defaultSeverity: 'high',
  variables: [projectFilterModeVariable, filteredProjectsVariable],

  run: async (ctx: CheckContext) => {
    ctx.log('Starting Vercel environment separation check');

    const scope = await resolveVercelProjectScope(ctx, {
      maxProjects: MAX_PROJECTS_PER_RUN,
      coverageResourceId: 'environment-separation-coverage',
      unknownAspect: 'environment separation',
    });
    if (!scope) return;

    const { teamId, teamName, allProjects, scopedProjects, projectsToCheck, filter, checkedAt } =
      scope;

    let separatedCount = 0;
    let protectedCount = 0;

    for (const project of projectsToCheck) {
      let facts: Awaited<ReturnType<typeof readProjectEnvironments>>;
      try {
        facts = await readProjectEnvironments({ ctx, project, teamId });
      } catch (error) {
        const failure = toHttpReadFailure(error);
        ctx.fail({
          title: `Environment separation unknown: ${project.name}`,
          resourceType: 'project',
          resourceId: project.id,
          severity: 'medium',
          description: `Could not read the environment variables for ${project.name} (${failure.error}), so whether production configuration is separated from preview and development is unknown.`,
          remediation: remediationForReadFailure(
            failure,
            'Use a Vercel access token created by an account with Owner or Member access to this team, then re-run the check.',
          ),
          evidence: {
            project: project.name,
            error: failure.error,
            denied: failure.denied,
            checkedAt,
          },
        });
        continue;
      }

      const analysis = analyzeEnvironmentSeparation({
        envVars: facts.envVars,
        customEnvironments: facts.customEnvironments,
      });
      const evidence = {
        project: project.name,
        projectId: project.id,
        builtInEnvironments: [...BUILT_IN_ENVIRONMENTS],
        customEnvironments: analysis.customEnvironments,
        variableCount: analysis.totalVariableCount,
        productionOnlySecretCount: analysis.productionOnlySecretCount,
        nonProductionOnlySecretCount: analysis.nonProductionOnlySecretCount,
        sharedSecretCount: analysis.sharedSecretCount,
        sharedSecretKeys: analysis.sharedSecretKeys,
        sharedPlainVariableCount: analysis.sharedPlainVariableCount,
        ...(facts.customEnvironmentsError
          ? { customEnvironmentsError: facts.customEnvironmentsError }
          : {}),
        checkedAt,
      };

      if (analysis.sharedSecretCount > 0) {
        ctx.fail({
          title: `Production secrets reach non-production: ${project.name}`,
          resourceType: 'project',
          resourceId: project.id,
          severity: 'high',
          description: `${analysis.sharedSecretCount} secret environment variable(s) in ${project.name} are assigned to production and to a non-production environment (${analysis.sharedSecretKeys.join(', ')}), so preview and development deployments run with production credentials. Environments that share credentials are not segregated.`,
          remediation: `In Vercel > ${project.name} > Settings > Environment Variables, scope each of these keys to Production only and add a separate value for Preview and Development that points at a non-production database, store or API key.`,
          evidence,
        });
      } else {
        separatedCount++;
        ctx.pass({
          title: `Environments separated: ${project.name}`,
          resourceType: 'project',
          resourceId: project.id,
          description: `No secret environment variable in ${project.name} is shared between production and a non-production environment. Production holds ${analysis.productionOnlySecretCount} production-only secret(s); preview, development and custom environments hold ${analysis.nonProductionOnlySecretCount}.`,
          evidence,
        });
      }

      let projectWithProtection: VercelProject;
      try {
        projectWithProtection = await resolveProjectWithProtection({ ctx, project, teamId });
      } catch (error) {
        const failure = toHttpReadFailure(error);
        ctx.fail({
          title: `Non-production access unknown: ${project.name}`,
          resourceType: 'project',
          resourceId: `${project.id}${PROTECTION_SUFFIX}`,
          severity: 'medium',
          description: `Could not read the deployment protection settings for ${project.name} (${failure.error}), so whether non-production deployments restrict access is unknown.`,
          remediation: remediationForReadFailure(
            failure,
            'Use a Vercel access token created by an account with Owner or Member access to this team, then re-run the check.',
          ),
          evidence: { project: project.name, error: failure.error, checkedAt },
        });
        continue;
      }

      const protection = summarizePreviewProtection(projectWithProtection);
      const protectionEvidence = {
        project: project.name,
        projectId: project.id,
        previewDeploymentsProtected: protection.isProtected,
        protectionMethods: protection.methods,
        ssoDeploymentType: protection.ssoDeploymentType,
        passwordDeploymentType: protection.passwordDeploymentType,
        trustedIpsDeploymentType: protection.trustedIpsDeploymentType,
        checkedAt,
      };

      if (protection.isProtected) {
        protectedCount++;
        ctx.pass({
          title: `Non-production deployments restricted: ${project.name}`,
          resourceType: 'project',
          resourceId: `${project.id}${PROTECTION_SUFFIX}`,
          description: `Preview and development deployments of ${project.name} require ${protection.methods.join(' or ')} to reach, so access to non-production environments is restricted.`,
          evidence: protectionEvidence,
        });
        continue;
      }

      ctx.fail({
        title: `Non-production deployments are unrestricted: ${project.name}`,
        resourceType: 'project',
        resourceId: `${project.id}${PROTECTION_SUFFIX}`,
        severity: 'medium',
        description: `Deployment protection is off for ${project.name}, so anyone with a preview URL can reach its non-production deployments. Separated environments are expected to restrict access between them, not only to hold different configuration.`,
        remediation: `Enable protection in Vercel > ${project.name} > Settings > Deployment Protection — Vercel Authentication limits preview deployments to team members, and Password Protection or Trusted IPs cover viewers outside the team.`,
        evidence: protectionEvidence,
      });
    }

    ctx.pass({
      title: 'Vercel environment separation',
      resourceType: 'vercel',
      resourceId: 'environment-separation',
      description: `${separatedCount} of ${projectsToCheck.length} checked project(s) keep production secrets out of non-production environments, and ${protectedCount} restrict access to non-production deployments.`,
      evidence: {
        teamId,
        teamName: teamName ?? null,
        totalProjects: allProjects.length,
        scopedProjects: scopedProjects.length,
        checkedProjects: projectsToCheck.length,
        separatedProjectCount: separatedCount,
        protectedNonProductionCount: protectedCount,
        filterMode: filter.mode,
        checkedAt,
      },
    });

    ctx.log(
      `Vercel environment separation check complete: ${separatedCount}/${projectsToCheck.length} projects with separated configuration`,
    );
  },
};
