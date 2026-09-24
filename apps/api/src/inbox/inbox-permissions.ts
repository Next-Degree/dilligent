import { permissionsGrant, resolveRolePermissions } from '../auth/app-access';
import { resolveServiceByName } from '../auth/service-token.config';
import type { AuthContext } from '../auth/types';

export type CallerCan = (resource: string, action: string) => boolean;

/**
 * Resolve what the caller may do, once, mirroring PermissionGuard's precedence
 * (platform admin → API key scopes → service token → roles). The endpoint
 * guard only proves `app:read`; the inbox uses this to decide which sources
 * run, so a caller never sees signal from a resource they cannot read.
 */
export async function resolveCallerPermissions(
  auth: AuthContext,
): Promise<CallerCan> {
  if (auth.isPlatformAdmin) return () => true;

  if (auth.isApiKey) {
    const scopes = auth.apiKeyScopes;
    // Legacy keys (empty scopes) keep full access until the guard's cutoff;
    // the guard already blocks them past the deprecation date.
    if (!scopes || scopes.length === 0) return () => true;
    return (resource, action) => scopes.includes(`${resource}:${action}`);
  }

  if (auth.isServiceToken) {
    const granted = resolveServiceByName(auth.serviceName)?.permissions ?? [];
    return (resource, action) => granted.includes(`${resource}:${action}`);
  }

  const permissions = await resolveRolePermissions(
    auth.organizationId,
    auth.userRoles ?? [],
  );
  return (resource, action) => permissionsGrant(permissions, resource, action);
}
