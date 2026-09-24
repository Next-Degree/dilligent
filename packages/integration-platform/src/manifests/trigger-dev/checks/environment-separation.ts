import { TASK_TEMPLATES } from '../../../task-mappings';
import type { CheckContext, IntegrationCheck } from '../../../types';
import { remediationForReadFailure, toHttpReadFailure } from '../../http-read-failure';
import { listEnvironments, projectUrl } from '../client';
import { resolveProjects } from '../scope';
import type { TriggerEnvironment, TriggerProject } from '../types';
import { targetOrganizationsVariable } from '../variables';

function projectEvidence(project: TriggerProject): Record<string, unknown> {
  return {
    projectRef: project.externalRef,
    project: project.name,
    organization: project.organization.slug,
  };
}

/**
 * Trigger.dev Separation of Environments
 *
 * Verifies each project has its own STAGING environment alongside PRODUCTION. Trigger.dev
 * environments are isolated by the platform — separate deployments, API keys, environment
 * variables, queues and runs — so their presence is the structural evidence. The check
 * reads environment types only; it never reads environment variable values.
 *
 * DEVELOPMENT environments are per-member sandboxes and PREVIEW branches are ephemeral,
 * so neither stands in for a staging environment; both are recorded as evidence.
 *
 * Maps to: Separation of Environments
 */
export const environmentSeparationCheck: IntegrationCheck = {
  id: 'environment-separation',
  name: 'Separation of Environments',
  description: 'Verify each Trigger.dev project runs separate Production and Staging environments',
  service: 'inventory',
  taskMapping: TASK_TEMPLATES.separationOfEnvironments,
  defaultSeverity: 'medium',
  variables: [targetOrganizationsVariable],

  run: async (ctx: CheckContext) => {
    ctx.log('Starting Trigger.dev environment separation check');

    const scope = await resolveProjects(ctx);
    if (!scope) return;

    for (const project of scope.projects) {
      let environments: TriggerEnvironment[];
      try {
        environments = await listEnvironments(ctx, project.externalRef);
      } catch (error) {
        const failure = toHttpReadFailure(error);
        ctx.fail({
          title: `Environments unknown: ${project.name}`,
          description: `Could not list the project's environments: ${failure.error}`,
          resourceType: 'trigger_dev_project',
          resourceId: project.externalRef,
          severity: 'medium',
          remediation: remediationForReadFailure(
            failure,
            'Confirm the Personal Access Token belongs to a member of the organization that owns this project, then re-run the check.',
          ),
          evidence: {
            ...projectEvidence(project),
            error: failure.error,
            checkedAt: scope.checkedAt,
          },
        });
        continue;
      }

      const types = new Set(environments.map((env) => env.type));
      const hasProduction = types.has('PRODUCTION');
      const hasStaging = types.has('STAGING');
      const evidence = {
        ...projectEvidence(project),
        environments: environments.map((env) => ({
          slug: env.slug,
          type: env.type,
          paused: env.paused,
        })),
        hasProduction,
        hasStaging,
        hasPreview: types.has('PREVIEW'),
        checkedAt: scope.checkedAt,
      };

      if (hasProduction && hasStaging) {
        ctx.pass({
          title: `Environments separated: ${project.name}`,
          description:
            'The project has distinct Production and Staging environments, each with its own deployments, API keys, environment variables and runs.',
          resourceType: 'trigger_dev_project',
          resourceId: project.externalRef,
          evidence,
        });
        continue;
      }

      const missing = [!hasProduction && 'Production', !hasStaging && 'Staging'].filter(Boolean);
      ctx.fail({
        title: `No ${missing.join(' or ')} environment: ${project.name}`,
        description: `Project "${project.name}" has no ${missing.join(' or ')} environment, so changes cannot be validated outside production before they ship.`,
        resourceType: 'trigger_dev_project',
        resourceId: project.externalRef,
        severity: 'medium',
        remediation: `Deploy to staging with \`npx trigger.dev@latest deploy --env staging\` (staging needs the Hobby or Pro plan), and use the Staging environment's own API key and variables. Project: ${projectUrl(project)}`,
        evidence,
      });
    }

    ctx.log(
      `Trigger.dev environment separation check complete: ${scope.projects.length} project(s)`,
    );
  },
};
