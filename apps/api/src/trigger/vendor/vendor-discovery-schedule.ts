import { db } from '@db';
import { logger, schedules } from '@trigger.dev/sdk';
import {
  DISCOVERY_PROVIDER_SLUG,
  runVendorDiscoveryTask,
} from './run-vendor-discovery';

/**
 * Daily third-party app discovery across every connected Google Workspace tenant.
 *
 * Runs at 08:00 UTC, after integration checks (06:00) and employee sync (07:00), so the
 * Members that grants are attributed to already exist. Running before employee sync would
 * leave every grant from a newly hired person unattributable for a day.
 *
 * A dedicated schedule rather than a task mapping: at most one check per manifest is
 * discoverable per task template, so binding this to the employee-access template would
 * shadow the existing check.
 */
export const vendorDiscoverySchedule = schedules.task({
  id: 'vendor-discovery-schedule',
  cron: '0 8 * * *',
  maxDuration: 1000 * 60 * 30,
  run: async (payload) => {
    logger.info('Starting scheduled vendor discovery', {
      scheduledAt: payload.timestamp,
      lastRun: payload.lastTimestamp,
    });

    const connections = await db.integrationConnection.findMany({
      where: {
        status: 'active',
        provider: { slug: DISCOVERY_PROVIDER_SLUG },
      },
      select: { id: true, organizationId: true },
    });

    if (connections.length === 0) {
      logger.info('No active Google Workspace connections to discover from');
      return { success: true, triggered: 0 };
    }

    // One run per connection, dispatched rather than awaited: a single throttled tenant
    // must not consume the schedule's budget and starve every other organization.
    await runVendorDiscoveryTask.batchTrigger(
      connections.map((connection) => ({
        payload: {
          connectionId: connection.id,
          organizationId: connection.organizationId,
        },
      })),
    );

    logger.info(`Dispatched vendor discovery for ${connections.length} connection(s)`);
    return { success: true, triggered: connections.length };
  },
});
