import { TASK_TEMPLATES } from '../../../task-mappings';
import type { CheckContext, IntegrationCheck } from '../../../types';
import { classifyEnvironment } from '../../environment-classification';
import {
  instanceEvidence,
  loadInstances,
  resolveRailwayScope,
  type ScopedInstance,
} from '../scope';
import type { RailwayDeploymentStatus } from '../types';

/** A deployment in one of these states is serving (SLEEPING wakes on the next request). */
const LIVE: ReadonlySet<RailwayDeploymentStatus> = new Set(['SUCCESS', 'SLEEPING']);
const BROKEN: ReadonlySet<RailwayDeploymentStatus> = new Set(['CRASHED', 'FAILED']);

/**
 * Production is the project's primary environment, or any environment whose
 * name classifies as production. Ephemeral PR environments never count.
 */
function isProductionInstance({ project, environment }: ScopedInstance): boolean {
  if (environment.isEphemeral) return false;
  if (project.primaryEnvironmentId && environment.id === project.primaryEnvironmentId) return true;
  return classifyEnvironment([environment.name]) === 'production';
}

const projectUrl = (projectId: string) =>
  `https://railway.com/project/${encodeURIComponent(projectId)}`;

function judgeInstance(ctx: CheckContext, scoped: ScopedInstance, checkedAt: string): void {
  const { instance, project } = scoped;
  const label = `${project.name} / ${scoped.environment.name} / ${instance.serviceName}`;
  const latest = instance.latestDeployment ?? null;
  const active = instance.activeDeployments ?? [];
  const live = active.find((deployment) => LIVE.has(deployment.status));
  const base = {
    resourceType: 'railway_service',
    resourceId: `${scoped.environment.id}:${instance.serviceId}`,
  };
  const evidence = {
    verification: 'api-verified',
    ...instanceEvidence(scoped),
    latestDeployment: latest,
    liveDeployment: live ?? null,
    activeDeploymentCount: active.length,
    checkedAt,
  };

  // A failed build on top of a healthy deployment leaves the app serving the
  // previous version: that is a release problem, not an availability one.
  if (live || (latest && LIVE.has(latest.status))) {
    ctx.pass({
      ...base,
      title: `Service available: ${label}`,
      description: `${label} has a live deployment (${(live ?? latest)?.status}).`,
      evidence,
    });
    return;
  }

  if (latest && BROKEN.has(latest.status)) {
    ctx.fail({
      ...base,
      title: `Service down: ${label}`,
      description: `The latest deployment of ${label} is ${latest.status} and no other deployment is serving.`,
      severity: 'high',
      remediation: `Open ${projectUrl(project.id)}, read the deployment logs for ${instance.serviceName}, and redeploy or roll back to the last healthy deployment.`,
      evidence,
    });
    return;
  }

  ctx.fail({
    ...base,
    title: `No live deployment: ${label}`,
    description: latest
      ? `${label} has no deployment serving traffic; the latest is ${latest.status}.`
      : `${label} has never been deployed in this environment.`,
    severity: 'low',
    remediation: `Deploy ${instance.serviceName} in ${projectUrl(project.id)}, or delete the service if it is no longer used.`,
    evidence,
  });
}

/**
 * Railway App Availability
 *
 * Every long-running service in a production environment must have a
 * deployment serving traffic. Cron services are skipped: they exit between
 * runs by design, so "not running" says nothing about availability.
 *
 * Maps to: App Availability
 */
export const appAvailabilityCheck: IntegrationCheck = {
  id: 'railway-app-availability',
  name: 'App Availability',
  description: 'Verify every Railway production service has a live deployment',
  service: 'inventory',
  taskMapping: TASK_TEMPLATES.appAvailability,
  defaultSeverity: 'medium',

  run: async (ctx: CheckContext) => {
    ctx.log('Starting Railway app availability check');

    const scope = await resolveRailwayScope(ctx);
    if (!scope) return;
    const { checkedAt } = scope;
    let judged = 0;

    for (const workspace of scope.workspaces) {
      const loaded = await loadInstances(ctx, { workspace, checkedAt, selection: 'deployments' });
      if (!loaded) continue;

      const production = loaded.instances.filter(
        (scoped) => isProductionInstance(scoped) && !scoped.instance.cronSchedule,
      );

      if (production.length === 0) {
        ctx.fail({
          title: `No production services in ${workspace.name}`,
          description: `None of the ${loaded.projects.length} project(s) in "${workspace.name}" has a long-running service in a production environment, so availability cannot be evidenced.`,
          resourceType: 'railway_workspace',
          resourceId: `${workspace.id}:production`,
          severity: 'low',
          remediation:
            'If production runs on Railway, name its environment "production" or make it the project\'s primary environment, then re-run the check.',
          evidence: {
            workspaceId: workspace.id,
            projectCount: loaded.projects.length,
            serviceInstanceCount: loaded.instances.length,
            checkedAt,
          },
        });
        continue;
      }

      for (const scoped of production) {
        judged++;
        judgeInstance(ctx, scoped, checkedAt);
      }
    }

    ctx.log(`Railway app availability check complete: ${judged} production service(s) reviewed`);
  },
};
