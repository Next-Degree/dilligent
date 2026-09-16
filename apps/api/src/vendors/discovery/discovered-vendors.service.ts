import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  db,
  DiscoveredVendorSource,
  DiscoveredVendorStatus,
  VendorSource,
} from '@db';
import {
  migrateLegacyVendorCategory,
  type DataFlowRoleValue,
  type DataServiceTypeValue,
  type VendorCategoryValue,
  type VendorDeliveryModelValue,
} from '@trycompai/utils/vendors';
import { VendorsService } from '../vendors.service';
import { buildDiscoveredVendorDescription } from './discovered-vendor-description';

export interface ApproveCandidateInput {
  organizationId: string;
  candidateId: string;
  actingUserId: string | null;
  /** Reviewer edits from the approval form. Prefilled values are overridable. */
  name?: string;
  website?: string;
  description?: string;
  category?: VendorCategoryValue;
  deliveryModels?: VendorDeliveryModelValue[];
  dataServiceTypes?: DataServiceTypeValue[];
  dataFlowRoles?: DataFlowRoleValue[];
}

@Injectable()
export class DiscoveredVendorsService {
  private readonly logger = new Logger(DiscoveredVendorsService.name);

  constructor(private readonly vendorsService: VendorsService) {}

  async list({
    organizationId,
    status,
  }: {
    organizationId: string;
    status?: DiscoveredVendorStatus;
  }) {
    return db.discoveredVendorCandidate.findMany({
      where: { organizationId, ...(status ? { status } : {}) },
      orderBy: [{ granteeCount: 'desc' }, { lastSeenAt: 'desc' }],
      include: { vendor: { select: { id: true, name: true } } },
    });
  }

  async countPending(organizationId: string): Promise<number> {
    return db.discoveredVendorCandidate.count({
      where: { organizationId, status: DiscoveredVendorStatus.pending },
    });
  }

  /** Always scoped by organization — a candidate must never be readable across tenants. */
  async findOne({
    organizationId,
    candidateId,
  }: {
    organizationId: string;
    candidateId: string;
  }) {
    const candidate = await db.discoveredVendorCandidate.findFirst({
      where: { id: candidateId, organizationId },
      include: {
        vendor: { select: { id: true, name: true } },
        grants: {
          where: { revokedAt: null },
          select: {
            id: true,
            scopes: true,
            firstSeenAt: true,
            lastSeenAt: true,
            member: {
              select: {
                id: true,
                user: { select: { name: true, email: true } },
              },
            },
          },
        },
      },
    });

    if (!candidate) {
      throw new NotFoundException('Discovered vendor not found');
    }
    return candidate;
  }

  /**
   * Approve a candidate into a real vendor.
   *
   * Idempotent: re-approving an already-approved candidate returns the existing vendor
   * rather than creating a second one. Approval is a button that can be double-clicked, and
   * vendor creation triggers a risk assessment, so a duplicate is both a wrong register
   * entry and wasted research capacity.
   */
  async approve(input: ApproveCandidateInput) {
    const { organizationId, candidateId, actingUserId } = input;

    // Vendor creation is attributed, and an unattributable approval leaves a register entry
    // nobody is accountable for.
    if (!actingUserId) {
      throw new BadRequestException(
        'Approving a discovered vendor requires an attributable user; ' +
          'API key and service-token callers cannot approve.',
      );
    }

    const candidate = await db.discoveredVendorCandidate.findFirst({
      where: { id: candidateId, organizationId },
    });
    if (!candidate) {
      throw new NotFoundException('Discovered vendor not found');
    }

    if (candidate.status === DiscoveredVendorStatus.approved && candidate.vendorId) {
      const existing = await db.vendor.findFirst({
        where: { id: candidate.vendorId, organizationId },
      });
      if (existing) {
        return { vendor: existing, candidate, created: false };
      }
    }

    const name = input.name?.trim() || candidate.resolvedName || candidate.displayName;
    if (!name) {
      throw new BadRequestException(
        'This application reported no name, so a vendor name must be supplied.',
      );
    }

    const vendor = await this.vendorsService.create(
      organizationId,
      {
        name,
        // Never empty: Vendor.description is non-null, and a blank description makes the
        // register unreadable for anyone auditing it later.
        description:
          input.description?.trim() ||
          buildDiscoveredVendorDescription({
            candidateDescription: candidate.resolvedDescription,
            source: candidate.source,
            discoveredAt: candidate.firstSeenAt,
            granteeCount: candidate.granteeCount,
          }),
        website: input.website?.trim() || candidate.resolvedWebsite || undefined,
        // A candidate inferred before the vocabulary changed can still carry a retired
        // value, which the create DTO now rejects — normalise it rather than 400 the
        // reviewer for a row they never touched.
        category:
          input.category ??
          (candidate.resolvedCategory
            ? migrateLegacyVendorCategory(candidate.resolvedCategory).category
            : 'other'),
        deliveryModels: input.deliveryModels,
        dataServiceTypes: input.dataServiceTypes,
        dataFlowRoles: input.dataFlowRoles,
      },
      actingUserId,
    );

    // Status flip and grant re-association together: a vendor whose grants still point at
    // nothing would show an empty access list immediately after approval.
    const [updatedCandidate] = await db.$transaction([
      db.discoveredVendorCandidate.update({
        where: { id: candidate.id },
        data: {
          status: DiscoveredVendorStatus.approved,
          vendorId: vendor.id,
          decidedById: actingUserId,
          decidedAt: new Date(),
        },
      }),
      db.vendorAccessGrant.updateMany({
        where: { candidateId: candidate.id },
        data: { vendorId: vendor.id },
      }),
      db.vendor.update({
        where: { id: vendor.id },
        data: { source: VendorSource.discovered, discoveredAt: candidate.firstSeenAt },
      }),
    ]);

    this.logger.log(
      `Approved discovered vendor ${candidate.id} into vendor ${vendor.id} for ${organizationId}`,
    );

    return { vendor, candidate: updatedCandidate, created: true };
  }

  async ignore({
    organizationId,
    candidateId,
    actingUserId,
    reason,
  }: {
    organizationId: string;
    candidateId: string;
    actingUserId: string | null;
    reason?: string;
  }) {
    await this.assertExists({ organizationId, candidateId });

    // Grants keep being observed and updated — ignoring removes it from the queue, not from
    // the record of who can reach it.
    return db.discoveredVendorCandidate.update({
      where: { id: candidateId },
      data: {
        status: DiscoveredVendorStatus.ignored,
        ignoredReason: reason?.trim() || null,
        decidedById: actingUserId,
        decidedAt: new Date(),
      },
    });
  }

  async reopen({
    organizationId,
    candidateId,
    actingUserId,
  }: {
    organizationId: string;
    candidateId: string;
    actingUserId: string | null;
  }) {
    await this.assertExists({ organizationId, candidateId });

    return db.discoveredVendorCandidate.update({
      where: { id: candidateId },
      data: {
        status: DiscoveredVendorStatus.pending,
        ignoredReason: null,
        decidedById: actingUserId,
        decidedAt: new Date(),
      },
    });
  }

  private async assertExists({
    organizationId,
    candidateId,
  }: {
    organizationId: string;
    candidateId: string;
  }): Promise<void> {
    const found = await db.discoveredVendorCandidate.findFirst({
      where: { id: candidateId, organizationId },
      select: { id: true },
    });
    if (!found) {
      throw new NotFoundException('Discovered vendor not found');
    }
  }
}

export { DiscoveredVendorSource };
