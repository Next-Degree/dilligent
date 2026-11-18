import { ForbiddenException, HttpException } from '@nestjs/common';
import type { CallerAuthority } from './caller-authority';
import {
  assertCanManageHeldRoles,
  authorizeTargetRoles,
  parseTargetRoles,
} from './member-creation-authorization';
import { OWNER_ROLE, parseRoles } from './parse-roles';

export { parseRoles } from './parse-roles';

interface AuthorizeRoleChangeParams {
  organizationId: string;
  caller: CallerAuthority;
  targetMember: { userId: string; role: string };
  newRole: string;
}

const withoutOwner = (roles: string[]) =>
  roles.filter((role) => role !== OWNER_ROLE);

/**
 * Authorization for changing an existing member's roles: PATCH
 * /v1/people/:id, and invite when it re-adds someone who is already a member.
 *
 * Enforces:
 *  - The caller needs member:update.
 *  - Callers cannot change their OWN roles.
 *  - The 'owner' role can only be granted/revoked via /organization/transfer-ownership.
 *  - Only an owner can change the roles of an owner.
 *  - Added roles pass the shared role rules (`authorizeTargetRoles`), and a
 *    non-owner must also have authority over every role the member holds now.
 */
export async function authorizeRoleChange({
  organizationId,
  caller,
  targetMember,
  newRole,
}: AuthorizeRoleChangeParams): Promise<void> {
  if (!caller.permissions.member?.includes('update')) {
    throw new ForbiddenException('Caller lacks permission to update members');
  }
  if (caller.userId && targetMember.userId === caller.userId) {
    throw new ForbiddenException(
      'You cannot change your own role. Use /organization/transfer-ownership to change ownership.',
    );
  }

  const existingRoles = parseRoles(targetMember.role);
  const newRoles = [...parseTargetRoles([newRole])];
  const existingHasOwner = existingRoles.includes(OWNER_ROLE);
  if (newRoles.includes(OWNER_ROLE) !== existingHasOwner) {
    throw new ForbiddenException(
      'Owner role can only be assigned via /organization/transfer-ownership',
    );
  }
  const callerIsOwner = caller.roles.includes(OWNER_ROLE);
  if (existingHasOwner && !callerIsOwner) {
    throw new ForbiddenException(
      'Only an owner can change the roles of an owner',
    );
  }

  // Ownership is unchanged from here on. Roles being added get the full
  // checks; roles the member already holds only need to be within the
  // caller's authority, so stale or legacy names don't block an edit.
  const added = withoutOwner(newRoles).filter(
    (role) => !existingRoles.includes(role),
  );
  if (added.length) {
    await authorizeTargetRoles({ organizationId, roles: added, caller });
  }
  if (callerIsOwner) return;

  try {
    await assertCanManageHeldRoles({
      organizationId,
      roles: existingRoles,
      caller,
    });
  } catch (error) {
    if (!(error instanceof HttpException)) throw error;
    throw new ForbiddenException(
      `You cannot change the roles of this member. ${error.message}`,
    );
  }
}
