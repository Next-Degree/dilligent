import type { CheckContext, IntegrationCheck } from '../../../types';
import {
  filterGoogleWorkspaceUsersForChecks,
  parseGoogleWorkspaceCheckUserFilter,
} from '../check-user-filter';
import { aggregateGrantsByApp, toAppRows } from '../oauth-app-aggregation';
import { fetchTokensForUsers } from '../tokens-fan-out';
import type {
  GoogleWorkspaceTokensResponse,
  GoogleWorkspaceUser,
  GoogleWorkspaceUsersResponse,
} from '../types';
import { includeSuspendedVariable, targetOrgUnitsVariable } from '../variables';

/** Resource id of the run marker. Reconciliation looks for exactly this row. */
export const INVENTORY_MARKER_RESOURCE_ID = 'google-workspace:oauth-inventory';

/** Resource id of the consent finding. Its presence alone makes a run untrustworthy. */
export const SCOPE_CONSENT_RESOURCE_ID = 'google-workspace:scope-consent';

/** Bumped when the marker's evidence shape changes; reconciliation refuses unknown versions. */
export const INVENTORY_SCHEMA_VERSION = 1;

/** Above this share of unreadable users the run cannot claim to have seen everything. */
const MAX_UNREADABLE_SHARE = 0.2;

export const REQUIRED_TOKENS_SCOPE =
  'https://www.googleapis.com/auth/admin.directory.user.security';

const CONSENT_REMEDIATION =
  'Reconnect Google Workspace and approve the additional permission to view users’ ' +
  'security settings. The connection keeps its existing access; reconnecting only adds the ' +
  'permission needed to read third-party app authorizations.';

/**
 * Third-party OAuth app inventory.
 *
 * Declares **no** `taskMapping` on purpose. `CheckResultsService` resolves at most one check
 * per manifest per task template (it uses `.find()`, not `.filter()`), so binding this to the
 * employee-access template would shadow the existing check and silently break the People page.
 * Discovery is driven by its own schedule instead.
 */
