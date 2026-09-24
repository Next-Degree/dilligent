import { TASK_TEMPLATES } from '../../../task-mappings';
import type { CheckContext, IntegrationCheck } from '../../../types';
import { toHttpReadFailure } from '../../http-read-failure';
import {
  getCurrentProductionWorker,
  listEnvironments,
  listRecentRuns,
  projectUrl,
} from '../client';
import { resolveProjects } from '../scope';
import type {
  TriggerCurrentWorkerResponse,
  TriggerEnvironment,
  TriggerProject,
  TriggerRun,
} from '../types';
import {
  DEFAULT_MAX_FAILURE_RATE_PERCENT,
  DEFAULT_MIN_RUNS_FOR_FAILURE_RATE,
  DEFAULT_RUN_LOOKBACK_DAYS,
  maxFailureRatePercentVariable,
  minRunsForFailureRateVariable,
  parsePercent,
  parsePositiveInteger,
  runLookbackDaysVariable,
  targetOrganizationsVariable,
} from '../variables';

/**
 * Terminal statuses that mean a run did not do its job. EXPIRED is included: the run's
 * TTL passed before any worker picked it up, which is an availability failure.
 */
const FAILED_STATUSES: ReadonlySet<string> = new Set([
  'FAILED',
  'CRASHED',
  'SYSTEM_FAILURE',
  'TIMED_OUT',
  'EXPIRED',
]);

export interface RunStats {
  total: number;
  completed: number;
  failed: number;
  /** Finished runs the rate is measured over; canceled and in-flight runs are excluded. */
  finished: number;
  failureRatePercent: number | null;
  failedByStatus: Record<string, number>;
}

export function summarizeRuns(runs: TriggerRun[]): RunStats {
  let completed = 0;
  const failedByStatus: Record<string, number> = {};
  for (const run of runs) {
    if (run.status === 'COMPLETED') completed++;
    if (FAILED_STATUSES.has(run.status)) {
      failedByStatus[run.status] = (failedByStatus[run.status] ?? 0) + 1;
    }
  }
  const failed = Object.values(failedByStatus).reduce((sum, count) => sum + count, 0);
  const finished = completed + failed;
  return {
    total: runs.length,
    completed,
    failed,
    finished,
    failureRatePercent: finished > 0 ? Math.round((failed / finished) * 1000) / 10 : null,
    failedByStatus,
  };
}

const deploymentsUrl = (project: TriggerProject) => `${projectUrl(project)}/env/prod/deployments`;

/**
 * Trigger.dev App Availability
 *
 * Verifies each project's production environment is live: it exists, is not paused,
 * has a deployed version with tasks serving it, and its recent runs are not failing
 * above the configured rate. A project with no runs in the window still passes — many
 * task sets only run on demand — and the run count is recorded as evidence.
 *
 * Maps to: App Availability
 */
