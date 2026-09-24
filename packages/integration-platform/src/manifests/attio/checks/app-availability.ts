import { TASK_TEMPLATES } from '../../../task-mappings';
import type { CheckContext, IntegrationCheck } from '../../../types';
import type { AttioSelfResponse } from '../types';
import { UNKNOWN_WORKSPACE_SLUG, friendlyError } from './shared';

/**
 * The scope every other Attio check depends on. /v2/self reports what the key was
 * actually granted, so a key that is alive but under-scoped is caught here rather
 * than surfacing later as an opaque 403 on the member list.
 */
const REQUIRED_SCOPE = 'user_management:read';

/** /v2/self returns scopes as a space-separated string, e.g. "a:read b:read". */
function parseScopes(scope: unknown): string[] {
  return typeof scope === 'string' ? scope.split(/\s+/).filter(Boolean) : [];
}

/**
 * Application Availability Check
 *
 * Confirms the stored credential still reaches Attio and still carries the access the
 * other checks need. This is the one Attio check that produces evidence even when the
 * workspace is empty, which makes it the row that answers "was this integration live
 * and authenticated on the date of the report".
 *
 * The other checks treat a /v2/self failure as cosmetic — they only use it for evidence
 * labels, so `fetchWorkspace` swallows the error. Here it is the finding, so this check
 * calls ctx.fetch directly to keep the raw failure.
 *
 * Maps to: App Availability task.
 */
export const appAvailabilityCheck: IntegrationCheck = {
  id: 'attio_app_availability',
  name: 'Application Availability',
  description: 'Verifies the Attio API token is active and the workspace is reachable via /v2/self',
  service: 'monitoring',
  taskMapping: TASK_TEMPLATES.appAvailability,
  defaultSeverity: 'medium',

  run: async (ctx: CheckContext) => {
    ctx.log('Starting Attio App Availability check');
    const checkedAt = new Date().toISOString();

    let self: AttioSelfResponse;
    try {
      self = await ctx.fetch<AttioSelfResponse>('/v2/self');
    } catch (error) {
      const failure = friendlyError(error, 'reaching /v2/self');
      ctx.fail({
        title: 'Attio is unreachable',
        resourceType: 'organization',
        resourceId: UNKNOWN_WORKSPACE_SLUG,
        severity: 'high',
        description:
          `Dilligent could not reach the Attio API: ${failure.message} ` +
          'While this persists, no Attio evidence can be collected.',
        remediation:
          'Reconnect Attio with a current API key from Workspace settings > Developers. ' +
          'If the key is valid, check whether api.attio.com is reachable from your network.',
        evidence: { endpoint: '/v2/self', reachable: false, error: failure.message, checkedAt },
      });
      return;
    }

    const workspaceSlug = self?.workspace_slug || UNKNOWN_WORKSPACE_SLUG;
    const scopes = parseScopes(self?.scope);

    // Attio reports a revoked or expired token as active: false rather than by refusing
    // the request, so an HTTP 200 alone is not proof the credential still works.
    if (self?.active === false) {
      ctx.fail({
        title: 'Attio API token is no longer active',
        resourceType: 'organization',
        resourceId: workspaceSlug,
        severity: 'high',
        description:
          'Attio answered /v2/self but reported the API token as inactive. The token has ' +
          'been revoked or has expired, so every other Attio check will fail to collect evidence.',
        remediation:
          'In Attio, open Workspace settings > Developers, create a replacement API key with ' +
          `the "${REQUIRED_SCOPE}" scope, and reconnect the integration in Dilligent.`,
        evidence: {
          endpoint: '/v2/self',
          reachable: true,
          active: false,
          workspace: self?.workspace_name ?? null,
          workspaceSlug,
          scopes,
          checkedAt,
        },
      });
      return;
    }

    ctx.pass({
      title: 'Attio is reachable and the API token is active',
      resourceType: 'organization',
      resourceId: workspaceSlug,
      description:
        `Attio answered /v2/self for workspace "${self?.workspace_name ?? workspaceSlug}" ` +
        'with an active API token.',
      evidence: {
        endpoint: '/v2/self',
        reachable: true,
        active: true,
        workspace: self?.workspace_name ?? null,
        workspaceSlug,
        workspaceId: self?.workspace_id ?? null,
        scopes,
        checkedAt,
      },
    });

    // A live key with the wrong scopes looks healthy but collects nothing, so it gets
    // its own row rather than being folded into the reachability result above.
    if (!scopes.includes(REQUIRED_SCOPE)) {
      ctx.fail({
        title: `Attio API key is missing the "${REQUIRED_SCOPE}" scope`,
        resourceType: 'organization',
        resourceId: workspaceSlug,
        severity: 'medium',
        description:
          'The connected key reaches Attio but was not granted the scope needed to read ' +
          `workspace members${scopes.length > 0 ? ` (granted: ${scopes.join(', ')})` : ' (no scopes granted)'}. ` +
          'The membership and access review checks cannot collect evidence without it.',
        remediation:
          'In Attio, open Workspace settings > Developers, edit the integration, enable ' +
          '"User management" > Read, then rerun. Existing keys pick up the new scope without ' +
          'being reissued.',
        evidence: {
          endpoint: '/v2/self',
          requiredScope: REQUIRED_SCOPE,
          scopes,
          workspace: self?.workspace_name ?? null,
          workspaceSlug,
          checkedAt,
        },
      });

      ctx.log(`Attio App Availability check complete: reachable, missing ${REQUIRED_SCOPE}`);
      return;
    }

    ctx.log('Attio App Availability check complete: reachable, active, correctly scoped');
  },
};
