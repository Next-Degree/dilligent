import { TASK_TEMPLATES } from '../../../task-mappings';
import { NEON_ATTESTATION } from '../attestation';
import { createAttestedEncryptionCheck } from './attested-encryption';

/**
 * Neon Database Encrypted
 *
 * Covers the compute/instance storage a running Neon database sits on, which
 * Neon encrypts with an AES-256 block cipher in a hardware module, with keys
 * held in AWS KMS or Azure Key Vault.
 *
 * Maps to: Encryption at Rest
 */
export const databaseEncryptionCheck = createAttestedEncryptionCheck({
  id: 'database-encrypted',
  name: 'Database Encrypted',
  description: 'Evidence that Neon database storage is encrypted at rest with AES-256',
  service: 'security',
  taskMapping: TASK_TEMPLATES.encryptionAtRest,
  severity: 'high',
  attestation: NEON_ATTESTATION.databaseStorage,
  passTitle: (project) => `Database encrypted: ${project.name ?? project.id}`,
  layerEvidence: (project) => ({
    storageLayer: 'database',
    keyManagement: 'AWS KMS / Azure Key Vault',
    postgresVersion: project.pg_version ?? null,
    hipaaMode: project.settings?.hipaa ?? null,
    createdAt: project.created_at ?? null,
  }),
});
