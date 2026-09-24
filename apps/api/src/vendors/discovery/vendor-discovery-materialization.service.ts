import { Injectable, Logger } from '@nestjs/common';
import {
  db,
  DiscoveredVendorSource,
  DiscoveredVendorStatus,
  VendorAccessGrantRevokedReason,
  VendorAccessGrantSource,
} from '@db';
import type { CheckResultRow } from '../../integration-platform/services/check-results.service';
import { planReconciliation, type ObservedApp } from './grant-reconciler';
import { markDisappearedCandidates, withdrawUnobservedGrants } from './grant-withdrawal';
import { granteeKey, matchGranteesToMembers } from './member-matching';
import { VendorResolutionService } from './vendor-resolution.service';

export interface MaterializationSummary {
  trustworthy: boolean;
  skippedReason: string | null;
  appsObserved: number;
  candidatesCreated: number;
  candidatesUpdated: number;
  grantsUpserted: number;
  grantsWithdrawn: number;
  candidatesDisappeared: number;
  /** Emails of grantees matching no member. Surfaced rather than dropped. */
  unmatchedGrantees: string[];
}

const SOURCE = DiscoveredVendorSource.google_workspace;
const GRANT_SOURCE = VendorAccessGrantSource.google_workspace;

@Injectable()
export class VendorDiscoveryMaterializationService {
  private readonly logger = new Logger(VendorDiscoveryMaterializationService.name);

  constructor(private readonly resolutionService: VendorResolutionService) {}

  /**
   * Turn a check run's results into candidates and grants.
   *
   * Split in two by the trust predicate: everything observed is always recorded, but only a
   * run known to be complete may conclude that unobserved access was withdrawn. A degraded
   * run that wrote revocations would report an outage as an organization-wide offboarding.
   */
  async materialize({
    organizationId,
    rows,
    now = new Date(),
  }: {
    organizationId: string;
    rows: CheckResultRow[];
    now?: Date;
  }): Promise<MaterializationSummary> {
    const plan = planReconciliation({ rows, now });

    const summary: MaterializationSummary = {
      trustworthy: plan.trustworthy,
      skippedReason: plan.untrustworthyReason,
      appsObserved: plan.apps.length,
      candidatesCreated: 0,
      candidatesUpdated: 0,
      grantsUpserted: 0,
      grantsWithdrawn: 0,
      candidatesDisappeared: 0,
      unmatchedGrantees: [],
    };

    // No results at all means no evidence of anything — not evidence of nothing.
    if (plan.untrustworthyReason === 'no-results') {
      return summary;
    }

    const observedAt = plan.collectedAt ?? now;
    const members = await this.loadMembers(organizationId);

    const observedGrantKeys = new Set<string>();
    const observedAppIds = new Set<string>();

    for (const app of plan.apps) {
      observedAppIds.add(app.externalAppId);

      const { candidateId, created } = await this.upsertCandidate({
        organizationId,
        app,
        observedAt,
      });
      if (created) summary.candidatesCreated++;
      else summary.candidatesUpdated++;

      const { memberIdByGrantee, unmatched } = matchGranteesToMembers({
        grantees: app.grantees,
        members,
      });
      summary.unmatchedGrantees.push(
        ...unmatched.map((grantee) => grantee.email).filter(Boolean),
      );

      for (const grantee of app.grantees) {
        const memberId = memberIdByGrantee.get(granteeKey(grantee));
        if (!memberId) continue;

        await this.upsertGrant({
          organizationId,
          memberId,
          candidateId,
          app,
          scopes: grantee.scopes,
          observedAt,
        });
        summary.grantsUpserted++;
        observedGrantKeys.add(`${memberId}:${app.externalAppId}`);
      }
    }

    if (!plan.trustworthy) {
      this.logger.log(
        `Discovery for ${organizationId} recorded ${summary.grantsUpserted} grant(s) but ` +
          `skipped reconciliation: ${plan.untrustworthyReason}`,
      );
      return summary;
    }

    summary.grantsWithdrawn = await withdrawUnobservedGrants({
      organizationId,
      source: GRANT_SOURCE,
      observedGrantKeys,
      observedAt,
    });
    summary.candidatesDisappeared = await markDisappearedCandidates({
      organizationId,
      source: SOURCE,
      observedAppIds,
      observedAt,
    });

    return summary;
  }

