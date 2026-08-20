import { Injectable } from '@nestjs/common';
import { db } from '@db';

/**
 * Reads of observed access, from both directions: who can reach this vendor, and what can
 * this person reach.
 *
 * Note what these deliberately do not report: a last-used timestamp. The Tokens API carries
 * no recency signal, so callers can only say access was *authorized*, never that it was
 * recently used. Presenting it as usage would misrepresent the evidence.
 */
@Injectable()
export class VendorAccessService {
  /** Members holding active grants for a vendor. */
  async listForVendor({
    organizationId,
    vendorId,
  }: {
    organizationId: string;
    vendorId: string;
  }) {
    return db.vendorAccessGrant.findMany({
      where: { organizationId, vendorId, revokedAt: null },
      orderBy: { firstSeenAt: 'asc' },
      select: {
        id: true,
        scopes: true,
        source: true,
        firstSeenAt: true,
        lastSeenAt: true,
        member: {
          select: {
            id: true,
            isActive: true,
            user: { select: { name: true, email: true } },
          },
        },
      },
    });
  }

  /**
   * Everything a member holds access to, withdrawn grants included.
   *
   * Withdrawn grants are returned rather than filtered out so a reviewer can see that access
   * used to exist — the absence of a row and the presence of a revoked row mean very
   * different things during an offboarding review.
   */
  async listForMember({
    organizationId,
    memberId,
  }: {
    organizationId: string;
    memberId: string;
  }) {
    return db.vendorAccessGrant.findMany({
      where: { organizationId, memberId },
      orderBy: [{ revokedAt: 'asc' }, { lastSeenAt: 'desc' }],
      select: {
        id: true,
        scopes: true,
        source: true,
        externalAppId: true,
        firstSeenAt: true,
        lastSeenAt: true,
        revokedAt: true,
        revokedReason: true,
        reappearedAt: true,
        vendor: { select: { id: true, name: true, website: true } },
        candidate: {
          select: { id: true, displayName: true, status: true, resolvedName: true },
        },
      },
    });
  }
}
