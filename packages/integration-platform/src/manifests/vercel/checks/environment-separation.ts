import { TASK_TEMPLATES } from '../../../task-mappings';
import type { CheckContext, IntegrationCheck } from '../../../types';
import { remediationForReadFailure, toHttpReadFailure } from '../../http-read-failure';
import { analyzeEnvironmentSeparation, summarizePreviewProtection } from '../environment-analysis';
import { describeAccess, describeProjectTopology, summaryRow } from '../environment-topology';
import { fetchProjectDetail, readProjectEnvironments } from '../environments';
import { resolveVercelProjectScope } from '../project-scope';
import { filteredProjectsVariable, projectFilterModeVariable } from '../variables';

/** Two to three reads per project — bound the run and say what was skipped. */
const MAX_PROJECTS_PER_RUN = 25;

const PROTECTION_SUFFIX = ':preview-protection';

/**
 * Vercel separation of environments
 *
 * Vercel keeps every environment inside one project, so separation cannot be
 * inferred from the project footprint the way it is for AWS accounts or GCP
 * projects. This check reports the boundary and then tests it, per project:
 *
 * - Topology — which branch becomes production, which branches land in each
 *   custom environment. Recorded for every project, passing or not, because it
 *   is what an auditor reads in place of the console screenshot the control
 *   asks for. It is per ENVIRONMENT, never per branch, so a project with a
 *   thousand preview branches still contributes a handful of rows.
 * - Configuration — no secret (encrypted or sensitive) environment variable is
 *   assigned to production AND to a non-production environment. A shared
 *   secret means preview and development deployments run against production
 *   credentials, which is the opposite of the segregation being evidenced.
 * - Access — non-production deployments are not open to anyone with the URL,
 *   via Vercel Authentication, Password Protection or Trusted IPs.
 *
 * A project always contributes exactly one result for the configuration test;
 * the access test adds a second only when it FAILS, under its own resourceId
 * so it stays independently exceptable. A clean team therefore reads as one
 * row per project, and the display cap on findings is spent on distinct
 * projects rather than on two rows for the same one.
 *
 * Maps to: Separation of Environments
 */
