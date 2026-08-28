import { TASK_TEMPLATES } from '../../../task-mappings';
import type { CheckContext, IntegrationCheck } from '../../../types';
import { remediationForReadFailure, toHttpReadFailure } from '../../http-read-failure';
import { API_VERIFIED } from '../attestation';
import { listNeonEndpoints } from '../client';
import { limitProjects, projectEvidence, resolveNeonScope } from '../scope';
import type { NeonEndpoint } from '../types';
import { projectScopeVariables } from '../variables';

/** Neon scales computes to zero when idle, so `idle` is healthy, not down. */
const HEALTHY_STATES: ReadonlySet<string> = new Set(['active', 'idle', 'init']);

const isServing = (endpoint: NeonEndpoint): boolean =>
  endpoint.disabled !== true &&
  (endpoint.current_state === undefined || HEALTHY_STATES.has(endpoint.current_state));

/**
 * Neon App Availability
 *
 * Verifies each project still has a compute endpoint able to serve
 * connections. A suspended compute is expected — Neon scales to zero — so
 * only a disabled or unhealthy endpoint counts against availability.
 *
 * Maps to: App Availability
 */
export const appAvailabilityCheck: IntegrationCheck = {
  id: 'app-availability',
  name: 'App Availability',
  description: 'Verify Neon projects have a compute endpoint able to serve database connections',
  service: 'inventory',
  taskMapping: TASK_TEMPLATES.appAvailability,
  defaultSeverity: 'medium',
  variables: projectScopeVariables,

  run: async (ctx: CheckContext) => {
    ctx.log('Starting Neon app availability check');

    const scope = await resolveNeonScope(ctx);
    if (!scope) return;

    const projects = limitProjects(ctx, scope);
    let availableCount = 0;

    for (const project of projects) {
      const name = project.name ?? project.id;

      let endpoints: NeonEndpoint[];
      try {
        endpoints = await listNeonEndpoints(ctx, project.id);
      } catch (error) {
        const failure = toHttpReadFailure(error);
        ctx.fail({
          title: `Availability unknown: ${name}`,
          description: `Could not read the project's compute endpoints: ${failure.error}`,
          resourceType: 'neon_project',
          resourceId: project.id,
          severity: 'medium',
          remediation: remediationForReadFailure(
            failure,
            'Confirm the Neon API key still has access to this project, then re-run the check.',
          ),
          evidence: {
            ...projectEvidence(project),
            error: failure.error,
            denied: failure.denied,
            checkedAt: scope.checkedAt,
          },
        });
        continue;
      }

      const serving = endpoints.filter(isServing);
      const readWrite = serving.filter((endpoint) => endpoint.type !== 'read_only');
      const evidence = {
        verification: API_VERIFIED,
        ...projectEvidence(project),
        endpointCount: endpoints.length,
        servingEndpointCount: serving.length,
        readWriteEndpointCount: readWrite.length,
        endpointStates: endpoints.map((endpoint) => ({
          endpointId: endpoint.id,
          type: endpoint.type ?? null,
          disabled: endpoint.disabled ?? false,
          currentState: endpoint.current_state ?? null,
          lastActive: endpoint.last_active ?? null,
        })),
        checkedAt: scope.checkedAt,
      };

      if (readWrite.length > 0) {
        availableCount++;
        ctx.pass({
          title: `Available: ${name}`,
          description: `${readWrite.length} read-write compute endpoint(s) are able to serve connections. Suspended computes resume on the next connection.`,
          resourceType: 'neon_project',
          resourceId: project.id,
          evidence,
        });
        continue;
      }

      ctx.fail({
        title: `Unavailable: ${name}`,
        description:
          endpoints.length === 0
            ? `Neon project "${name}" has no compute endpoints, so no application can connect to it.`
            : `None of the ${endpoints.length} compute endpoint(s) on "${name}" can serve read-write connections.`,
        resourceType: 'neon_project',
        resourceId: project.id,
        severity: 'medium',
        remediation:
          'Create or re-enable a read-write compute for the project in Neon Console > Branches > Computes, or remove the project if it is no longer in use.',
        evidence,
      });
    }

    ctx.log(
      `Neon app availability check complete: ${availableCount}/${projects.length} project(s) available`,
    );
  },
};
