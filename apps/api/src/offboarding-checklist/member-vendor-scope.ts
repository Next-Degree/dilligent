import { db } from '@db';

export interface MemberVendorScope {
  /** Vendor ids this member holds active observed grants for. */
  observedVendorIds: Set<string>;
  /**
   * False when the organization has no observed access at all, meaning callers must fall
   * back to the full register rather than treating an empty set as "no access".
   */
  hasObservation: boolean;
}

/**
 * Which vendors an offboarding actually concerns for one member.
 *
 * Shared by the checklist read and the bulk-revoke write so the two can never disagree —
 * a checklist showing three vendors while "revoke all" attests to thirty would put
 * statements in the audit trail that nobody made.
 *
 * The observation check is organization-wide on purpose. A member with genuinely no grants
 * is a real answer worth showing; an organization with no grants anywhere means discovery
 * has never run, and an empty list there means nothing at all.
 */
export async function getMemberVendorScope({
  organizationId,
  memberId,
}: {
  organizationId: string;
  memberId: string;
}): Promise<MemberVendorScope> {
  const [anyGrant, grants] = await Promise.all([
    db.vendorAccessGrant.findFirst({
      where: { organizationId },
      select: { id: true },
    }),
    db.vendorAccessGrant.findMany({
      where: { organizationId, memberId, revokedAt: null, vendorId: { not: null } },
      select: { vendorId: true },
    }),
  ]);

  return {
    hasObservation: anyGrant !== null,
    observedVendorIds: new Set(
      grants.map((grant) => grant.vendorId).filter((id): id is string => id !== null),
    ),
  };
}
