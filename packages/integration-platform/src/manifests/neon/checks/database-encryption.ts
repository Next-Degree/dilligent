import { TASK_TEMPLATES } from '../../../task-mappings';
import type { CheckContext, IntegrationCheck } from '../../../types';
import { NEON_ATTESTATION, attestationEvidence } from '../attestation';
import { projectEvidence, resolveNeonScope } from '../scope';

const ATTESTATION = NEON_ATTESTATION.databaseStorage;

/**
 * Neon Database Encrypted
 *
 * Covers the compute/instance storage a running Neon database sits on, which
 * Neon encrypts with an AES-256 block cipher in a hardware module, with keys
 * held in AWS KMS or Azure Key Vault.
 *
 * Neon exposes no per-project encryption field, because encryption is applied
 * by the platform and cannot be turned off. Rather than invent a setting to
 * read, each project passes on Neon's published attestation paired with the
 * inventory this run actually covered, and every result is stamped
 * `verification: 'provider-attested'` so a reader is never misled into
 * thinking a per-resource setting was inspected. A project the run could not
 * read is a failure upstream in `resolveNeonScope`, not a quiet omission —
 * the attestation only covers projects we can name.
 *
 * Issues no per-project request, so it needs no run cap.
 *
 * Maps to: Encryption at Rest
 */
export const databaseEncryptionCheck: IntegrationCheck = {
  id: 'database-encrypted',
  name: 'Database Encrypted',
  description: 'Evidence that Neon database storage is encrypted at rest with AES-256',
  service: 'security',
  taskMapping: TASK_TEMPLATES.encryptionAtRest,
  defaultSeverity: 'high',
  variables: [],

  run: async (ctx: CheckContext) => {
    ctx.log('Starting Neon database encryption check');

    const scope = await resolveNeonScope(ctx);
    if (!scope) return;

    const attestation = attestationEvidence(ATTESTATION);

    for (const project of scope.projects) {
      const name = project.name ?? project.id;
      ctx.pass({
        title: `Database encrypted: ${name}`,
        description: `${ATTESTATION.statement} This result covers Neon project "${name}".`,
        resourceType: 'neon_project',
        resourceId: project.id,
        evidence: {
          ...attestation,
          ...projectEvidence(project),
          storageLayer: 'database',
          keyManagement: 'AWS KMS / Azure Key Vault',
          postgresVersion: project.pg_version ?? null,
          hipaaMode: project.settings?.hipaa ?? null,
          createdAt: project.created_at ?? null,
          checkedAt: scope.checkedAt,
        },
      });
    }

    ctx.pass({
      title: ATTESTATION.control,
      description: `${scope.projects.length} of ${scope.totalProjectCount} Neon project(s) are covered by ${ATTESTATION.algorithm} encryption at rest.`,
      resourceType: 'neon',
      resourceId: 'database-encrypted',
      evidence: {
        ...attestation,
        coveredProjectCount: scope.projects.length,
        totalProjectCount: scope.totalProjectCount,
        coveredProjectIds: scope.projects.map((project) => project.id),
        filterMode: scope.filter.mode,
        checkedAt: scope.checkedAt,
      },
    });

    ctx.log(`Neon database encryption check complete: ${scope.projects.length} project(s)`);
  },
};
