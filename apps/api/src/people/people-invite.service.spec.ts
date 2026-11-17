import { Test, TestingModule } from '@nestjs/testing';
import { PeopleInviteService } from './people-invite.service';
import { TimelinesService } from '../timelines/timelines.service';

jest.mock('@db', () => ({
  BackgroundCheckStatus: {
    invited: 'invited',
    in_progress: 'in_progress',
    in_review: 'in_review',
    completed: 'completed',
    completed_with_flags: 'completed_with_flags',
    failed: 'failed',
    cancelled: 'cancelled',
  },
  db: {
    organization: {
      findUnique: jest.fn(),
    },
    user: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    member: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    invitation: {
      create: jest.fn(),
    },
    employeeTrainingVideoCompletion: {
      createMany: jest.fn(),
    },
    frameworkInstance: {
      findFirst: jest.fn(),
    },
    organizationRole: {
      findMany: jest.fn().mockResolvedValue([]),
    },
  },
}));

jest.mock('@trycompai/auth', () => ({
  BUILT_IN_ROLE_PERMISSIONS: {
    owner: {
      organization: ['read', 'update', 'delete'],
      member: ['create', 'read', 'update', 'delete'],
      app: ['read'],
    },
    admin: {
      organization: ['read', 'update'],
      member: ['create', 'read', 'update', 'delete'],
      app: ['read'],
    },
    auditor: {
      member: ['create', 'read'],
      app: ['read'],
    },
    employee: {
      policy: ['read'],
      portal: ['read', 'update'],
    },
    contractor: {
      policy: ['read'],
      portal: ['read', 'update'],
    },
  },
  BUILT_IN_ROLE_OBLIGATIONS: {
    owner: { compliance: true },
    admin: {},
    auditor: {},
    employee: { compliance: true },
    contractor: { compliance: true },
  },
  isRestrictedRole: (role: string) =>
    role === 'employee' || role === 'contractor',
  parseRoleObligations: (value: unknown) => {
    try {
      const parsed = typeof value === 'string' ? JSON.parse(value) : value;
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  },
  parseRolePermissions: (value: unknown) => {
    try {
      const parsed = typeof value === 'string' ? JSON.parse(value) : value;
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      return null;
    }
  },
}));

jest.mock('../email/trigger-email', () => ({
  triggerEmail: jest.fn().mockResolvedValue({ id: 'trigger_123' }),
}));

jest.mock('../frameworks/frameworks-timeline.helper', () => ({
  checkAutoCompletePhases: jest.fn().mockResolvedValue(undefined),
}));

const mockInviteEmail = jest.fn().mockReturnValue('mocked-app-element');
jest.mock('../email/templates/invite-member', () => ({
  InviteEmail: (...args: unknown[]) => mockInviteEmail(...args),
}));

const mockInvitePortalEmail = jest
  .fn()
  .mockReturnValue('mocked-portal-element');
jest.mock('@trycompai/email', () => ({
  InvitePortalEmail: (...args: unknown[]) => mockInvitePortalEmail(...args),
}));

import { db } from '@db';
import { triggerEmail } from '../email/trigger-email';
import type { AuthContext } from '../auth/types';

const mockDb = db as jest.Mocked<typeof db>;
const mockTriggerEmail = triggerEmail as jest.Mock;

const CALLER_USER_ID = 'user_caller';

const sessionAuth: AuthContext = {
  organizationId: 'org_123',
  authType: 'session',
  isApiKey: false,
  isPlatformAdmin: false,
  userId: CALLER_USER_ID,
  userRoles: ['admin'],
};

const apiKeyAuth = (apiKeyScopes: string[]): AuthContext => ({
  organizationId: 'org_123',
  authType: 'api-key',
  isApiKey: true,
  isPlatformAdmin: false,
  userRoles: null,
  apiKeyScopes,
});

const FULL_MEMBER_SCOPES = [
  'member:create',
  'member:read',
  'member:update',
  'member:delete',
];

/**
 * `db.member.findFirst` serves three lookups: the session caller's own
 * membership (role authorization), the invitee's existing membership, and the
 * API-key inviter fallback. Route the caller lookup to `callerRole` and every
 * other lookup to `target`.
 */
function mockMembers({
  callerRole = 'admin',
  target = null,
}: { callerRole?: string; target?: unknown } = {}) {
  (mockDb.member.findFirst as jest.Mock).mockImplementation(
    async ({ where }: { where: { userId?: string; isActive?: boolean } }) =>
      where.userId === CALLER_USER_ID && where.isActive === true
        ? { role: callerRole }
        : target,
  );
}

describe('PeopleInviteService', () => {
  let service: PeopleInviteService;

  const mockTimelinesService = {};

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PeopleInviteService,
        { provide: TimelinesService, useValue: mockTimelinesService },
      ],
    }).compile();

    service = module.get<PeopleInviteService>(PeopleInviteService);
    jest.clearAllMocks();
    mockMembers();
    (mockDb.organizationRole.findMany as jest.Mock).mockResolvedValue([]);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('inviteMembers', () => {
    const baseParams = {
      organizationId: 'org_123',
      authContext: sessionAuth,
    };

    it('should return error for employee caller trying to invite', async () => {
      mockMembers({ callerRole: 'employee' });

      const results = await service.inviteMembers({
        ...baseParams,
        invites: [{ email: 'test@example.com', roles: ['employee'] }],
      });

      expect(results[0].success).toBe(false);
      expect(results[0].error).toContain('permission to create members');
    });

    it('should restrict auditors from assigning privileged roles', async () => {
      mockMembers({ callerRole: 'auditor' });

      const results = await service.inviteMembers({
        ...baseParams,
        invites: [{ email: 'test@example.com', roles: ['admin'] }],
      });

      expect(results[0].success).toBe(false);
      expect(results[0].error).toContain('privileged role');
    });

    it('allows an API key with full member CRUD scopes to assign admin (resolves an owner as inviter)', async () => {
      (mockDb.user.findFirst as jest.Mock).mockResolvedValue(null);
      // Owner fallback lookup for inviterId (API keys have no caller user)
      mockMembers({ target: { userId: 'owner_user' } });
      (mockDb.organization.findUnique as jest.Mock).mockResolvedValue({
        name: 'Test Org',
      });
      (mockDb.invitation.create as jest.Mock).mockResolvedValue({ id: 'inv_1' });

      const results = await service.inviteMembers({
        ...baseParams,
        authContext: apiKeyAuth(FULL_MEMBER_SCOPES),
        invites: [{ email: 'admin@example.com', roles: ['admin', 'employee'] }],
      });

      expect(results[0].success).toBe(true);
      expect(results[0].error).toBeUndefined();
      // The invitation was attributed to the resolved owner
      expect(mockDb.invitation.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ inviterId: 'owner_user' }),
        }),
      );
    });

    it('restricts an API key scoped to only member:create from assigning admin', async () => {
      const results = await service.inviteMembers({
        ...baseParams,
        authContext: apiKeyAuth(['member:create']),
        invites: [{ email: 'admin@example.com', roles: ['admin'] }],
      });

      expect(results[0].success).toBe(false);
      expect(results[0].error).toContain('privileged role');
      // Role check fails before any inviter resolution
      expect(mockDb.invitation.create).not.toHaveBeenCalled();
    });

    it('rejects a legacy unscoped API key (empty scopes grant no permissions)', async () => {
      (mockDb.user.findFirst as jest.Mock).mockResolvedValue(null);
      mockMembers({ target: { userId: 'owner_user' } });
      (mockDb.organization.findUnique as jest.Mock).mockResolvedValue({
        name: 'Test Org',
      });

      const results = await service.inviteMembers({
        ...baseParams,
        authContext: apiKeyAuth([]),
        invites: [{ email: 'emp@example.com', roles: ['employee'] }],
      });

      expect(results[0].success).toBe(false);
      expect(results[0].error).toContain('permission to create members');
      expect(mockDb.member.create).not.toHaveBeenCalled();
      expect(mockDb.invitation.create).not.toHaveBeenCalled();
    });

    it('fails clearly when an API key invite has no owner/admin to attribute as inviter', async () => {
      (mockDb.user.findFirst as jest.Mock).mockResolvedValue(null);
      // No owner or admin found
      mockMembers({ target: null });

      const results = await service.inviteMembers({
        ...baseParams,
        authContext: apiKeyAuth(FULL_MEMBER_SCOPES),
        invites: [{ email: 'admin@example.com', roles: ['admin'] }],
      });

      expect(results[0].success).toBe(false);
      expect(results[0].error).toContain('inviter');
    });

    it('should allow auditors to invite restricted roles', async () => {
      (mockDb.organization.findUnique as jest.Mock).mockResolvedValue({
        name: 'Test Org',
      });
      (mockDb.user.findFirst as jest.Mock).mockResolvedValue(null);
      (mockDb.user.create as jest.Mock).mockResolvedValue({
        id: 'usr_emp',
        email: 'emp@example.com',
      });
      mockMembers({ callerRole: 'auditor', target: null });
      (mockDb.member.create as jest.Mock).mockResolvedValue({
        id: 'mem_emp',
      });
      (
        mockDb.employeeTrainingVideoCompletion.createMany as jest.Mock
      ).mockResolvedValue({ count: 5 });

      const results = await service.inviteMembers({
        ...baseParams,
        invites: [{ email: 'emp@example.com', roles: ['employee'] }],
      });

      expect(results[0].success).toBe(true);
    });

    it('should add employee without invitation for employee/contractor roles', async () => {
      (mockDb.organization.findUnique as jest.Mock).mockResolvedValue({
        name: 'Test Org',
      });
      (mockDb.user.findFirst as jest.Mock).mockResolvedValue(null);
      (mockDb.user.create as jest.Mock).mockResolvedValue({
        id: 'user_new',
        email: 'emp@example.com',
      });
      mockMembers({ target: null });
      (mockDb.member.create as jest.Mock).mockResolvedValue({
        id: 'member_new',
      });
      (
        mockDb.employeeTrainingVideoCompletion.createMany as jest.Mock
      ).mockResolvedValue({
        count: 5,
      });

      const results = await service.inviteMembers({
        ...baseParams,
        invites: [{ email: 'emp@example.com', roles: ['employee'] }],
      });

      expect(results[0].success).toBe(true);
      // No portal invite was requested (sendPortalEmail omitted = false), so no
      // email is sent and emailSent is not surfaced (the UI only warns on an
      // actual send failure, never on an intentional skip).
      expect(mockTriggerEmail).not.toHaveBeenCalled();
      expect(results[0].emailSent).toBeUndefined();
      expect(mockDb.member.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            role: 'employee',
            organizationId: 'org_123',
          }),
        }),
      );
    });

    it('creates invited employees with a verified email so trusted SSO providers can link', async () => {
      (mockDb.organization.findUnique as jest.Mock).mockResolvedValue({
        name: 'Test Org',
      });
      (mockDb.user.findFirst as jest.Mock).mockResolvedValue(null);
      (mockDb.user.create as jest.Mock).mockResolvedValue({
        id: 'user_new',
        email: 'emp@example.com',
      });
      mockMembers({ target: null });
      (mockDb.member.create as jest.Mock).mockResolvedValue({
        id: 'member_new',
      });
      (
        mockDb.employeeTrainingVideoCompletion.createMany as jest.Mock
      ).mockResolvedValue({
        count: 5,
      });

      const results = await service.inviteMembers({
        ...baseParams,
        invites: [{ email: 'emp@example.com', roles: ['employee'] }],
      });

      expect(results[0].success).toBe(true);
      // An unverified local user makes better-auth refuse to link trusted
      // OAuth providers (account_not_linked), stranding invited employees at
      // the portal sign-in page, so new users must be created verified.
      expect(mockDb.user.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ emailVerified: true }),
      });
    });

    it('upgrades a legacy unverified user to verified when re-invited as an employee', async () => {
      (mockDb.organization.findUnique as jest.Mock).mockResolvedValue({
        name: 'Test Org',
      });
      // Legacy row: created before employees were created verified, and no
      // longer a member anywhere, so the one-time member backfill missed it.
      (mockDb.user.findFirst as jest.Mock).mockResolvedValue({
        id: 'user_legacy',
        email: 'emp@example.com',
        emailVerified: false,
      });
      mockMembers({ target: null });
      (mockDb.member.create as jest.Mock).mockResolvedValue({
        id: 'member_new',
      });
      (
        mockDb.employeeTrainingVideoCompletion.createMany as jest.Mock
      ).mockResolvedValue({ count: 5 });

      const results = await service.inviteMembers({
        ...baseParams,
        invites: [{ email: 'emp@example.com', roles: ['employee'] }],
      });

      expect(results[0].success).toBe(true);
      expect(mockDb.user.update).toHaveBeenCalledWith({
        where: { id: 'user_legacy' },
        data: { emailVerified: true },
      });
    });

    it('does not touch an already-verified user when re-invited', async () => {
      (mockDb.organization.findUnique as jest.Mock).mockResolvedValue({
        name: 'Test Org',
      });
      (mockDb.user.findFirst as jest.Mock).mockResolvedValue({
        id: 'user_verified',
        email: 'emp@example.com',
        emailVerified: true,
      });
      mockMembers({ target: null });
      (mockDb.member.create as jest.Mock).mockResolvedValue({
        id: 'member_new',
      });
      (
        mockDb.employeeTrainingVideoCompletion.createMany as jest.Mock
      ).mockResolvedValue({ count: 5 });

      const results = await service.inviteMembers({
        ...baseParams,
        invites: [{ email: 'emp@example.com', roles: ['employee'] }],
      });

      expect(results[0].success).toBe(true);
      expect(mockDb.user.update).not.toHaveBeenCalled();
    });

    it('upgrades a legacy unverified user to verified when invited to an admin role', async () => {
      (mockDb.user.findFirst as jest.Mock).mockResolvedValue({
        id: 'user_legacy',
        email: 'admin@example.com',
        emailVerified: false,
      });
      mockMembers({ target: null });
      (mockDb.organization.findUnique as jest.Mock).mockResolvedValue({
        name: 'Test Org',
      });
      (mockDb.invitation.create as jest.Mock).mockResolvedValue({
        id: 'inv_new',
      });

      const results = await service.inviteMembers({
        ...baseParams,
        invites: [{ email: 'admin@example.com', roles: ['admin'] }],
      });

      expect(results[0].success).toBe(true);
      expect(mockDb.invitation.create).toHaveBeenCalled();
      // The invitee signs in to accept; an unverified row would block linking
      // a Google/Microsoft sign-in to it (account_not_linked).
      expect(mockDb.user.update).toHaveBeenCalledWith({
        where: { id: 'user_legacy' },
        data: { emailVerified: true },
      });
    });

    it('should reactivate deactivated members', async () => {
      (mockDb.organization.findUnique as jest.Mock).mockResolvedValue({
        name: 'Test Org',
      });
      (mockDb.user.findFirst as jest.Mock).mockResolvedValue({
        id: 'user_existing',
        email: 'emp@example.com',
      });
      mockMembers({
        target: {
          id: 'member_existing',
          deactivated: true,
        },
      });
      (mockDb.member.update as jest.Mock).mockResolvedValue({
        id: 'member_existing',
      });

      const results = await service.inviteMembers({
        ...baseParams,
        invites: [{ email: 'emp@example.com', roles: ['employee'] }],
      });

      expect(results[0].success).toBe(true);
      expect(mockDb.member.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            deactivated: false,
            role: 'employee',
          }),
        }),
      );
    });

    // Regression (CS): promoting an EXISTING ACTIVE member must upgrade their
    // role in place. Previously an active member's role was left unchanged, so
    // adding admin to an existing employee never granted app access and the
    // user hit "Access Denied" after accepting.
    it('upgrades an existing active member in place when promoted (no invitation, no email)', async () => {
      (mockDb.user.findFirst as jest.Mock).mockResolvedValue({
        id: 'user_existing',
        email: 'zub@example.com',
      });
      mockMembers({
        target: {
          id: 'member_existing',
          role: 'employee',
          deactivated: false,
          isActive: true,
        },
      });
      (mockDb.member.update as jest.Mock).mockResolvedValue({
        id: 'member_existing',
      });

      const results = await service.inviteMembers({
        ...baseParams,
        invites: [{ email: 'zub@example.com', roles: ['admin', 'employee'] }],
      });

      expect(results[0].success).toBe(true);
      // Role is unioned (sorted, de-duped) onto the existing membership.
      expect(mockDb.member.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'member_existing' },
          data: { role: 'admin,employee' },
        }),
      );
      // An already-active member is upgraded directly — no re-invitation, no email.
      expect(mockDb.invitation.create).not.toHaveBeenCalled();
      expect(mockTriggerEmail).not.toHaveBeenCalled();
    });

    it('does not rewrite an active member who already holds the invited roles', async () => {
      (mockDb.user.findFirst as jest.Mock).mockResolvedValue({
        id: 'user_existing',
        email: 'a@example.com',
      });
      mockMembers({
        target: {
          id: 'member_existing',
          role: 'admin,employee',
          deactivated: false,
          isActive: true,
        },
      });

      const results = await service.inviteMembers({
        ...baseParams,
        invites: [{ email: 'a@example.com', roles: ['admin'] }],
      });

      expect(results[0].success).toBe(true);
      expect(mockDb.member.update).not.toHaveBeenCalled();
      expect(mockDb.invitation.create).not.toHaveBeenCalled();
    });

    it('unions roles for an active member re-added via the employee path', async () => {
      (mockDb.organization.findUnique as jest.Mock).mockResolvedValue({
        name: 'Test Org',
      });
      (mockDb.user.findFirst as jest.Mock).mockResolvedValue({
        id: 'user_existing',
        email: 'c@example.com',
      });
      mockMembers({
        target: {
          id: 'member_existing',
          role: 'contractor',
          deactivated: false,
          isActive: true,
        },
      });
      (mockDb.member.update as jest.Mock).mockResolvedValue({
        id: 'member_existing',
      });

      const results = await service.inviteMembers({
        ...baseParams,
        invites: [{ email: 'c@example.com', roles: ['employee'] }],
      });

      expect(results[0].success).toBe(true);
      expect(mockDb.member.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'member_existing' },
          data: { role: 'contractor,employee' },
        }),
      );
    });

    it('should handle multiple invites', async () => {
      (mockDb.organization.findUnique as jest.Mock).mockResolvedValue({
        name: 'Test Org',
      });
      (mockDb.user.findFirst as jest.Mock).mockResolvedValue(null);
      (mockDb.user.create as jest.Mock).mockResolvedValue({
        id: 'user_new',
        email: 'test@example.com',
      });
      mockMembers({ target: null });
      (mockDb.member.create as jest.Mock).mockResolvedValue({
        id: 'member_new',
      });
      (
        mockDb.employeeTrainingVideoCompletion.createMany as jest.Mock
      ).mockResolvedValue({
        count: 5,
      });

      const results = await service.inviteMembers({
        ...baseParams,
        invites: [
          { email: 'emp1@example.com', roles: ['employee'] },
          { email: 'emp2@example.com', roles: ['contractor'] },
        ],
      });

      expect(results).toHaveLength(2);
      expect(results.every((r) => r.success)).toBe(true);
    });

    it('should continue processing when one invite fails', async () => {
      (mockDb.organization.findUnique as jest.Mock)
        .mockResolvedValueOnce(null) // First org lookup fails
        .mockResolvedValueOnce({ name: 'Test Org' }); // Second succeeds
      (mockDb.user.findFirst as jest.Mock).mockResolvedValue(null);
      (mockDb.user.create as jest.Mock).mockResolvedValue({
        id: 'user_new',
        email: 'test@example.com',
      });
      mockMembers({ target: null });
      (mockDb.member.create as jest.Mock).mockResolvedValue({
        id: 'member_new',
      });
      (
        mockDb.employeeTrainingVideoCompletion.createMany as jest.Mock
      ).mockResolvedValue({
        count: 5,
      });

      const results = await service.inviteMembers({
        ...baseParams,
        invites: [
          { email: 'fail@example.com', roles: ['employee'] },
          { email: 'success@example.com', roles: ['employee'] },
        ],
      });

      expect(results).toHaveLength(2);
      expect(results[0].success).toBe(false);
      expect(results[1].success).toBe(true);
    });

    it('should handle email send failure gracefully', async () => {
      (mockDb.organization.findUnique as jest.Mock).mockResolvedValue({
        name: 'Test Org',
      });
      (mockDb.user.findFirst as jest.Mock).mockResolvedValue(null);
      (mockDb.user.create as jest.Mock).mockResolvedValue({
        id: 'user_new',
        email: 'emp@example.com',
      });
      mockMembers({ target: null });
      (mockDb.member.create as jest.Mock).mockResolvedValue({
        id: 'member_new',
      });
      (
        mockDb.employeeTrainingVideoCompletion.createMany as jest.Mock
      ).mockResolvedValue({
        count: 5,
      });
      mockTriggerEmail.mockRejectedValueOnce(new Error('Email service down'));

      const results = await service.inviteMembers({
        ...baseParams,
        invites: [
          { email: 'emp@example.com', roles: ['employee'], sendPortalEmail: true },
        ],
      });

      // A portal email was requested but the send failed — the member is still
      // added and emailSent: false signals the UI to offer a resend.
      expect(results[0].success).toBe(true);
      expect(results[0].emailSent).toBe(false);
    });

    it('should create invitation for admin role invites', async () => {
      (mockDb.user.findFirst as jest.Mock).mockResolvedValue(null);
      (mockDb.organization.findUnique as jest.Mock).mockResolvedValue({
        name: 'Test Org',
      });
      (mockDb.invitation.create as jest.Mock).mockResolvedValue({
        id: 'inv_new',
      });

      const results = await service.inviteMembers({
        ...baseParams,
        invites: [{ email: 'admin@example.com', roles: ['admin'] }],
      });

      expect(results[0].success).toBe(true);
      expect(mockDb.invitation.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            email: 'admin@example.com',
            role: 'admin',
            status: 'pending',
          }),
        }),
      );
    });

    // Regression (ENG-1357): the invite path must enforce the same role rules
    // as POST /v1/people — no owner, no comma-smuggled roles, no unknown or
    // over-privileged custom roles.
    describe('role authorization', () => {
      /** The caller re-invites themselves as an existing, active member. */
      function setupSelfInvite(callerRole: string) {
        (mockDb.user.findFirst as jest.Mock).mockResolvedValue({
          id: CALLER_USER_ID,
          email: 'caller@example.com',
          emailVerified: true,
        });
        mockMembers({
          callerRole,
          target: {
            id: 'member_caller',
            userId: CALLER_USER_ID,
            role: callerRole,
            deactivated: false,
            isActive: true,
          },
        });
      }

      function expectNoWrites() {
        expect(mockDb.member.create).not.toHaveBeenCalled();
        expect(mockDb.member.update).not.toHaveBeenCalled();
        expect(mockDb.invitation.create).not.toHaveBeenCalled();
      }

      const memberCreateKey = apiKeyAuth(['member:create']);

      it.each([
        ['an auditor session', 'employee,owner', sessionAuth],
        ['an auditor session', ' owner', sessionAuth],
        ['a member:create API key', 'employee,owner', memberCreateKey],
        ['a member:create API key', ' owner', memberCreateKey],
      ])(
        'rejects %s smuggling owner via "%s"',
        async (_label, role, authContext) => {
          setupSelfInvite('auditor');

          const results = await service.inviteMembers({
            ...baseParams,
            authContext,
            invites: [{ email: 'caller@example.com', roles: [role] }],
          });

          expect(results[0].success).toBe(false);
          expect(results[0].error).toContain('transfer-ownership');
          expectNoWrites();
        },
      );

      it('rejects an admin assigning owner directly', async () => {
        (mockDb.user.findFirst as jest.Mock).mockResolvedValue(null);

        const results = await service.inviteMembers({
          ...baseParams,
          invites: [{ email: 'new@example.com', roles: ['owner'] }],
        });

        expect(results[0].success).toBe(false);
        expect(results[0].error).toContain('transfer-ownership');
        expectNoWrites();
      });

      it('rejects an unknown custom role', async () => {
        (mockDb.user.findFirst as jest.Mock).mockResolvedValue(null);

        const results = await service.inviteMembers({
          ...baseParams,
          invites: [{ email: 'new@example.com', roles: ['ghost-role'] }],
        });

        expect(results[0].success).toBe(false);
        expect(results[0].error).toContain('Unknown organization role');
        expectNoWrites();
      });

      it('rejects a custom role with permissions beyond the caller', async () => {
        mockMembers({ callerRole: 'auditor' });
        (mockDb.user.findFirst as jest.Mock).mockResolvedValue(null);
        (mockDb.organizationRole.findMany as jest.Mock).mockResolvedValue([
          {
            name: 'member-manager',
            permissions: JSON.stringify({
              member: ['create', 'read', 'update', 'delete'],
            }),
          },
        ]);

        const results = await service.inviteMembers({
          ...baseParams,
          invites: [{ email: 'new@example.com', roles: ['member-manager'] }],
        });

        expect(results[0].success).toBe(false);
        expect(results[0].error).toContain(
          'exceeds your effective permissions',
        );
        expectNoWrites();
      });

      it('allows a custom role within the caller permissions', async () => {
        mockMembers({ callerRole: 'auditor' });
        (mockDb.user.findFirst as jest.Mock).mockResolvedValue(null);
        (mockDb.organization.findUnique as jest.Mock).mockResolvedValue({
          name: 'Test Org',
        });
        (mockDb.invitation.create as jest.Mock).mockResolvedValue({
          id: 'inv_viewer',
        });
        (mockDb.organizationRole.findMany as jest.Mock).mockResolvedValue([
          { name: 'viewer', permissions: JSON.stringify({ app: ['read'] }) },
        ]);

        const results = await service.inviteMembers({
          ...baseParams,
          invites: [{ email: 'new@example.com', roles: ['viewer'] }],
        });

        expect(results[0].success).toBe(true);
        expect(mockDb.invitation.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              role: 'viewer',
              inviterId: CALLER_USER_ID,
            }),
          }),
        );
      });

      it('writes the parsed, trimmed roles for an invitation', async () => {
        (mockDb.user.findFirst as jest.Mock).mockResolvedValue(null);
        (mockDb.organization.findUnique as jest.Mock).mockResolvedValue({
          name: 'Test Org',
        });
        (mockDb.invitation.create as jest.Mock).mockResolvedValue({
          id: 'inv_trim',
        });

        const results = await service.inviteMembers({
          ...baseParams,
          invites: [{ email: 'new@example.com', roles: [' admin '] }],
        });

        expect(results[0].success).toBe(true);
        expect(mockDb.invitation.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({ role: 'admin' }),
          }),
        );
      });

      it('adds comma-joined restricted roles directly as an employee', async () => {
        (mockDb.organization.findUnique as jest.Mock).mockResolvedValue({
          name: 'Test Org',
        });
        (mockDb.user.findFirst as jest.Mock).mockResolvedValue(null);
        (mockDb.user.create as jest.Mock).mockResolvedValue({ id: 'usr_emp' });
        (mockDb.member.create as jest.Mock).mockResolvedValue({
          id: 'mem_emp',
        });
        (
          mockDb.employeeTrainingVideoCompletion.createMany as jest.Mock
        ).mockResolvedValue({ count: 5 });

        const results = await service.inviteMembers({
          ...baseParams,
          invites: [
            { email: 'emp@example.com', roles: ['employee, contractor'] },
          ],
        });

        expect(results[0].success).toBe(true);
        expect(mockDb.invitation.create).not.toHaveBeenCalled();
        expect(mockDb.member.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({ role: 'employee,contractor' }),
          }),
        );
      });
    });

    describe('email flow by role combination', () => {
      function setupNewUserInvite() {
        (mockDb.user.findFirst as jest.Mock).mockResolvedValue(null);
        (mockDb.organization.findUnique as jest.Mock).mockResolvedValue({
          name: 'Test Org',
        });
        (mockDb.invitation.create as jest.Mock).mockResolvedValue({
          id: 'inv_new',
        });
      }

      it('admin + employee with portal checked: sends single app email with portal link', async () => {
        setupNewUserInvite();

        const results = await service.inviteMembers({
          ...baseParams,
          invites: [
            {
              email: 'both@example.com',
              roles: ['admin', 'employee'],
              sendPortalEmail: true,
            },
          ],
        });

        expect(results[0].success).toBe(true);
        expect(mockTriggerEmail).toHaveBeenCalledTimes(1);
        expect(mockInviteEmail).toHaveBeenCalledWith(
          expect.objectContaining({
            organizationName: 'Test Org',
            portalLink: expect.stringContaining('org_123'),
          }),
        );
        expect(mockInvitePortalEmail).not.toHaveBeenCalled();
      });

      it('employee only with portal checked: sends portal-only email', async () => {
        (mockDb.organization.findUnique as jest.Mock).mockResolvedValue({
          name: 'Test Org',
        });
        (mockDb.user.findFirst as jest.Mock).mockResolvedValue(null);
        (mockDb.user.create as jest.Mock).mockResolvedValue({
          id: 'usr_emp',
          email: 'emp@example.com',
        });
        mockMembers({ target: null });
        (mockDb.member.create as jest.Mock).mockResolvedValue({
          id: 'mem_emp',
        });
        (
          mockDb.employeeTrainingVideoCompletion.createMany as jest.Mock
        ).mockResolvedValue({ count: 5 });

        const results = await service.inviteMembers({
          ...baseParams,
          invites: [
            {
              email: 'emp@example.com',
              roles: ['employee'],
              sendPortalEmail: true,
            },
          ],
        });

        expect(results[0].success).toBe(true);
        expect(mockTriggerEmail).toHaveBeenCalledTimes(1);
        expect(mockInvitePortalEmail).toHaveBeenCalledWith(
          expect.objectContaining({
            organizationName: 'Test Org',
            email: 'emp@example.com',
          }),
        );
        expect(mockInviteEmail).not.toHaveBeenCalled();
      });

      // Regression: unchecking "Send portal invite email" when adding an
      // employee via "+ Add User" must add the member WITHOUT emailing them.
      // Previously the else-branch still sent an InviteEmail with a portal link.
      it('employee only with portal UNchecked: adds member silently, sends no email', async () => {
        (mockDb.organization.findUnique as jest.Mock).mockResolvedValue({
          name: 'Test Org',
        });
        (mockDb.user.findFirst as jest.Mock).mockResolvedValue(null);
        (mockDb.user.create as jest.Mock).mockResolvedValue({
          id: 'usr_emp',
          email: 'emp@example.com',
        });
        mockMembers({ target: null });
        (mockDb.member.create as jest.Mock).mockResolvedValue({ id: 'mem_emp' });
        (
          mockDb.employeeTrainingVideoCompletion.createMany as jest.Mock
        ).mockResolvedValue({ count: 5 });

        const results = await service.inviteMembers({
          ...baseParams,
          invites: [
            {
              email: 'emp@example.com',
              roles: ['employee'],
              sendPortalEmail: false,
            },
          ],
        });

        // Member is still created...
        expect(results[0].success).toBe(true);
        expect(mockDb.member.create).toHaveBeenCalled();
        // ...but NO email of any kind goes out when the portal invite is off.
        expect(mockTriggerEmail).not.toHaveBeenCalled();
        expect(mockInvitePortalEmail).not.toHaveBeenCalled();
        expect(mockInviteEmail).not.toHaveBeenCalled();
        // And no false "could not be sent" warning leaks to the UI.
        expect(results[0].emailSent).toBeUndefined();
      });

      it('admin only (no portal): sends app email without portal link', async () => {
        setupNewUserInvite();

        const results = await service.inviteMembers({
          ...baseParams,
          invites: [
            {
              email: 'admin@example.com',
              roles: ['admin'],
              sendPortalEmail: false,
            },
          ],
        });

        expect(results[0].success).toBe(true);
        expect(mockTriggerEmail).toHaveBeenCalledTimes(1);
        expect(mockInviteEmail).toHaveBeenCalledWith(
          expect.objectContaining({ organizationName: 'Test Org' }),
        );
        expect(mockInviteEmail).toHaveBeenCalledWith(
          expect.not.objectContaining({
            portalLink: expect.anything(),
          }),
        );
        expect(mockInvitePortalEmail).not.toHaveBeenCalled();
      });

      it('admin with portal checked but no compliance obligation: sends app email without portal', async () => {
        setupNewUserInvite();

        const results = await service.inviteMembers({
          ...baseParams,
          invites: [
            {
              email: 'admin2@example.com',
              roles: ['admin'],
              sendPortalEmail: true,
            },
          ],
        });

        expect(results[0].success).toBe(true);
        expect(mockTriggerEmail).toHaveBeenCalledTimes(1);
        expect(mockInviteEmail).toHaveBeenCalledWith(
          expect.objectContaining({ organizationName: 'Test Org' }),
        );
        expect(mockInvitePortalEmail).not.toHaveBeenCalled();
      });
    });
  });
});
