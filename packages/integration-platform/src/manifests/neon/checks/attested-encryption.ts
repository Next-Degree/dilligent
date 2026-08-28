import type { TaskTemplateId } from '../../../task-mappings';
import type { CheckContext, FindingSeverity, IntegrationCheck } from '../../../types';
import { attestationEvidence, type NeonAttestation } from '../attestation';
import { projectEvidence, resolveNeonScope } from '../scope';
import type { NeonProject } from '../types';
import { projectScopeVariables } from '../variables';

/**
 * Builds an encryption-at-rest check for one Neon storage layer.
 *
 * Neon exposes no per-project encryption field, because encryption is applied
 * by the platform and cannot be turned off. Rather than invent a setting to
 * read, each project passes on Neon's published attestation paired with the
 * inventory this run actually covered, and every result says which of the two
 * it rests on (`verification: 'provider-attested'`). A project the run could
 * not read is a failure, not a quiet omission — the attestation only covers
 * projects we can name.
 */
export function createAttestedEncryptionCheck(options: {
  id: string;
  name: string;
  description: string;
  service: string;
  taskMapping: TaskTemplateId;
  severity: FindingSeverity;
  attestation: NeonAttestation;
  /** What the passing title calls the thing covered, e.g. "Object storage encrypted". */
  passTitle: (project: NeonProject) => string;
  /** Per-project fields worth recording for this storage layer. */
  layerEvidence: (project: NeonProject) => Record<string, unknown>;
}): IntegrationCheck {
  return {
    id: options.id,
    name: options.name,
    description: options.description,
    service: options.service,
    taskMapping: options.taskMapping,
    defaultSeverity: options.severity,
    variables: projectScopeVariables,

    run: async (ctx: CheckContext) => {
      ctx.log(`Starting Neon check: ${options.name}`);

      const scope = await resolveNeonScope(ctx);
      if (!scope) return;

      const base = attestationEvidence(options.attestation);

      for (const project of scope.projects) {
        ctx.pass({
          title: options.passTitle(project),
          description: `${options.attestation.statement} This result covers Neon project "${project.name ?? project.id}".`,
          resourceType: 'neon_project',
          resourceId: project.id,
          evidence: {
            ...base,
            ...projectEvidence(project),
            ...options.layerEvidence(project),
            checkedAt: scope.checkedAt,
          },
        });
      }

      ctx.pass({
        title: options.attestation.control,
        description: `${scope.projects.length} of ${scope.totalProjectCount} Neon project(s) are covered by ${options.attestation.algorithm} encryption at rest.`,
        resourceType: 'neon',
        resourceId: options.id,
        evidence: {
          ...base,
          coveredProjectCount: scope.projects.length,
          totalProjectCount: scope.totalProjectCount,
          coveredProjectIds: scope.projects.map((project) => project.id),
          filterMode: scope.filter.mode,
          checkedAt: scope.checkedAt,
        },
      });

      ctx.log(`Neon check complete: ${options.name} (${scope.projects.length} project(s))`);
    },
  };
}
