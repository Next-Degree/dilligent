import { Injectable } from '@nestjs/common';
import { AttachmentEntityType, db } from '@db';
import { AttachmentsService } from '../attachments/attachments.service';
import { getMemberVendorScope } from './member-vendor-scope';
import { vendorLogoUrl } from './vendor-logo';

export type AccessProvenance = 'observed' | 'revoked-previously' | 'full-register';

export interface AccessRevocationVendor {
  vendorId: string;
  vendorName: string;
  logoUrl: string | null;
  revoked: boolean;
  revokedAt: Date | null;
  revokedBy: { id: string; name: string; email: string } | null;
  notes: string | null;
  evidence: Array<{
    id: string;
    name: string;
    type: string;
    downloadUrl: string;
    createdAt: Date;
  }>;
  /** Why this vendor is on the list, so the UI can say where it came from. */
  provenance: AccessProvenance;
}

@Injectable()
export class AccessRevocationReadService {
  constructor(private readonly attachmentsService: AttachmentsService) {}

  /**
   * The vendors a departing person's offboarding should actually cover.
   *
   * Scoped to observed access rather than the whole register — presenting every vendor in
   * the organization for every leaver is what makes the checklist unusable, since the
   * reviewer has to decide for each one whether it even applies.
   *
   * Falls back to the full register when no observation exists at all. Silently narrowing
   * offboarding on the basis of missing data is the dangerous failure: it would quietly
   * shorten the list for organizations that have not connected a discovery source, and
   * nobody would notice the omission.
   */
  async getAccessRevocations(organizationId: string, memberId: string) {
    const [scope, revocations] = await Promise.all([
      getMemberVendorScope({ organizationId, memberId }),
      db.offboardingAccessRevocation.findMany({
        where: { organizationId, memberId },
        include: { revokedBy: { select: { id: true, name: true, email: true } } },
      }),
    ]);

    const { observedVendorIds, hasObservation } = scope;
    // Already-revoked vendors stay on the list regardless, so completed history stays visible.
    const revokedVendorIds = new Set(revocations.map((revocation) => revocation.vendorId));
    const scopedIds = new Set([...observedVendorIds, ...revokedVendorIds]);

    const vendors = await db.vendor.findMany({
      where: {
        organizationId,
        ...(hasObservation ? { id: { in: [...scopedIds] } } : {}),
      },
      select: { id: true, name: true, website: true, logoUrl: true },
      orderBy: { name: 'asc' },
    });

    const revocationMap = new Map(revocations.map((r) => [r.vendorId, r]));
    const evidenceByRevocation = await this.loadEvidence({
      organizationId,
      revocationIds: revocations.map((r) => r.id),
    });

    const vendorList: AccessRevocationVendor[] = vendors.map((vendor) => {
      const revocation = revocationMap.get(vendor.id);
      return {
        vendorId: vendor.id,
        vendorName: vendor.name,
        logoUrl: vendorLogoUrl(vendor),
        revoked: Boolean(revocation),
        revokedAt: revocation?.revokedAt ?? null,
        revokedBy: revocation?.revokedBy ?? null,
        notes: revocation?.notes ?? null,
        evidence: revocation ? (evidenceByRevocation.get(revocation.id) ?? []) : [],
        provenance: !hasObservation
          ? 'full-register'
          : observedVendorIds.has(vendor.id)
            ? 'observed'
            : 'revoked-previously',
      };
    });

    return {
      vendors: vendorList,
      totalVendors: vendorList.length,
      revokedCount: revocations.length,
      /**
       * False when the list is the whole register because nothing has been observed. The UI
       * says so, rather than presenting an unscoped list as if it were tailored.
       */
      scopedToObservedAccess: hasObservation,
    };
  }

  private async loadEvidence({
    organizationId,
    revocationIds,
  }: {
    organizationId: string;
    revocationIds: string[];
  }): Promise<Map<string, AccessRevocationVendor['evidence']>> {
    const byRevocation = new Map<string, AccessRevocationVendor['evidence']>();
    if (revocationIds.length === 0) return byRevocation;

    const attachments = await db.attachment.findMany({
      where: {
        organizationId,
        entityId: { in: revocationIds },
        entityType: AttachmentEntityType.offboarding_checklist,
      },
      orderBy: { createdAt: 'asc' },
    });

    for (const attachment of attachments) {
      const existing = byRevocation.get(attachment.entityId) ?? [];
      existing.push({
        id: attachment.id,
        name: attachment.name,
        type: attachment.type,
        downloadUrl: await this.attachmentsService.getPresignedDownloadUrl(attachment.url),
        createdAt: attachment.createdAt,
      });
      byRevocation.set(attachment.entityId, existing);
    }

    return byRevocation;
  }
}