export const oauthAppAccessCheck: IntegrationCheck = {
  id: 'oauth-app-access',
  name: 'Third-Party App Access',
  description:
    'Inventory the third-party applications employees have authorized with their Google account',
  service: 'saas-discovery',
  variables: [targetOrgUnitsVariable, includeSuspendedVariable],

  run: async (ctx: CheckContext) => {
    ctx.log('Starting Google Workspace third-party app inventory');

    const userFilterConfig = parseGoogleWorkspaceCheckUserFilter(ctx.variables);

    const allUsers: GoogleWorkspaceUser[] = [];
    let pageToken: string | undefined;

    do {
      const params: Record<string, string> = {
        customer: 'my_customer',
        maxResults: '500',
        projection: 'full',
      };
      if (pageToken) {
        params.pageToken = pageToken;
      }

      const response = await ctx.fetch<GoogleWorkspaceUsersResponse>('/admin/directory/v1/users', {
        params,
      });
      if (response.users) {
        allUsers.push(...response.users);
      }
      pageToken = response.nextPageToken;
    } while (pageToken);

    // Same filter rules as the 2FA and employee-access checks, so grants are joinable to
    // the members employee sync creates.
    const activeUsers = filterGoogleWorkspaceUsersForChecks(allUsers, userFilterConfig);
    ctx.log(`Inspecting ${activeUsers.length} of ${allUsers.length} directory users`);

    const collectedAt = new Date().toISOString();

    const fanOut = await fetchTokensForUsers({
      users: activeUsers,
      deps: {
        // Emails are deliberately absent from every log line in this check — run logs are
        // persisted, and a per-employee list of authorized apps is exactly the data that
        // should not leak into them.
        log: (message) => ctx.log(message),
        fetchTokens: (userKey) =>
          ctx.fetch<GoogleWorkspaceTokensResponse>(
            `/admin/directory/v1/users/${encodeURIComponent(userKey)}/tokens`,
          ),
      },
    });

    const appRows = toAppRows(aggregateGrantsByApp(fanOut.grantsByUser));
    const distinctApps = new Set(appRows.map((row) => row.clientId)).size;
    const grantCount = appRows.reduce((total, row) => total + row.grantees.length, 0);
    const anyTruncated = appRows.some((row) => row.truncated);

    // A global denial is a consent problem, not a per-user one. Emit the finding and a
    // `complete: false` marker, then return normally: throwing would abort before the
    // marker is written, and the marker is what stops reconciliation from reading this
    // run as "every grant was revoked".
    if (fanOut.globalDenial) {
      ctx.fail({
        title: 'Additional Google Workspace permission required',
        description:
          'Reading third-party app authorizations requires a permission this connection ' +
          'has not been granted. No app inventory was collected.',
        resourceType: 'connection',
        resourceId: SCOPE_CONSENT_RESOURCE_ID,
        severity: 'medium',
        remediation: CONSENT_REMEDIATION,
        evidence: {
          requiredScope: REQUIRED_TOKENS_SCOPE,
          usersDenied: fanOut.usersDenied,
          sample: fanOut.denialSample,
          collectedAt,
        },
      });
    }

    for (const row of appRows) {
      const partLabel = row.partCount > 1 ? ` (part ${row.partNumber} of ${row.partCount})` : '';
      const appLabel = row.displayName ?? row.clientId;

      // Access is an inventory, not a violation — every app row passes. Nobody is in breach
      // for having signed into something.
      ctx.pass({
        title: 'Third-Party App Access',
        resourceType: 'oauth_app',
        resourceId: row.resourceId,
        description: `${row.granteeCount} employee(s) have authorized ${appLabel}${partLabel}`,
        evidence: {
          schemaVersion: INVENTORY_SCHEMA_VERSION,
          clientId: row.clientId,
          displayName: row.displayName ?? null,
          nativeApp: row.nativeApp,
          anonymous: row.anonymous,
          scopeCatalog: row.scopeCatalog,
          grantees: row.grantees,
          granteeCount: row.granteeCount,
          partNumber: row.partNumber,
          partCount: row.partCount,
          truncated: row.truncated,
          collectedAt,
        },
      });
    }

    const unreadable = fanOut.usersFailed + fanOut.usersDenied;
    const unreadableShare = fanOut.usersInspected > 0 ? unreadable / fanOut.usersInspected : 1;

    const complete =
      fanOut.usersInspected > 0 &&
      !fanOut.globalDenial &&
      !fanOut.ceilingReached &&
      !anyTruncated &&
      unreadableShare <= MAX_UNREADABLE_SHARE;

    // Exactly one marker row per run, always emitted. Reconciliation writes `revokedAt`
    // based on *absence*, which is only meaningful if the run that produced it was
    // complete — so absence of this row means no withdrawal is ever inferred.
    ctx.pass({
      title: 'Third-Party App Inventory',
      resourceType: 'inventory',
      resourceId: INVENTORY_MARKER_RESOURCE_ID,
      description: complete
        ? `Inventory complete: ${distinctApps} application(s) across ${fanOut.usersInspected} user(s)`
        : `Inventory incomplete: ${distinctApps} application(s) collected, but not every user could be read`,
      evidence: {
        schemaVersion: INVENTORY_SCHEMA_VERSION,
        complete,
        usersInspected: fanOut.usersInspected,
        usersSucceeded: fanOut.usersSucceeded,
        usersFailed: fanOut.usersFailed,
        usersDenied: fanOut.usersDenied,
        globalDenial: fanOut.globalDenial,
        ceilingReached: fanOut.ceilingReached,
        truncatedApps: anyTruncated,
        appCount: distinctApps,
        grantCount,
        filters: {
          targetOrgUnits: userFilterConfig.targetOrgUnits ?? null,
          userFilterMode: userFilterConfig.userFilterMode ?? null,
          includeSuspended: userFilterConfig.includeSuspended,
        },
        collectedAt,
      },
    });

    ctx.log(
      `Inventory ${complete ? 'complete' : 'incomplete'}: ${distinctApps} app(s), ` +
        `${grantCount} grant(s), ${fanOut.usersSucceeded} user(s) read, ` +
        `${fanOut.usersFailed} failed, ${fanOut.usersDenied} denied`,
    );
  },
};
