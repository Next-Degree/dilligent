import { db } from '@db';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { BUILT_IN_ROLE_PERMISSIONS, isRestrictedRole } from '@trycompai/auth';
import { z } from 'zod';
import { API_KEY_INTERNAL_ONLY_RESOURCES } from '../../auth/api-key-scopes';
import type { AuthContext } from '../../auth/types';
import {
  RESERVED_ROLE_NAME_MESSAGE,
  isReservedCustomRoleName,
} from '../../roles/reserved-role-words';
import {
  type CallerAuthority,
  type Permissions,
  missingPermissions,
  resolveCallerAuthority,
} from './caller-authority';
import { OWNER_ROLE, parseRoles } from './parse-roles';

const permissionSchema = z.record(z.string(), z.array(z.string()));

/** A custom role row loaded while authorizing, reusable by the caller. */
export interface AssignedCustomRole {
  name: string;
  permissions: Permissions;
  /** Raw `obligations` column; parse with `parseRoleObligations`. */
  obligations: unknown;
}

export interface AuthorizedRoles {
  /** De-duplicated, trimmed role names. Persist these, not the raw input. */
  roles: string[];
  customRoles: AssignedCustomRole[];
}

function parseCustomPermissions(raw: unknown): Permissions {
  try {
    const value: unknown = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return permissionSchema.parse(value);
  } catch {
    throw new BadRequestException('Role permissions are invalid');
  }
}

/** Parse role strings, rejecting empty entries such as "employee,". */
export function parseTargetRoles(roleStrings: string[]): Set<string> {
  const targetRoles = new Set<string>();
  for (const roleString of roleStrings) {
    const parsed = parseRoles(roleString);
    if (!parsed.length || roleString.split(',').some((role) => !role.trim())) {
      throw new BadRequestException('At least one valid role is required');
    }
    for (const role of parsed) targetRoles.add(role);
  }
  return targetRoles;
}

function exceedsAuthorityError({
  role,
  missing,
  caller,
}: {
  role: string;
  missing: string[];
  caller: CallerAuthority;
}): ForbiddenException {
  const onlyKeyInternal =
    caller.isApiKey &&
    missing.every((permission) =>
      API_KEY_INTERNAL_ONLY_RESOURCES.includes(permission.split(':')[0]),
    );
  return new ForbiddenException(
    onlyKeyInternal
      ? `Role "${role}" grants invitation or team permissions, which only a Full Access API key can assign`
      : `Role "${role}" exceeds your effective permissions`,
  );
}

/** Throw unless the caller may create members at all. */
export function assertCanCreateMembers(caller: CallerAuthority): void {
  if (!caller.permissions.member?.includes('create')) {
    throw new ForbiddenException('Caller lacks permission to create members');
  }
}

const isCustomRole = (role: string) =>
  !Object.hasOwn(BUILT_IN_ROLE_PERMISSIONS, role);

async function loadCustomRoles({
  organizationId,
  names,
}: {
  organizationId: string;
  names: string[];
}): Promise<AssignedCustomRole[]> {
  if (!names.length) return [];
  const rows = await db.organizationRole.findMany({
    where: { organizationId, name: { in: names } },
    select: { name: true, permissions: true, obligations: true },
  });
  return rows.map((row) => ({
    name: row.name,
    permissions: parseCustomPermissions(row.permissions),
    obligations: row.obligations,
  }));
}

/**
 * Throw unless the caller holds what `role` grants. `admin`/`auditor` need
 * every permission `admin` has. (A strict subset check can't work there:
 * auditor holds finding:create/delete, which not even owner has.)
 */
function assertWithinAuthority({
  role,
  custom,
  caller,
}: {
  role: string;
  custom: AssignedCustomRole | undefined;
  caller: CallerAuthority;
}): void {
  if (isRestrictedRole(role)) return;
  if (!isCustomRole(role)) {
    const required = BUILT_IN_ROLE_PERMISSIONS.admin ?? {};
    if (!missingPermissions({ required, held: caller.permissions }).length) {
      return;
    }
    throw new ForbiddenException(
      caller.isApiKey
        ? `You cannot assign privileged role "${role}": the API key needs every admin permission, so create a new Full Access key`
        : `You cannot assign privileged role "${role}"`,
    );
  }
  if (!custom) {
    throw new BadRequestException(`Unknown organization role "${role}"`);
  }
  const missing = missingPermissions({
    required: custom.permissions,
    held: caller.permissions,
  });
  if (missing.length) throw exceedsAuthorityError({ role, missing, caller });
}

/**
 * The one set of role rules for invite, create and role changes:
 *  - `owner` only via /organization/transfer-ownership.
 *  - Custom roles must exist and must not use a reserved name.
 *  - Every role must be within the caller's authority (assertWithinAuthority).
 *
 * Returns the parsed roles and the custom role rows it loaded.
 */
export async function authorizeTargetRoles({
  organizationId,
  roles,
  caller,
}: {
  organizationId: string;
  roles: string[];
  caller: CallerAuthority;
}): Promise<AuthorizedRoles> {
  const targetRoles = parseTargetRoles(roles);
  if (targetRoles.has(OWNER_ROLE)) {
    throw new ForbiddenException(
      'Owner role can only be assigned via /organization/transfer-ownership',
    );
  }
  const customNames = [...targetRoles].filter(isCustomRole);
  if (customNames.some(isReservedCustomRoleName)) {
    throw new ForbiddenException(RESERVED_ROLE_NAME_MESSAGE);
  }
  const customRoles = await loadCustomRoles({
    organizationId,
    names: customNames,
  });
  const customByName = new Map(customRoles.map((role) => [role.name, role]));
  for (const role of targetRoles) {
    assertWithinAuthority({ role, custom: customByName.get(role), caller });
  }
  return { roles: [...targetRoles], customRoles };
}

/**
 * Throw unless the caller could have assigned every role a member already
 * holds (owner excluded). Only authority is checked: a custom role that no
 * longer exists (e.g. renamed) grants nothing and is skipped, and legacy
 * reserved names are allowed so they can be cleaned up.
 */
export async function assertCanManageHeldRoles({
  organizationId,
  roles,
  caller,
}: {
  organizationId: string;
  roles: string[];
  caller: CallerAuthority;
}): Promise<void> {
  const customRoles = await loadCustomRoles({
    organizationId,
    names: roles.filter(isCustomRole),
  });
  const customByName = new Map(customRoles.map((role) => [role.name, role]));
  for (const role of roles) {
    if (role === OWNER_ROLE) continue;
    const custom = customByName.get(role);
    if (isCustomRole(role) && !custom) continue;
    assertWithinAuthority({ role, custom, caller });
  }
}

/**
 * Authorize a member-creation request (POST /v1/people and bulk) in one go.
 * Returns the de-duplicated, trimmed role names that were authorized.
 */
export async function authorizeMemberCreation({
  organizationId,
  roles,
  authContext,
}: {
  organizationId: string;
  roles: string[];
  authContext: AuthContext;
}): Promise<string[]> {
  const caller = await resolveCallerAuthority({ organizationId, authContext });
  assertCanCreateMembers(caller);
  const authorized = await authorizeTargetRoles({
    organizationId,
    roles,
    caller,
  });
  return authorized.roles;
}
