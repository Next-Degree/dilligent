import { TASK_TEMPLATES } from '../../../task-mappings';
import { createStoreAttestationCheck } from './store-attestation';

const STORAGE_SERVICE = 'storage';

/**
 * Vercel bucket encrypted
 *
 * Inventories Vercel Blob stores and evidences encryption at rest. Vercel Blob
 * has no per-store encryption toggle — objects are encrypted at rest by the
 * platform — so the store inventory is the evidence. A Marketplace object store
 * is reported instead, because its provider's encryption is not Vercel's to
 * attest.
 *
 * Maps to: Encryption at Rest
 */
export const bucketEncryptedCheck = createStoreAttestationCheck(
  {
    id: 'bucket-encrypted',
    name: 'Vercel bucket encrypted',
    description: 'Verify every Vercel Blob store holds its objects encrypted at rest',
    taskMapping: TASK_TEMPLATES.encryptionAtRest,
    defaultSeverity: 'medium',
    classes: ['blob'],
    resourceType: 'blob-store',
    summaryResourceId: 'bucket-encryption',
    nounPlural: 'Blob stores',
    property: 'Encryption at rest',
    guarantee:
      'Vercel Blob encrypts every object at rest on the underlying object storage; there is no per-store setting that can turn it off.',
    externalEvidence: 'Encryption at rest for this bucket is the provider’s to evidence.',
  },
  STORAGE_SERVICE,
);

/**
 * Vercel relational database encrypted
 *
 * Covers Vercel Postgres and Marketplace SQL databases (Neon, Supabase,
 * PlanetScale, …) attached to the team.
 *
 * Maps to: Encryption at Rest
 */
export const relationalDatabaseEncryptedCheck = createStoreAttestationCheck(
  {
    id: 'relational-database-encrypted',
    name: 'Vercel relational database encrypted',
    description: 'Verify relational databases attached to Vercel are encrypted at rest',
    taskMapping: TASK_TEMPLATES.encryptionAtRest,
    defaultSeverity: 'medium',
    classes: ['relational'],
    resourceType: 'relational-database',
    summaryResourceId: 'relational-database-encryption',
    nounPlural: 'relational databases',
    property: 'Encryption at rest',
    guarantee:
      'Vercel Postgres stores data on encrypted volumes; encryption at rest is applied by the platform and is not a per-database setting.',
    externalEvidence: 'Encryption at rest for this database is the provider’s to evidence.',
  },
  STORAGE_SERVICE,
);

/**
 * Vercel non-relational database encrypted
 *
 * Covers Vercel KV/Redis, Edge Config (Global Config) and Marketplace key-value
 * or document stores attached to the team.
 *
 * Maps to: Encryption at Rest
 */
export const nonRelationalDatabaseEncryptedCheck = createStoreAttestationCheck(
  {
    id: 'non-relational-database-encrypted',
    name: 'Vercel non-relational database encrypted',
    description: 'Verify key-value and document stores attached to Vercel are encrypted at rest',
    taskMapping: TASK_TEMPLATES.encryptionAtRest,
    defaultSeverity: 'medium',
    classes: ['non-relational'],
    resourceType: 'non-relational-database',
    summaryResourceId: 'non-relational-database-encryption',
    nounPlural: 'non-relational databases',
    property: 'Encryption at rest',
    guarantee:
      'Vercel KV/Redis and Edge Config keep their data on encrypted storage; encryption at rest is applied by the platform and is not a per-store setting.',
    externalEvidence: 'Encryption at rest for this store is the provider’s to evidence.',
  },
  STORAGE_SERVICE,
);

/**
 * Vercel databases enforce SSL connection
 *
 * Covers every database attached to the team, relational and non-relational
 * alike, and evidences that connections to it are encrypted in transit.
 *
 * Maps to: TLS / HTTPS
 */
export const databasesEnforceSslCheck = createStoreAttestationCheck(
  {
    id: 'databases-enforce-ssl',
    name: 'Vercel databases enforce SSL connection',
    description: 'Verify databases attached to Vercel only accept TLS-encrypted connections',
    taskMapping: TASK_TEMPLATES.tlsHttps,
    defaultSeverity: 'high',
    classes: ['relational', 'non-relational'],
    resourceType: 'database',
    summaryResourceId: 'database-ssl',
    nounPlural: 'databases',
    property: 'TLS-only connections',
    guarantee:
      'Vercel-run databases terminate TLS and reject plaintext connections: Postgres connection strings are issued with sslmode=require, and KV/Redis and Edge Config are reachable only over TLS endpoints.',
    externalEvidence:
      'Whether this database refuses plaintext connections is the provider’s to evidence.',
  },
  STORAGE_SERVICE,
);
