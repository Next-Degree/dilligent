/**
 * Railway's provider-enforced edge TLS.
 *
 * Railway's edge rejects plaintext for public HTTP traffic: there is no
 * per-domain switch to read, because a customer cannot turn it off. What the
 * API can prove per domain is the certificate state, which the TLS check reads.
 * The edge behaviour itself is Railway's published claim, and results built on
 * it say so: `verification: 'provider-attested'` plus the source, mirroring the
 * Neon manifest's attestation shape.
 */
export const EDGE_TLS_ATTESTATION = {
  verification: 'provider-attested',
  attestation: {
    attestedBy: 'Railway',
    attestationType: 'vendor-published-documentation',
    independentlyVerified: false,
    control: 'Encryption in transit for Railway public domains',
    statement:
      "All traffic must be HTTPS and use TLS 1.2 or above, and TLS SNI is mandatory. Plain HTTP GET requests are redirected to HTTPS with a 301 response. Railway provides Let's Encrypt certificates using ECDSA keys, valid for 90 days and renewed automatically.",
    algorithm: 'TLS 1.2/1.3',
    source: 'https://docs.railway.com/networking/public-networking/specs-and-limits',
    /** Bump whenever the statement is re-checked against the source. */
    sourceCheckedOn: '2026-09-25',
    note: "Railway exposes no API field for edge TLS enforcement, so this records Railway's own published claim rather than a setting inspected on the domain.",
  },
} as const;
