import {
  db,
  DiscoveredVendorSource,
  VendorAccessGrantRevokedReason,
  VendorAccessGrantSource,
} from '@db';

/**
 * The write half of reconciliation: concluding, from a complete observation, that access that
 * used to be there is gone.
 *
 * Everything here is gated on the trust predicate in `grant-reconciler.ts` and must only ever
 * be called for a run known to be complete. Called against a degraded run these functions
 * would report an outage as an organization-wide offboarding.
 */

/** Mark active grants absent from a complete observation as withdrawn. */
export async function withdrawUnobservedGrants({
  organizationId,
  source,
  observedGrantKeys,
  observedAt,
}: {
  organizationId: string;
  source: VendorAccessGrantSource;
  /** `${memberId}:${externalAppId}` for every grant the run actually saw. */
  observedGrantKeys: Set<string>;
  observedAt: Date;
}): Promise<number> {
  const active = await db.vendorAccessGrant.findMany({
    where: { organizationId, source, revokedAt: null },
    select: { id: true, memberId: true, externalAppId: true },
  });

  const staleIds = active
    .filter((grant) => !observedGrantKeys.has(`${grant.memberId}:${grant.externalAppId}`))
    .map((grant) => grant.id);

  if (staleIds.length === 0) return 0;

  const { count } = await db.vendorAccessGrant.updateMany({
    where: { id: { in: staleIds } },
    data: {
      revokedAt: observedAt,
      revokedReason: VendorAccessGrantRevokedReason.not_observed,
    },
  });
  return count;
}

/**
 * Mark candidates a complete observation no longer reports as disappeared.
 *
 * The row is retained rather than deleted — an app the organization used to depend on is
 * part of its history, and deleting it would also orphan the record of who had access.
 */
export async function markDisappearedCandidates({
  organizationId,
  source,
  observedAppIds,
  observedAt,
}: {
  organizationId: string;
  source: DiscoveredVendorSource;
  observedAppIds: Set<string>;
  observedAt: Date;
}): Promise<number> {
  const candidates = await db.discoveredVendorCandidate.findMany({
    where: { organizationId, source, disappearedAt: null },
    select: {
      id: true,
      externalAppId: true,
      grants: { where: { revokedAt: null }, select: { id: true } },
    },
  });

  // A candidate is only gone once nobody holds access to it any more — an app can drop out
  // of one run's inventory while people still hold live grants recorded elsewhere.
  const goneIds = candidates
    .filter(
      (candidate) =>
        !observedAppIds.has(candidate.externalAppId) && candidate.grants.length === 0,
    )
    .map((candidate) => candidate.id);

  if (goneIds.length === 0) return 0;

  const { count } = await db.discoveredVendorCandidate.updateMany({
    where: { id: { in: goneIds } },
    data: { disappearedAt: observedAt },
  });
  return count;
}
