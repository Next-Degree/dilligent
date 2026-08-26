import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  AttachmentEntityType,
  Prisma,
  VendorAccessGrantRevokedReason,
  db,
} from '@db';
import { AttachmentsService } from '../attachments/attachments.service';
import { getMemberVendorScope } from './member-vendor-scope';

@Injectable()
export class AccessRevocationService {
  private readonly logger = new Logger(AccessRevocationService.name);

  constructor(private readonly attachmentsService: AttachmentsService) {}
  async revokeVendorAccess({
    organizationId,
    memberId,
    vendorId,
    revokedById,
    notes,
    evidence,
  }: {
    organizationId: string;
    memberId: string;
    vendorId: string;
    revokedById: string;
    notes?: string;
    evidence?: { fileName: string; fileType: string; fileData: string };
  }) {
    const member = await db.member.findFirst({
      where: { id: memberId, organizationId },
    });

    if (!member) {
      throw new NotFoundException('Member not found in this organization');
    }

    const vendor = await db.vendor.findFirst({
      where: { id: vendorId, organizationId },
    });

    if (!vendor) {
      throw new NotFoundException('Vendor not found in this organization');
    }

    const existing = await db.offboardingAccessRevocation.findUnique({
      where: { memberId_vendorId: { memberId, vendorId } },
    });

    if (existing) {
      throw new BadRequestException(
        'Vendor access has already been revoked for this member',
      );
    }

    let revocation: Awaited<ReturnType<typeof db.offboardingAccessRevocation.create>>;
    try {
      // The attested action and its effect on observed state are written together, but to
      // separate tables. An auditor needs to tell "a named person confirmed they removed
      // this" apart from "we stopped seeing it" — merging them would lose that.
      const [created] = await db.$transaction([
        db.offboardingAccessRevocation.create({
          data: {
            organizationId,
            memberId,
            vendorId,
            revokedById,
            notes,
          },
          include: {
            revokedBy: { select: { id: true, name: true, email: true } },
          },
        }),
        db.vendorAccessGrant.updateMany({
          where: { organizationId, memberId, vendorId, revokedAt: null },
          data: {
            revokedAt: new Date(),
            revokedReason: VendorAccessGrantRevokedReason.offboarding,
          },
        }),
      ]);
      revocation = created;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new BadRequestException('Vendor access has already been revoked for this member');
      }
      throw err;
    }

    if (evidence) {
      try {
        await this.attachmentsService.uploadAttachment(
          organizationId,
          revocation.id,
          AttachmentEntityType.offboarding_checklist,
          evidence,
          revokedById,
        );
      } catch (err) {
        await db.offboardingAccessRevocation.delete({ where: { id: revocation.id } });
        throw err;
      }
    }

    try {
      await this.syncAccessRevocationCompletion(
        organizationId,
        memberId,
        revokedById,
      );
    } catch (err) {
      this.logger.warn(`Failed to sync access revocation completion for member ${memberId}`, err);
    }

    return revocation;
  }

  async undoVendorRevocation({
    organizationId,
    memberId,
    vendorId,
  }: {
    organizationId: string;
    memberId: string;
    vendorId: string;
  }) {
    const revocation = await db.offboardingAccessRevocation.findFirst({
      where: { memberId, vendorId, organizationId },
    });

    if (!revocation) {
      throw new NotFoundException('Revocation record not found');
    }

    const attachments = await this.attachmentsService.getAttachments(
      organizationId,
      revocation.id,
      AttachmentEntityType.offboarding_checklist,
    );

    for (const attachment of attachments) {
      await this.attachmentsService.deleteAttachment(organizationId, attachment.id);
    }

    await db.$transaction([
      db.offboardingAccessRevocation.delete({ where: { id: revocation.id } }),
      // Undoing the attestation returns the grant to whatever discovery last saw. It stays
      // withdrawn if a later run genuinely stopped reporting it.
      db.vendorAccessGrant.updateMany({
        where: {
          organizationId,
          memberId,
          vendorId,
          revokedReason: VendorAccessGrantRevokedReason.offboarding,
        },
        data: { revokedAt: null, revokedReason: null, reappearedAt: null },
      }),
    ]);

    try {
      await this.syncAccessRevocationCompletion(organizationId, memberId);
    } catch (err) {
      this.logger.warn(`Failed to sync access revocation completion for member ${memberId}`, err);
    }

    return { success: true };
  }

  async revokeAllVendorAccess({
    organizationId,
    memberId,
    revokedById,
  }: {
    organizationId: string;
    memberId: string;
    revokedById: string;
  }) {
    const member = await db.member.findFirst({
      where: { id: memberId, organizationId },
    });

    if (!member) {
      throw new NotFoundException('Member not found in this organization');
    }

    // Scoped to the vendors the checklist actually presents, not the whole register.
    // "Revoke all" is an attestation by a named person; applying it to vendors this
    // member never had access to would put statements in the audit trail that are simply
    // untrue. Falls back to the full register on the same condition the checklist does —
    // when nothing has been observed, an unscoped list is the honest answer.
    const scope = await getMemberVendorScope({ organizationId, memberId });
    const vendors = await db.vendor.findMany({
      where: {
        organizationId,
        ...(scope.hasObservation ? { id: { in: [...scope.observedVendorIds] } } : {}),
      },
      select: { id: true },
    });

    const existing = await db.offboardingAccessRevocation.findMany({
      where: { organizationId, memberId },
      select: { vendorId: true },
    });

    const existingSet = new Set(existing.map((r) => r.vendorId));
    const toCreate = vendors.filter((v) => !existingSet.has(v.id));

    if (toCreate.length > 0) {
      await db.$transaction([
        db.offboardingAccessRevocation.createMany({
          data: toCreate.map((v) => ({
            organizationId,
            memberId,
            vendorId: v.id,
            revokedById,
          })),
          skipDuplicates: true,
        }),
        db.vendorAccessGrant.updateMany({
          where: {
            organizationId,
            memberId,
            vendorId: { in: toCreate.map((v) => v.id) },
            revokedAt: null,
          },
          data: {
            revokedAt: new Date(),
            revokedReason: VendorAccessGrantRevokedReason.offboarding,
          },
        }),
      ]);
    }

    try {
      await this.syncAccessRevocationCompletion(organizationId, memberId, revokedById);
    } catch (err) {
      this.logger.warn(`Failed to sync access revocation completion for member ${memberId}`, err);
    }

    return { confirmed: toCreate.length };
  }

  private async syncAccessRevocationCompletion(
    organizationId: string,
    memberId: string,
    completedById?: string,
  ) {
    const templateItem = await db.offboardingChecklistTemplate.findFirst({
      where: { organizationId, isAccessRevocation: true, isEnabled: true },
    });

    if (!templateItem) {
      return;
    }

    const [totalVendors, revokedCount] = await Promise.all([
      db.vendor.count({ where: { organizationId } }),
      db.offboardingAccessRevocation.count({ where: { organizationId, memberId } }),
    ]);

    const allRevoked = totalVendors > 0 && revokedCount === totalVendors;

    const existingCompletion =
      await db.offboardingChecklistCompletion.findFirst({
        where: { organizationId, memberId, templateItemId: templateItem.id },
      });

    if (allRevoked && !existingCompletion && completedById) {
      await db.offboardingChecklistCompletion.create({
        data: {
          organizationId,
          memberId,
          templateItemId: templateItem.id,
          completedById,
        },
      });
    }

    if (!allRevoked && existingCompletion) {
      await db.offboardingChecklistCompletion.delete({
        where: { id: existingCompletion.id },
      });
    }
  }
}
