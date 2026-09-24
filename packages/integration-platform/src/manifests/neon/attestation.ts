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
 * 'provider-attested'` plus a nested `attestation` block naming Neon as the
 * party making the claim. Results that read a real API field carry
 * `verification: 'api-verified'` instead.
 */

export const NEON_SECURITY_DOCS_URL = 'https://neon.com/docs/security/security-overview';

type VerificationMethod = 'api-verified' | 'provider-attested';

/** Stamped on every result whose claim comes from a field Neon actually returned. */
export const API_VERIFIED: VerificationMethod = 'api-verified';

/** Stamped on every result that rests on Neon's own published claim. */
const PROVIDER_ATTESTED: VerificationMethod = 'provider-attested';

/** The party making these claims. Recorded on every attested result. */
const ATTESTING_PARTY = 'Neon';

/**
 * Where the claims come from. Neon's public security documentation is a
 * vendor self-assertion — not a SOC 2 report, not a signed attestation letter,
 * and not anything this check observed. Naming the kind of source keeps an
 * auditor from over-weighting it.
 */
const ATTESTATION_TYPE = 'vendor-published-documentation';

/**
 * When the statements below were last read against Neon's published source.
 *
 * Bump this whenever the wording is re-checked. Vendor documentation changes
 * without notice, and evidence that quotes it is only as current as the day
 * someone last looked — an auditor is entitled to know which day that was.
 */
const ATTESTATION_REVIEWED_ON = '2026-09-15';

const NOT_VERIFIED_NOTE =
  "Neon exposes no API field for this control, so this result records Neon's own published claim rather than a setting inspected on the resource. It has not been independently verified by this check; weigh it as vendor-supplied evidence.";

export const NEON_ATTESTATION = {
  /** Branchable object storage — the buckets a customer creates on a branch. */
  objectStorage: {
    control: 'Encryption at rest for Neon object storage',
    statement:
      'Objects in Neon branchable object storage are persisted to cloud object storage (Amazon S3, Azure Blob Storage) with server-side encryption (SSE) and versioning enabled. Encryption is applied by the platform and has no per-bucket setting, so it cannot be turned off for an individual bucket.',
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

/**
 * Spread into a result's `evidence` so the basis of every claim is on the
 * record.
 *
 * The attested part is kept in its own nested block rather than flattened
 * alongside API-read fields, so a reader can see at a glance which half of a
 * result Neon asserted and which half was read from the API. `attestedBy` and
 * `independentlyVerified` are the two fields that carry that distinction — a
 * source URL alone leaves the reader to infer who is speaking.
 */
export function attestationEvidence(attestation: NeonAttestation): Record<string, unknown> {
  return {
    verification: PROVIDER_ATTESTED,
    attestation: {
      attestedBy: ATTESTING_PARTY,
      attestationType: ATTESTATION_TYPE,
      independentlyVerified: false,
      control: attestation.control,
      statement: attestation.statement,
      algorithm: attestation.algorithm,
      source: attestation.source,
      sourceCheckedOn: ATTESTATION_REVIEWED_ON,
      note: NOT_VERIFIED_NOTE,
    },
  };
}

/**
 * The human-readable half of an attested result.
 *
 * Several of Neon's statements are written as plain fact ("All customer data
 * is encrypted at rest..."), which reads as this check's own finding once it
 * is dropped into a description. Attributing it inline keeps the speaker
 * visible to anyone reading the result rather than the evidence JSON.
 *
 * @param coverage what this result covers, e.g. `bucket "avatars" on project "alpha"`
 */
export function attestedClaim(attestation: NeonAttestation, coverage: string): string {
  return `${ATTESTING_PARTY} attests: "${attestation.statement}" This claim covers ${coverage}. ${ATTESTING_PARTY} exposes no API field for this control, so it is recorded as ${ATTESTING_PARTY}'s own statement and has not been independently verified.`;
}
