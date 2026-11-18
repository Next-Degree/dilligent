import {
  BUILT_IN_ROLE_OBLIGATIONS,
  BUILT_IN_ROLE_PERMISSIONS,
  parseRoleObligations,
} from '@trycompai/auth';
import type { Permissions } from './caller-authority';

// Built-in lookups use Object.hasOwn so a custom role named after an
// Object.prototype key (e.g. "constructor") is not mistaken for a built-in.

/** Whether any of the roles grants access to the app. */
export function rolesGrantAppAccess({
  roles,
  customRoles,
}: {
  roles: string[];
  customRoles: { permissions: Permissions }[];
}): boolean {
  return (
    roles.some(
      (role) =>
        Object.hasOwn(BUILT_IN_ROLE_PERMISSIONS, role) &&
        !!BUILT_IN_ROLE_PERMISSIONS[role].app,
    ) || customRoles.some((role) => !!role.permissions.app)
  );
}

/** Whether any of the roles carries a compliance obligation. */
export function rolesHaveCompliance({
  roles,
  customRoles,
}: {
  roles: string[];
  /** Custom role rows with their raw `obligations` column. */
  customRoles: { obligations: unknown }[];
}): boolean {
  return (
    roles.some(
      (role) =>
        Object.hasOwn(BUILT_IN_ROLE_OBLIGATIONS, role) &&
        !!BUILT_IN_ROLE_OBLIGATIONS[role].compliance,
    ) ||
    customRoles.some(
      (role) => !!parseRoleObligations(role.obligations).compliance,
    )
  );
}
