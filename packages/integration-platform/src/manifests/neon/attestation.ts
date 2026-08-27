/**
 * Neon's provider-enforced controls.
 *
 * Encryption and TLS on Neon are platform properties, not per-project
 * toggles: there is no API field to read back, because there is no way for a
 * customer to turn either off. A check covering one of them therefore cannot
 * "verify" it the way an S3 bucket policy can be verified. What it can do is
 * pair Neon's published attestation with the concrete inventory the run
 * covered, and say plainly which of the two the evidence is — so an auditor
 * reading the result is never misled into thinking a per-resource setting was
 * inspected.
 *
 * Every result built from these constants carries `verification:
 * 'provider-attested'`. Results that read a real API field carry
 * `verification: 'api-verified'` instead.
 */

export const NEON_SECURITY_DOCS_URL = 'https://neon.com/docs/security/security-overview';

export type VerificationMethod = 'api-verified' | 'provider-attested';

/** Stamped on every result whose claim comes from a field Neon actually returned. */
export const API_VERIFIED: VerificationMethod = 'api-verified';

export const NEON_ATTESTATION = {
  /** Object storage holding branch data and backups (Amazon S3 / Azure Blob Storage). */
  objectStorage: {
    control: 'Encryption at rest for Neon object storage',
    statement:
      'Neon stores customer data backups in cloud object storage (Amazon S3, Azure Blob Storage) with server-side encryption (SSE) and versioning enabled. Encryption is applied by the platform and cannot be disabled per project.',
    algorithm: 'AES-256',
    source: NEON_SECURITY_DOCS_URL,
  },
  /** Compute/instance storage backing a running database. */
  databaseStorage: {
    control: 'Encryption at rest for Neon database storage',
    statement:
      'All customer and sensitive data is encrypted at rest using AES-256. Data on NVMe instance storage is encrypted with an AES-256 block cipher implemented in a hardware module on the instance. Keys are managed in AWS KMS and Azure Key Vault.',
    algorithm: 'AES-256',
    source: NEON_SECURITY_DOCS_URL,
  },
  /** TLS on the Postgres wire protocol. */
  transportSecurity: {
    control: 'Encryption in transit for Neon database connections',
    statement:
      'Neon requires that all connections use SSL/TLS encryption and supports the verify-full SSL mode, the strictest mode Postgres provides. TLS 1.2/1.3 is enforced; connections that do not negotiate TLS are rejected at the Neon proxy.',
    algorithm: 'TLS 1.2/1.3',
    source: NEON_SECURITY_DOCS_URL,
  },
} as const;

export type NeonAttestation = (typeof NEON_ATTESTATION)[keyof typeof NEON_ATTESTATION];

/** Spread into a result's `evidence` so the basis of every claim is on the record. */
export function attestationEvidence(attestation: NeonAttestation): Record<string, unknown> {
  return {
    verification: 'provider-attested' satisfies VerificationMethod,
    control: attestation.control,
    providerStatement: attestation.statement,
    algorithm: attestation.algorithm,
    attestationSource: attestation.source,
  };
}
