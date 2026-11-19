import { db } from '@db';
import { ForbiddenException } from '@nestjs/common';
import { BUILT_IN_ROLE_PERMISSIONS, statement } from '@trycompai/auth';
import { API_KEY_INTERNAL_ONLY_RESOURCES } from '../../auth/api-key-scopes';
import { resolveRolePermissions } from '../../auth/app-access';
import { resolveServiceByName } from '../../auth/service-token.config';
import type { AuthContext } from '../../auth/types';
import { parseRoles } from './parse-roles';

export type Permissions = Record<string, string[]>;

/** Who is assigning roles, and which permissions they may hand out. */
export interface CallerAuthority {
  permissions: Permissions;
  /** Session caller's user id. Absent for API keys and service tokens. */
  userId?: string;
  /** The session caller's own organization roles. Empty otherwise. */
  roles: string[];
  isApiKey: boolean;
}

function permissionsFromScopes(scopes: string[]): Permissions {
  const permissions: Permissions = {};
  for (const scope of scopes) {
    const [resource, action] = scope.split(':');
    if (!resource || !action) continue;
    (permissions[resource] ??= []).push(action);
  }
  return permissions;
}

/** `resource:action` pairs in `required` that `held` does not grant. */
export function missingPermissions({
  required,
  held,
}: {
  required: Permissions;
  held: Permissions;
}): string[] {
  return Object.entries(required).flatMap(([resource, actions]) =>
    actions
      .filter(
        (action) =>
          !Object.hasOwn(held, resource) || !held[resource].includes(action),
      )
      .map((action) => `${resource}:${action}`),
  );
}

function pickResources({
  permissions,
  keep,
}: {
  permissions: Permissions;
  keep: (resource: string) => boolean;
}): Permissions {
  return Object.fromEntries(
    Object.entries(permissions).filter(([resource]) => keep(resource)),
  );
}

/**
 * A Full Access key (one holding every admin permission a key is able to
 * hold) also counts as holding admin's invitation and team permissions,
 * which keys can never carry as scopes. Narrower keys get nothing extra.
 */
function withFullAccessKeyGrants(scoped: Permissions): Permissions {
  const admin = BUILT_IN_ROLE_PERMISSIONS.admin ?? {};
  const isInternal = (resource: string) =>
    API_KEY_INTERNAL_ONLY_RESOURCES.includes(resource);
  const keyHoldable = pickResources({
    permissions: admin,
    keep: (resource) => !isInternal(resource),
  });
  if (missingPermissions({ required: keyHoldable, held: scoped }).length) {
    return scoped;
  }
  return {
    ...scoped,
    ...pickResources({ permissions: admin, keep: isInternal }),
  };
}

/** Resolve an active session member's own roles and permissions. */
export async function resolveSessionCaller({
  organizationId,
  userId,
}: {
  organizationId: string;
  userId: string;
}): Promise<CallerAuthority> {
  const member = await db.member.findFirst({
    where: { userId, organizationId, isActive: true, deactivated: false },
    select: { role: true },
  });
  if (!member) {
    throw new ForbiddenException('Caller is not an active organization member');
  }
  const roles = parseRoles(member.role);
  return {
    permissions: await resolveRolePermissions(organizationId, roles),
    userId,
    roles,
    isApiKey: false,
  };
}

/**
 * Resolve what the caller may assign. Throws 403 for callers who are not
 * authenticated for this organization.
 */
export async function resolveCallerAuthority({
  organizationId,
  authContext,
}: {
  organizationId: string;
  authContext: AuthContext;
}): Promise<CallerAuthority> {
  if (!authContext || authContext.organizationId !== organizationId) {
    throw new ForbiddenException(
      'Authentication is required for this organization',
    );
  }
  if (authContext.authType === 'api-key' && authContext.isApiKey) {
    const scoped = permissionsFromScopes(authContext.apiKeyScopes ?? []);
    return {
      permissions: withFullAccessKeyGrants(scoped),
      roles: [],
      isApiKey: true,
    };
  }
  if (authContext.authType === 'service' && authContext.isServiceToken) {
    const service = resolveServiceByName(authContext.serviceName);
    return {
      permissions: permissionsFromScopes(service?.permissions ?? []),
      roles: [],
      isApiKey: false,
    };
  }
  if (
    authContext.authType !== 'session' ||
    !authContext.userId ||
    authContext.isApiKey ||
    authContext.isServiceToken
  ) {
    throw new ForbiddenException('An authenticated caller is required');
  }
  // PermissionGuard gives platform admins full access; match it here.
  if (authContext.isPlatformAdmin) {
    return {
      permissions: Object.fromEntries(
        Object.entries(statement).map(([resource, actions]) => [
          resource,
          [...actions],
        ]),
      ),
      userId: authContext.userId,
      roles: [],
      isApiKey: false,
    };
  }
  return resolveSessionCaller({
    organizationId,
    userId: authContext.userId,
  });
}
