import { db, VendorStatus } from '@db';
import { logger, schedules } from '@trigger.dev/sdk';
import { extractDomain } from '../../vendors/vendor-website';
import { vendorRiskAssessmentTask } from './vendor-risk-assessment-task';

type VendorRow = {
  id: string;
  name: string;
  website: string | null;
  organizationId: string;
  status: VendorStatus;
};

// A vendor whose shared GlobalVendors record was refreshed inside this window is
// skipped — it was already assessed recently enough (a manual re-run, or an
// earlier sweep) that a second full research pass buys nothing. Sitting just
// under the ~30-day cron interval, it clears for a vendor nobody touched between
// sweeps, so the untouched case still refreshes once a month. A vendor assessed
// on demand mid-month is still inside the window at the next sweep and waits for
// the one after, making the worst-case gap closer to two months — deliberate,
// since that vendor was in fact assessed in between.
export const STALENESS_THRESHOLD_DAYS = 25;

/**
 * Monthly scheduled task that refreshes risk assessments for all vendors.
 * Runs on the 1st of each month at 2:00 AM UTC.
 */
export const vendorRiskAssessmentMonthlySchedule = schedules.task({
  id: 'vendor-risk-assessment-monthly-schedule',
  cron: '0 2 1 * *', // 1st of each month at 2:00 AM UTC
  maxDuration: 1000 * 60 * 60, // 1 hour (for batch processing)
  run: async (payload) => {
    logger.info('Monthly vendor risk assessment refresh started', {
      scheduledAt: payload.timestamp,
      lastRun: payload.lastTimestamp,
    });

    // Find all vendors across all organizations that have websites
    const vendors = await db.vendor.findMany({
      where: {
        website: {
          not: null,
        },
      },
      select: {
        id: true,
        name: true,
        website: true,
        organizationId: true,
        status: true,
      },
    });

    logger.info(`Found ${vendors.length} vendors with websites`);

    if (vendors.length === 0) {
      return {
        success: true,
        totalVendors: 0,
        triggered: 0,
        skipped: 0,
        message: 'No vendors with websites found',
      };
    }

    // Every full research pass costs two premium Firecrawl agent calls plus a
    // trust-portal deep-scrape, so skip vendors whose GlobalVendors record is
    // already fresh instead of re-researching the entire fleet unconditionally.
    const staleBefore = new Date(
      Date.now() - STALENESS_THRESHOLD_DAYS * 24 * 60 * 60 * 1000,
    );

    // Filter on the timestamp alone and match domains in memory. GlobalVendors
    // rows are written by several callers in whatever shape each was given, so
    // matching in SQL means one `contains` clause per domain — a fleet-wide OR
    // of leading-wildcard LIKEs that no index can serve. Recently-assessed rows
    // are few, and extractDomain already normalizes both sides for us.
    const recentlyAssessed = await db.globalVendors.findMany({
      where: { riskAssessmentUpdatedAt: { gte: staleBefore } },
      select: { website: true },
    });

    const freshDomains = new Set(
      recentlyAssessed
        .map((globalVendor) => extractDomain(globalVendor.website))
        .filter((domain): domain is string => domain !== null),
    );

    // Three outcomes per vendor:
    //
    //  - stale (or no resolvable domain) -> research. Vendors with no domain
    //    stay here; the task marks them "assessed" with no research spend.
    //  - fresh domain, this org's vendor never assessed -> trigger WITHOUT
    //    research. GlobalVendors is keyed by domain and shared across orgs, so
    //    another org's recent assessment makes the domain fresh for everyone.
    //    Skipping outright would leave this org's vendor unassessed until the
    //    shared record goes stale — up to ~two months for a brand-new vendor.
    //    The task's dedupe path handles exactly this: it marks the org vendor
    //    assessed and syncs badges and logo from the cached row, spending no
    //    Firecrawl credits.
    //  - fresh domain, already assessed -> skip. Nothing to research and
    //    nothing to backfill.
    const toResearch: VendorRow[] = [];
    const toSyncFromCache: VendorRow[] = [];

    for (const vendor of vendors) {
      const domain = extractDomain(vendor.website);
      if (!domain || !freshDomains.has(domain)) {
        toResearch.push(vendor);
      } else if (vendor.status !== VendorStatus.assessed) {
        toSyncFromCache.push(vendor);
      }
    }

    const vendorsToTrigger = [...toResearch, ...toSyncFromCache];
    const skipped = vendors.length - vendorsToTrigger.length;

    logger.info(
      `Refreshing ${toResearch.length} of ${vendors.length} vendors ` +
        `(${toSyncFromCache.length} synced from a fresh shared record without ` +
        `research, ${skipped} already assessed within ` +
        `${STALENESS_THRESHOLD_DAYS} days)`,
    );

    if (vendorsToTrigger.length === 0) {
      return {
        success: true,
        totalVendors: vendors.length,
        triggered: 0,
        skipped,
        message: 'All vendors already have a fresh risk assessment',
      };
    }

    // Batch trigger risk assessment tasks. The researching half will:
    // - Create new assessments for vendors without data (v1)
    // - Refresh existing assessments and increment version (v1 -> v2, v2 -> v3, etc.)
    // The `withResearch: false` half takes the task's dedupe path instead,
    // reusing the fresh shared record at no research cost.
    const buildPayload = (vendor: VendorRow, withResearch: boolean) => ({
      payload: {
        vendorId: vendor.id,
        vendorName: vendor.name,
        vendorWebsite: vendor.website!,
        organizationId: vendor.organizationId,
        createdByUserId: null, // System-initiated
        withResearch,
      },
    });

    const batch = [
      ...toResearch.map((vendor) => buildPayload(vendor, true)),
      ...toSyncFromCache.map((vendor) => buildPayload(vendor, false)),
    ];

    try {
      await vendorRiskAssessmentTask.batchTrigger(batch);
      logger.info(`Triggered ${batch.length} vendor risk assessment tasks`, {
        totalVendors: vendors.length,
        triggered: batch.length,
        skipped,
      });

      return {
        success: true,
        totalVendors: vendors.length,
        triggered: batch.length,
        skipped,
        message: `Triggered monthly refresh for ${batch.length} vendors (${skipped} skipped as already fresh)`,
      };
    } catch (error) {
      logger.error('Failed to trigger batch risk assessment tasks', {
        error: error instanceof Error ? error.message : String(error),
        batchSize: batch.length,
      });

      return {
        success: false,
        totalVendors: vendors.length,
        triggered: 0,
        skipped,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
});
