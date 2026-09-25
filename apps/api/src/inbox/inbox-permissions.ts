import { permissionsGrant, resolveRolePermissions } from '../auth/app-access';
import { resolveServiceByName } from '../auth/service-token.config';
import type { AuthContext } from '../auth/types';

export interface Permission {
  resource: string;
  action: string;
}

export type CallerCan = (permission: Permission) => boolean;

const scopeOf = ({ resource, action }: Permission) => `${resource}:${action}`;

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
    return (permission) => scopes.includes(scopeOf(permission));
  }

  if (auth.isServiceToken) {
    const granted = resolveServiceByName(auth.serviceName)?.permissions ?? [];
    return (permission) => granted.includes(scopeOf(permission));
  }

  const permissions = await resolveRolePermissions(
    auth.organizationId,
    auth.userRoles ?? [],
  );
  return ({ resource, action }) =>
    permissionsGrant(permissions, resource, action);
}
