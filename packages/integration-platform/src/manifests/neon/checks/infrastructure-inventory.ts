import { TASK_TEMPLATES } from '../../../task-mappings';
import type { CheckContext, IntegrationCheck } from '../../../types';
import { API_VERIFIED } from '../attestation';
import { projectEvidence, resolveNeonScope } from '../scope';
import { projectScopeVariables } from '../variables';

/**
 * Neon Infrastructure Inventory
 *
 * Records the Neon projects this connection covers, so the database tier of
 * the infrastructure inventory is evidenced from the provider rather than
 * maintained by hand.
 *
 * Maps to: Infrastructure Inventory
 */
export const infrastructureInventoryCheck: IntegrationCheck = {
  id: 'infrastructure-inventory',
  name: 'Infrastructure Inventory',
  description: 'Record Neon projects as part of the database infrastructure inventory',
  service: 'inventory',
  taskMapping: TASK_TEMPLATES.infrastructureInventory,
  defaultSeverity: 'low',
  variables: projectScopeVariables,

  run: async (ctx: CheckContext) => {
    ctx.log('Starting Neon infrastructure inventory');

    const scope = await resolveNeonScope(ctx);
    if (!scope) return;

    for (const project of scope.projects) {
      ctx.pass({
        title: `Neon project: ${project.name ?? project.id}`,
        description: `Serverless Postgres project in ${project.region_id ?? 'an unreported region'} running Postgres ${project.pg_version ?? 'unknown'}.`,
        resourceType: 'neon_project',
        resourceId: project.id,
        evidence: {
          verification: API_VERIFIED,
          ...projectEvidence(project),
          postgresVersion: project.pg_version ?? null,
          platformId: project.platform_id ?? null,
          storageBytes: project.synthetic_storage_size ?? null,
          historyRetentionSeconds: project.history_retention_seconds ?? null,
          createdAt: project.created_at ?? null,
          updatedAt: project.updated_at ?? null,
          checkedAt: scope.checkedAt,
        },
      });
    }

    ctx.pass({
      title: 'Neon infrastructure inventory',
      description: `${scope.projects.length} of ${scope.totalProjectCount} Neon project(s) recorded across ${scope.organizations.length} organization(s).`,
      resourceType: 'neon',
      resourceId: 'infrastructure-inventory',
      evidence: {
        verification: API_VERIFIED,
        projectCount: scope.projects.length,
        totalProjectCount: scope.totalProjectCount,
        projectIds: scope.projects.map((project) => project.id),
        organizationIds: scope.organizations.map((org) => org.id),
        regions: Array.from(
          new Set(scope.projects.map((project) => project.region_id).filter(Boolean)),
        ),
        filterMode: scope.filter.mode,
        checkedAt: scope.checkedAt,
      },
    });

    ctx.log(`Neon inventory complete: ${scope.projects.length} project(s)`);
  },
};