export const environmentSeparationCheck: IntegrationCheck = {
  id: 'environment-separation',
  name: 'Vercel separation of environments',
  description:
    'Report each Vercel project’s environment topology and verify production configuration and access are separated from preview and development',
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
    const topologyTable: ReturnType<typeof summaryRow>[] = [];

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
          description: `Could not read the environment configuration for ${project.name} (${failure.error}), so whether production is separated from preview and development is unknown.`,
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

      const detail = await fetchProjectDetail({ ctx, project, teamId });
      const analysis = analyzeEnvironmentSeparation({
        envVars: facts.envVars,
        customEnvironments: facts.customEnvironments,
      });
      const topology = describeProjectTopology({
        project: detail.project,
        customEnvironments: facts.customEnvironments,
      });
      const protection = summarizePreviewProtection(detail.project);
      topologyTable.push(summaryRow({ project, topology, protection, analysis, detail }));

      const secretsShared = analysis.sharedSecretCount > 0;
      if (!secretsShared) separatedCount++;
      if (detail.protectionKnown && protection.isProtected) protectedCount++;

      const evidence = {
        project: project.name,
        projectId: project.id,
        repository: topology.gitRepository,
        productionBranch: topology.productionBranch,
        environments: topology.environments,
        variableCount: analysis.totalVariableCount,
        productionOnlySecretCount: analysis.productionOnlySecretCount,
        nonProductionOnlySecretCount: analysis.nonProductionOnlySecretCount,
        sharedSecretCount: analysis.sharedSecretCount,
        sharedSecretKeys: analysis.sharedSecretKeys,
        sharedPlainVariableCount: analysis.sharedPlainVariableCount,
        previewDeploymentsProtected: detail.protectionKnown ? protection.isProtected : null,
        protectionMethods: protection.methods,
        ssoDeploymentType: protection.ssoDeploymentType,
        passwordDeploymentType: protection.passwordDeploymentType,
        trustedIpsDeploymentType: protection.trustedIpsDeploymentType,
        ...(facts.customEnvironmentsError
          ? { customEnvironmentsError: facts.customEnvironmentsError }
          : {}),
        ...(detail.error ? { projectDetailError: detail.error } : {}),
        checkedAt,
      };

      const productionDescription = topology.productionBranch
        ? `Production deploys from ${topology.productionBranch}`
        : 'Production deploys from the project’s production branch';

      if (!secretsShared && protection.isProtected) {
        ctx.pass({
          title: `Environments separated: ${project.name}`,
          resourceType: 'project',
          resourceId: project.id,
          description: `${productionDescription}; every other branch lands in a non-production environment reachable only with ${protection.methods.join(' or ')}. No secret environment variable is shared between production and a non-production environment: production holds ${analysis.productionOnlySecretCount} production-only secret(s), non-production holds ${analysis.nonProductionOnlySecretCount}.`,
          evidence,
        });
        continue;
      }

      if (secretsShared) {
        ctx.fail({
          title: `Production secrets reach non-production: ${project.name}`,
          resourceType: 'project',
          resourceId: project.id,
          severity: 'high',
          description: `${productionDescription}, but ${analysis.sharedSecretCount} secret environment variable(s) are assigned to production and to a non-production environment (${analysis.sharedSecretKeys.join(', ')}), so preview and development deployments run with production credentials.`,
          remediation: `In Vercel > ${project.name} > Settings > Environment Variables, scope each of those keys to Production only and add a separate value for the non-production environments that points at a non-production database, store or API key.`,
          evidence,
        });
      } else {
        ctx.pass({
          title: `Environments separated: ${project.name}`,
          resourceType: 'project',
          resourceId: project.id,
          description: `${productionDescription}; every other branch lands in a non-production environment. No secret environment variable is shared between production and a non-production environment: production holds ${analysis.productionOnlySecretCount} production-only secret(s), non-production holds ${analysis.nonProductionOnlySecretCount}. Access to non-production deployments: ${describeAccess({ detail, protection })}.`,
          evidence,
        });
      }

      // Emitted ONLY when it fails, under its own resourceId. Exceptions are
      // keyed on resourceId and apply only to failing rows, so this keeps the
      // access concern independently exceptable — a static site whose previews
      // are deliberately public can be excepted without also excepting the
      // shared-secret detection for that project — while a clean project still
      // contributes one row rather than two.
      if (!detail.protectionKnown) {
        ctx.fail({
          title: `Non-production access unknown: ${project.name}`,
          resourceType: 'project',
          resourceId: `${project.id}${PROTECTION_SUFFIX}`,
          severity: 'medium',
          description: `Could not read the deployment protection settings for ${project.name} (${detail.error ?? 'the project detail carried none'}), so whether access to its non-production deployments is restricted is unknown. Unknown is reported as its own state rather than as unprotected.`,
          remediation:
            'Use a Vercel access token created by an account with Owner or Member access to this team, then re-run the check.',
          evidence,
        });
      } else if (!protection.isProtected) {
        ctx.fail({
          title: `Non-production deployments are unrestricted: ${project.name}`,
          resourceType: 'project',
          resourceId: `${project.id}${PROTECTION_SUFFIX}`,
          severity: 'medium',
          description: `Deployment protection is off for ${project.name}, so anyone with a preview URL can reach its non-production deployments. Separated environments are expected to restrict access between them, not only to hold different configuration.`,
          remediation: `Enable protection in Vercel > ${project.name} > Settings > Deployment Protection — Vercel Authentication limits preview deployments to team members, and Password Protection or Trusted IPs cover viewers outside the team.`,
          evidence,
        });
      }
    }

    ctx.pass({
      title: 'Vercel environment topology',
      resourceType: 'vercel',
      resourceId: 'environment-separation',
      description: `${projectsToCheck.length} Vercel project(s) reviewed. ${separatedCount} keep production secrets out of non-production environments and ${protectedCount} restrict access to non-production deployments.`,
      evidence: {
        teamId,
        teamName: teamName ?? null,
        totalProjects: allProjects.length,
        scopedProjects: scopedProjects.length,
        checkedProjects: projectsToCheck.length,
        separatedProjectCount: separatedCount,
        protectedNonProductionCount: protectedCount,
        // One row per project: the table an auditor reads in place of a
        // console screenshot.
        environmentTopology: topologyTable,
        filterMode: filter.mode,
        checkedAt,
      },
    });

    ctx.log(
      `Vercel environment separation check complete: ${separatedCount}/${projectsToCheck.length} projects with separated configuration`,
    );
  },
};