export const appAvailabilityCheck: IntegrationCheck = {
  id: 'app-availability',
  name: 'App Availability',
  description:
    'Verify each Trigger.dev project has a live, unpaused production deployment whose runs are succeeding',
  service: 'monitoring',
  taskMapping: TASK_TEMPLATES.appAvailability,
  defaultSeverity: 'medium',
  variables: [
    targetOrganizationsVariable,
    runLookbackDaysVariable,
    maxFailureRatePercentVariable,
    minRunsForFailureRateVariable,
  ],

  run: async (ctx: CheckContext) => {
    ctx.log('Starting Trigger.dev app availability check');

    const scope = await resolveProjects(ctx);
    if (!scope) return;

    const lookbackDays = parsePositiveInteger(
      ctx.variables,
      runLookbackDaysVariable.id,
      DEFAULT_RUN_LOOKBACK_DAYS,
    );
    const maxFailureRate = parsePercent(
      ctx.variables,
      maxFailureRatePercentVariable.id,
      DEFAULT_MAX_FAILURE_RATE_PERCENT,
    );
    const minRuns = parsePositiveInteger(
      ctx.variables,
      minRunsForFailureRateVariable.id,
      DEFAULT_MIN_RUNS_FOR_FAILURE_RATE,
    );

    for (const project of scope.projects) {
      const base = {
        projectRef: project.externalRef,
        project: project.name,
        organization: project.organization.slug,
        checkedAt: scope.checkedAt,
      };
      const failProject = (finding: {
        title: string;
        description: string;
        remediation: string;
        evidence: Record<string, unknown>;
        severity?: 'medium' | 'high';
      }) =>
        ctx.fail({
          title: `${finding.title}: ${project.name}`,
          description: finding.description,
          resourceType: 'trigger_dev_project',
          resourceId: project.externalRef,
          severity: finding.severity ?? 'medium',
          remediation: finding.remediation,
          evidence: { ...base, ...finding.evidence },
        });

      let production: TriggerEnvironment | undefined;
      let worker: TriggerCurrentWorkerResponse | null;
      try {
        production = (await listEnvironments(ctx, project.externalRef)).find(
          (env) => env.type === 'PRODUCTION',
        );
        worker = production ? await getCurrentProductionWorker(ctx, project.externalRef) : null;
      } catch (error) {
        const failure = toHttpReadFailure(error);
        failProject({
          title: 'Availability unknown',
          description: `Could not read the production environment: ${failure.error}`,
          remediation:
            'Confirm the Personal Access Token can read this project and its deployments, then re-run the check.',
          evidence: { error: failure.error, denied: failure.denied },
        });
        continue;
      }

      if (!production) {
        failProject({
          title: 'No production environment',
          description: `Project "${project.name}" has no Production environment, so nothing is serving it.`,
          remediation:
            'Deploy with `npx trigger.dev@latest deploy`, or remove the project if it is no longer in use.',
          evidence: {},
        });
        continue;
      }

      if (production.paused) {
        failProject({
          title: 'Production paused',
          description: `The Production environment of "${project.name}" is paused: runs are queued but none execute.`,
          remediation: `Resume the environment from the Trigger.dev dashboard (${deploymentsUrl(project)}) once the reason for pausing is resolved.`,
          evidence: { paused: true },
          severity: 'high',
        });
        continue;
      }

      if (!worker || worker.worker.tasks.length === 0) {
        failProject({
          title: 'No live production deployment',
          description: worker
            ? `The current production version ${worker.worker.version} of "${project.name}" contains no tasks.`
            : `"${project.name}" has no version deployed to Production.`,
          remediation: `Deploy with \`npx trigger.dev@latest deploy\` and confirm it is promoted to current under ${deploymentsUrl(project)}.`,
          evidence: { paused: false, deployedVersion: worker?.worker.version ?? null },
          severity: 'high',
        });
        continue;
      }

      const deployed = {
        version: worker.worker.version,
        sdkVersion: worker.worker.sdkVersion ?? null,
        taskCount: worker.worker.tasks.length,
      };

      let stats: RunStats;
      let truncated: boolean;
      try {
        const result = await listRecentRuns(ctx, {
          projectRef: project.externalRef,
          environmentSlug: production.slug,
          period: `${lookbackDays}d`,
        });
        stats = summarizeRuns(result.runs);
        truncated = result.truncated;
      } catch (error) {
        const failure = toHttpReadFailure(error);
        failProject({
          title: 'Run health unknown',
          description: `"${project.name}" has a live production deployment, but its recent runs could not be read: ${failure.error}`,
          remediation:
            'Confirm the Personal Access Token can read runs for this project, then re-run the check.',
          evidence: { paused: false, deployed, error: failure.error, denied: failure.denied },
        });
        continue;
      }

      const runEvidence = {
        paused: false,
        deployed,
        runs: { ...stats, lookbackDays, sampled: truncated },
        maxFailureRatePercent: maxFailureRate,
        minRunsForFailureRate: minRuns,
      };

      const rate = stats.failureRatePercent;
      if (rate !== null && stats.finished >= minRuns && rate > maxFailureRate) {
        failProject({
          title: 'Production runs failing',
          description: `${stats.failed} of ${stats.finished} finished production runs (${rate}%) failed in the last ${lookbackDays} day(s), above the ${maxFailureRate}% limit.`,
          remediation: `Investigate the failing runs in the Trigger.dev dashboard and fix or roll back the deployment (${deploymentsUrl(project)}).`,
          evidence: runEvidence,
        });
        continue;
      }

      const live = `Version ${deployed.version} is live in Production with ${deployed.taskCount} task(s)`;
      ctx.pass({
        title: `Available: ${project.name}`,
        description:
          stats.finished === 0
            ? `${live}. No runs finished in the last ${lookbackDays} day(s).`
            : `${live}; ${stats.completed} of ${stats.finished} finished runs succeeded in the last ${lookbackDays} day(s).`,
        resourceType: 'trigger_dev_project',
        resourceId: project.externalRef,
        evidence: { ...base, ...runEvidence },
      });
    }

    ctx.log(`Trigger.dev app availability check complete: ${scope.projects.length} project(s)`);
  },
};
