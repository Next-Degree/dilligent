import { TASK_TEMPLATES } from '../../../task-mappings';
import type { CheckContext, IntegrationCheck } from '../../../types';
import { databaseEvidence, limitDatabases, resolveUpstashScope } from '../scope';
import { databaseScopeVariables } from '../variables';

/**
 * Upstash TLS Connections Enabled
 *
 * Unlike Neon, Upstash exposes a real per-database `tls` field — it is a
 * setting a customer can turn on or off (`POST /v2/redis/enable-tls/{id}`),
 * not a platform guarantee — so this check reads it directly rather than
 * relying on a vendor attestation. A field that is missing from the response
 * is treated the same as "off": never assume a control is enabled when the
 * API simply did not say so.
 *
 * Maps to: TLS / HTTPS
 */
export const tlsConnectionsCheck: IntegrationCheck = {
  id: 'upstash-tls-enabled',
  name: 'TLS Enabled on Database Connections',
  description: 'Verify TLS is required for connections to every Upstash Redis database',
  service: 'security',
  taskMapping: TASK_TEMPLATES.tlsHttps,
  defaultSeverity: 'high',
  variables: databaseScopeVariables,

  run: async (ctx: CheckContext) => {
    ctx.log('Starting Upstash TLS connections check');

    const scope = await resolveUpstashScope(ctx);
    if (!scope) return;

    const databases = limitDatabases(ctx, scope);
    let enabledCount = 0;

    for (const database of databases) {
      const name = database.database_name ?? database.database_id;
      const evidence = {
        ...databaseEvidence(database),
        tls: database.tls ?? null,
        checkedAt: scope.checkedAt,
      };

      if (database.tls === true) {
        enabledCount++;
        ctx.pass({
          title: `TLS enabled: ${name}`,
          description: `Verified from the Upstash API: database "${name}" requires TLS for client connections.`,
          resourceType: 'upstash_database',
          resourceId: database.database_id,
          evidence: { verification: 'api-verified', ...evidence },
        });
        continue;
      }

      const unknown = database.tls === undefined;
      ctx.fail({
        title: unknown ? `TLS status unknown: ${name}` : `TLS not enabled: ${name}`,
        description: unknown
          ? `The Upstash API did not report a "tls" field for database "${name}", so TLS enforcement could not be confirmed.`
          : `Database "${name}" does not require TLS, so connections can be made in plaintext.`,
        resourceType: 'upstash_database',
        resourceId: database.database_id,
        severity: unknown ? 'medium' : 'high',
        remediation:
          'In the Upstash Console, open the database > Details, and enable TLS (or `POST /v2/redis/enable-tls/{id}`), then update every client connection string to use the TLS endpoint.',
        evidence: { verification: 'api-verified', ...evidence },
      });
    }

    ctx.log(
      `Upstash TLS connections check complete: ${enabledCount}/${databases.length} database(s) have TLS enabled`,
    );
  },
};
