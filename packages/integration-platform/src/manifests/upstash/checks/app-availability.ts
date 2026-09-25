import { TASK_TEMPLATES } from '../../../task-mappings';
import type { CheckContext, IntegrationCheck } from '../../../types';
import { databaseEvidence, limitDatabases, resolveUpstashScope } from '../scope';
import { databaseScopeVariables } from '../variables';

/** The only state Upstash documents for a database able to serve connections. */
const HEALTHY_STATES: ReadonlySet<string> = new Set(['active']);

/**
 * Upstash App Availability
 *
 * Verifies each database is in a state able to serve connections. A state
 * other than "active" (or a missing state) is reported as unavailable rather
 * than assumed healthy.
 *
 * Maps to: App Availability
 */
export const appAvailabilityCheck: IntegrationCheck = {
  id: 'upstash-app-availability',
  name: 'App Availability',
  description: 'Verify Upstash Redis databases are in a state able to serve connections',
  service: 'inventory',
  taskMapping: TASK_TEMPLATES.appAvailability,
  defaultSeverity: 'medium',
  variables: databaseScopeVariables,

  run: async (ctx: CheckContext) => {
    ctx.log('Starting Upstash app availability check');

    const scope = await resolveUpstashScope(ctx);
    if (!scope) return;

    const databases = limitDatabases(ctx, scope);
    let availableCount = 0;

    for (const database of databases) {
      const name = database.database_name ?? database.database_id;
      const state = database.state;
      const evidence = {
        verification: 'api-verified',
        ...databaseEvidence(database),
        state: state ?? null,
        checkedAt: scope.checkedAt,
      };

      if (state !== undefined && HEALTHY_STATES.has(state)) {
        availableCount++;
        ctx.pass({
          title: `Available: ${name}`,
          description: `Database "${name}" is in state "${state}" and able to serve connections.`,
          resourceType: 'upstash_database',
          resourceId: database.database_id,
          evidence,
        });
        continue;
      }

      ctx.fail({
        title: `Unavailable: ${name}`,
        description:
          state === undefined
            ? `The Upstash API did not report a state for database "${name}", so its availability could not be confirmed.`
            : `Database "${name}" is in state "${state}", which cannot serve connections.`,
        resourceType: 'upstash_database',
        resourceId: database.database_id,
        severity: 'medium',
        remediation:
          'Open the database in the Upstash Console and confirm it has not been paused, is not exceeding a plan limit, or was not left in a deleted/expired state. Recreate it if it is no longer usable.',
        evidence,
      });
    }

    ctx.log(
      `Upstash app availability check complete: ${availableCount}/${databases.length} database(s) available`,
    );
  },
};
