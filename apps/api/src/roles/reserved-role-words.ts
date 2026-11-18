import { BUILT_IN_ROLE_PERMISSIONS } from '@trycompai/auth';

/**
 * Much of the API reads `member.role` loosely: some checks look for the
 * substring "owner"/"admin", others lowercase each role and compare it to a
 * built-in name. A custom role named "process owner" or "Owner" would be read
 * as an owner, so such names are reserved for custom roles.
 */
const RESERVED_ROLE_WORDS = ['owner', 'admin'];

export function isReservedCustomRoleName(name: string): boolean {
  return (
    RESERVED_ROLE_WORDS.some((word) => name.includes(word)) ||
    Object.hasOwn(BUILT_IN_ROLE_PERMISSIONS, name.toLowerCase())
  );
}

export const RESERVED_ROLE_NAME_MESSAGE =
  'Custom role names cannot contain "owner" or "admin", or match a built-in role name';
