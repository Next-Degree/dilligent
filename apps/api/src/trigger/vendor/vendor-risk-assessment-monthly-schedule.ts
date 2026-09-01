import { db } from '@db';
import { logger, schedules } from '@trigger.dev/sdk';
import { extractDomain } from '../../vendors/vendor-website';
import { vendorRiskAssessmentTask } from './vendor-risk-assessment-task';

// A vendor whose shared GlobalVendors record was refreshed inside this window is
// skipped: either it was manually re-run recently, or another organization's
// identically-domained vendor was already refreshed earlier in this same sweep.
// Kept just under the monthly cadence so a normal month still refreshes everyone
// once, without paying for a second full research pass on shared domains.
const STALENESS_THRESHOLD_DAYS = 25;

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
    const vendorDomains = vendors.map((vendor) => ({
      vendor,
      domain: extractDomain(vendor.website),
    }));

    const uniqueDomains = Array.from(
      new Set(
        vendorDomains
          .map((vd) => vd.domain)
          .filter((domain): domain is string => domain !== null),
      ),
    );

    const staleBefore = new Date(
      Date.now() - STALENESS_THRESHOLD_DAYS * 24 * 60 * 60 * 1000,
    );

    const freshDomains = new Set<string>();
    if (uniqueDomains.length > 0) {
      const recentlyAssessed = await db.globalVendors.findMany({
        where: {
          OR: uniqueDomains.map((domain) => ({
            website: { contains: domain },
          })),
          riskAssessmentUpdatedAt: { gte: staleBefore },
        },
        select: { website: true },
      });

      for (const gv of recentlyAssessed) {
        const domain = extractDomain(gv.website);
        if (domain) freshDomains.add(domain);
      }
    }

    // Vendors with no resolvable domain are left in the trigger list — the task
    // itself marks them "assessed" with no research spend (invalid/no website).
    const vendorsToTrigger = vendorDomains
      .filter((vd) => !vd.domain || !freshDomains.has(vd.domain))
      .map((vd) => vd.vendor);

    const skipped = vendors.length - vendorsToTrigger.length;

    logger.info(
      `Refreshing ${vendorsToTrigger.length} of ${vendors.length} vendors ` +
        `(${skipped} already assessed within ${STALENESS_THRESHOLD_DAYS} days)`,
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

    // Batch trigger risk assessment tasks with research enabled for the vendors
    // that need it. This will:
    // - Create new assessments for vendors without data (v1)
    // - Refresh existing assessments and increment version (v1 -> v2, v2 -> v3, etc.)
    const batch = vendorsToTrigger.map((vendor) => ({
      payload: {
        vendorId: vendor.id,
        vendorName: vendor.name,
        vendorWebsite: vendor.website!,
        organizationId: vendor.organizationId,
        createdByUserId: null, // System-initiated
        withResearch: true, // Always do research for vendors due for refresh
      },
    }));

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
