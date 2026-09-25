import { TASK_TEMPLATES } from '../../../task-mappings';
import type { CheckContext, IntegrationCheck } from '../../../types';
import { databaseEvidence, limitDatabases, resolveUpstashScope } from '../scope';
import { databaseScopeVariables } from '../variables';

/**
 * Upstash Access Control (IP Allowlisting)
 *
 * Upstash has no per-org member/role model to check the way Neon's
 * organization MFA does — a connection is authorized by a database's
 * token/password alone unless an IP allowlist restricts which networks may
 * even attempt to connect. `securityAddons.ipWhitelisting` reports whether
 * that network-level control is active for a database. A database without
 * it accepts connection attempts from any IP address.
 *
 * Maps to: Production Firewall / No Public Access Controls
 */
export const noPublicAccessCheck: IntegrationCheck = {
  id: 'upstash-no-public-access',
  name: 'Access Restricted by IP Allowlist',
  description: 'Verify Upstash Redis databases restrict connections with an IP allowlist',
  service: 'security',
  taskMapping: TASK_TEMPLATES.productionFirewallNopublicaccessControls,
  defaultSeverity: 'high',
  variables: databaseScopeVariables,

  run: async (ctx: CheckContext) => {
    ctx.log('Starting Upstash access control check');

    const scope = await resolveUpstashScope(ctx);
    if (!scope) return;

    const databases = limitDatabases(ctx, scope);
    let restrictedCount = 0;

    for (const database of databases) {
      const name = database.database_name ?? database.database_id;
      const ipWhitelisting = database.securityAddons?.ipWhitelisting;
      const unknown = ipWhitelisting === undefined;
      const evidence = {
        // Only a field the API actually returned counts as verified; a
        // missing field must never be reported as if it had been confirmed.
        verification: unknown ? 'unconfirmed' : 'api-verified',
        ...databaseEvidence(database),
        ipWhitelisting: ipWhitelisting ?? null,
        checkedAt: scope.checkedAt,
      };

      if (ipWhitelisting === true) {
        restrictedCount++;
        ctx.pass({
          title: `Access restricted: ${name}`,
          description: `Database "${name}" has IP allowlisting enabled, so only allowlisted networks can attempt to connect.`,
          resourceType: 'upstash_database',
          resourceId: database.database_id,
          evidence,
        });
        continue;
      }

      ctx.fail({
        title: unknown
          ? `Access control unknown: ${name}`
          : `Open to public network access: ${name}`,
        description: unknown
          ? `The Upstash API did not report an IP allowlisting status for database "${name}", so its network exposure could not be confirmed.`
          : `Database "${name}" has no IP allowlist, so it accepts connection attempts from any IP address (still gated by its password/token).`,
        resourceType: 'upstash_database',
        resourceId: database.database_id,
        severity: unknown ? 'medium' : 'high',
        remediation:
          'In the Upstash Console, open the database > Details > IP Allowlist, and add the CIDR ranges your application connects from. Not available on the free plan.',
        evidence,
      });
    }

    ctx.log(
      `Upstash access control check complete: ${restrictedCount}/${databases.length} database(s) restricted by an IP allowlist`,
    );
  },
};
