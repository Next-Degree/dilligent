import { TASK_TEMPLATES } from '../../../task-mappings';
import { NEON_ATTESTATION } from '../attestation';
import { createAttestedEncryptionCheck } from './attested-encryption';

/**
 * Neon Bucket Encrypted
 *
 * Neon has no customer-managed buckets: branch data and backups are persisted
 * to the provider's object storage (Amazon S3, Azure Blob Storage) with
 * server-side encryption and versioning enabled. This check evidences that
 * layer for every project in scope.
 *
 * Maps to: Secure Storage
 */
export const bucketEncryptionCheck = createAttestedEncryptionCheck({
  id: 'bucket-encrypted',
  name: 'Bucket Encrypted',
  description:
    'Evidence that the object storage holding Neon branch data and backups is encrypted at rest',
  service: 'security',
  taskMapping: TASK_TEMPLATES.secureStorage,
  severity: 'high',
  attestation: NEON_ATTESTATION.objectStorage,
  passTitle: (project) => `Object storage encrypted: ${project.name ?? project.id}`,
  layerEvidence: (project) => ({
    storageLayer: 'object-storage',
    serverSideEncryption: true,
    versioningEnabled: true,
    syntheticStorageSizeBytes: project.synthetic_storage_size ?? null,
    historyRetentionSeconds: project.history_retention_seconds ?? null,
  }),
});