  private async loadMembers(organizationId: string) {
    const members = await db.member.findMany({
      where: { organizationId },
      select: { id: true, externalUserId: true, user: { select: { email: true } } },
    });
    return members.map((member) => ({
      id: member.id,
      externalUserId: member.externalUserId,
      email: member.user?.email ?? null,
    }));
  }

  private async upsertCandidate({
    organizationId,
    app,
    observedAt,
  }: {
    organizationId: string;
    app: ObservedApp;
    observedAt: Date;
  }): Promise<{ candidateId: string; created: boolean }> {
    const existing = await db.discoveredVendorCandidate.findUnique({
      where: {
        organizationId_source_externalAppId: {
          organizationId,
          source: SOURCE,
          externalAppId: app.externalAppId,
        },
      },
      select: { id: true, status: true },
    });

    if (existing) {
      await db.discoveredVendorCandidate.update({
        where: { id: existing.id },
        data: {
          displayName: app.displayName,
          scopes: app.scopes,
          granteeCount: app.grantees.length,
          lastSeenAt: observedAt,
          // Being observed again clears a previous disappearance.
          disappearedAt: null,
        },
      });
      return { candidateId: existing.id, created: false };
    }

    const resolution = await this.resolutionService.resolve({
      candidate: {
        externalAppId: app.externalAppId,
        displayName: app.displayName,
        nativeApp: app.nativeApp,
        anonymous: app.anonymous,
      },
      organizationId,
    });

    // Resolving to a vendor already in the register means the app is already tracked —
    // approve it immediately rather than asking someone to re-approve what they have.
    const status = resolution.vendorId
      ? DiscoveredVendorStatus.approved
      : resolution.autoIgnoreReason
        ? DiscoveredVendorStatus.ignored
        : DiscoveredVendorStatus.pending;

    const candidate = await db.discoveredVendorCandidate.create({
      data: {
        organizationId,
        source: SOURCE,
        externalAppId: app.externalAppId,
        displayName: app.displayName,
        status,
        ignoredReason: resolution.autoIgnoreReason,
        firstSeenAt: observedAt,
        lastSeenAt: observedAt,
        granteeCount: app.grantees.length,
        scopes: app.scopes,
        resolutionMethod: resolution.method,
        resolvedName: resolution.resolvedName,
        resolvedWebsite: resolution.resolvedWebsite,
        resolvedDescription: resolution.resolvedDescription,
        confidence: resolution.confidence,
        vendorId: resolution.vendorId,
      },
      select: { id: true },
    });

    return { candidateId: candidate.id, created: true };
  }

  private async upsertGrant({
    organizationId,
    memberId,
    candidateId,
    app,
    scopes,
    observedAt,
  }: {
    organizationId: string;
    memberId: string;
    candidateId: string;
    app: ObservedApp;
    scopes: string[];
    observedAt: Date;
  }): Promise<void> {
    const existing = await db.vendorAccessGrant.findUnique({
      where: {
        organizationId_memberId_source_externalAppId: {
          organizationId,
          memberId,
          source: GRANT_SOURCE,
          externalAppId: app.externalAppId,
        },
      },
      select: { id: true, revokedAt: true, revokedReason: true },
    });

    if (!existing) {
      await db.vendorAccessGrant.create({
        data: {
          organizationId,
          memberId,
          source: GRANT_SOURCE,
          externalAppId: app.externalAppId,
          candidateId,
          scopes,
          firstSeenAt: observedAt,
          lastSeenAt: observedAt,
        },
      });
      return;
    }

    // Access revoked during offboarding that reappears stays revoked and is flagged. That
    // is a finding — someone re-authorized after leaving — not a data refresh.
    const wasOffboarded =
      existing.revokedAt !== null &&
      existing.revokedReason === VendorAccessGrantRevokedReason.offboarding;

    await db.vendorAccessGrant.update({
      where: { id: existing.id },
      data: {
        candidateId,
        scopes,
        lastSeenAt: observedAt,
        ...(wasOffboarded
          ? { reappearedAt: observedAt }
          : { revokedAt: null, revokedReason: null }),
      },
    });
  }
}
