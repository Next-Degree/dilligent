const mockUserFindUnique = jest.fn();
const mockMemberFindMany = jest.fn();
const mockMemberCount = jest.fn();
const mockInvitationFindFirst = jest.fn();
const mockInvitationDelete = jest.fn();

jest.mock('@db', () => ({
  db: {
    user: { findUnique: (...a: unknown[]) => mockUserFindUnique(...a) },
    member: {
      findMany: (...a: unknown[]) => mockMemberFindMany(...a),
      count: (...a: unknown[]) => mockMemberCount(...a),
    },
    invitation: {
      findFirst: (...a: unknown[]) => mockInvitationFindFirst(...a),
      delete: (...a: unknown[]) => mockInvitationDelete(...a),
    },
  },
}));

// Both guards import ./auth.server, which validates SECRET_KEY and pulls in
// better-auth/redis at module load. Stub them so importing the controller is
// hermetic — the test calls the method directly and never runs the guards.
jest.mock('./hybrid-auth.guard', () => ({ HybridAuthGuard: class {} }));
jest.mock('./permission.guard', () => ({
  PermissionGuard: class {},
  PERMISSIONS_KEY: 'permissions',
}));

import { NotFoundException } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { PERMISSIONS_KEY } from './permission.guard';
import type { AuthContext } from './types';

const sessionContext = (): AuthContext => ({
  organizationId: 'org_1',
  authType: 'session',
  isApiKey: false,
  isPlatformAdmin: false,
  userRoles: null,
  userId: 'user_1',
  userEmail: 'user@example.com',
});

describe('AuthController.getMe — hasInactiveMembership (CS-569)', () => {
  const controller = new AuthController();

  beforeEach(() => {
    jest.clearAllMocks();
    mockUserFindUnique.mockResolvedValue({
      id: 'user_1',
      email: 'user@example.com',
      name: 'User',
      image: null,
      role: 'user',
    });
    mockInvitationFindFirst.mockResolvedValue(null);
  });

  it('returns hasInactiveMembership: false for a genuinely new user (no memberships at all)', async () => {
    mockMemberFindMany.mockResolvedValue([]);
    mockMemberCount.mockResolvedValue(0);

    const res = await controller.getMe(sessionContext());

    expect(res.organizations).toEqual([]);
    expect(res.hasInactiveMembership).toBe(false);
  });

  it('returns hasInactiveMembership: true for an offboarded user (no active org, only deactivated memberships)', async () => {
    mockMemberFindMany.mockResolvedValue([]); // no ACTIVE memberships
    mockMemberCount.mockResolvedValue(1); // one deactivated/inactive membership

    const res = await controller.getMe(sessionContext());

    expect(res.organizations).toEqual([]);
    expect(res.hasInactiveMembership).toBe(true);
    // The count that distinguishes "offboarded" from "new" must match
    // memberships that are deactivated OR no longer active.
    expect(mockMemberCount).toHaveBeenCalledWith({
      where: {
        userId: 'user_1',
        OR: [{ deactivated: true }, { isActive: false }],
      },
    });
  });

  it('returns hasInactiveMembership: false for an active member', async () => {
    mockMemberFindMany.mockResolvedValue([
      {
        id: 'member_1',
        role: 'owner',
        organizationId: 'org_1',
        organization: {
          id: 'org_1',
          name: 'Org',
          logo: null,
          onboardingCompleted: true,
          hasAccess: true,
          createdAt: new Date(),
        },
      },
    ]);
    mockMemberCount.mockResolvedValue(0);

    const res = await controller.getMe(sessionContext());

    expect(res.organizations).toHaveLength(1);
    expect(res.hasInactiveMembership).toBe(false);
  });
});

/**
 * Revoking an invitation is an org-scoped mutation on a security-relevant
 * resource, so the lookup must be pinned to the caller's organization: an id
 * belonging to another tenant has to read as "not found" rather than delete.
 */
describe('AuthController.deleteInvitation', () => {
  const controller = new AuthController();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('is gated behind the member:delete permission', () => {
    expect(
      Reflect.getMetadata(PERMISSIONS_KEY, AuthController.prototype.deleteInvitation),
    ).toEqual([{ resource: 'member', actions: ['delete'] }]);
  });

  it('scopes the lookup to the caller organization and to pending invitations', async () => {
    mockInvitationFindFirst.mockResolvedValue({ id: 'inv_1', status: 'pending' });
    mockInvitationDelete.mockResolvedValue({});

    await controller.deleteInvitation('inv_1', 'org_1');

    expect(mockInvitationFindFirst).toHaveBeenCalledWith({
      where: { id: 'inv_1', organizationId: 'org_1', status: 'pending' },
    });
  });

  it('deletes the invitation and reports success', async () => {
    mockInvitationFindFirst.mockResolvedValue({ id: 'inv_1', status: 'pending' });
    mockInvitationDelete.mockResolvedValue({});

    await expect(controller.deleteInvitation('inv_1', 'org_1')).resolves.toEqual({
      success: true,
    });
    expect(mockInvitationDelete).toHaveBeenCalledWith({ where: { id: 'inv_1' } });
  });

  it('rejects an invitation from another organization without deleting it', async () => {
    mockInvitationFindFirst.mockResolvedValue(null);

    await expect(controller.deleteInvitation('inv_other_org', 'org_1')).rejects.toThrow(
      NotFoundException,
    );
    expect(mockInvitationDelete).not.toHaveBeenCalled();
  });

  it('rejects an invitation that was already accepted', async () => {
    mockInvitationFindFirst.mockResolvedValue(null);

    await expect(controller.deleteInvitation('inv_accepted', 'org_1')).rejects.toThrow(
      'Invitation not found or already accepted.',
    );
    expect(mockInvitationDelete).not.toHaveBeenCalled();
  });
});
