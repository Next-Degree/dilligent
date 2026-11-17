import { ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PeopleInviteService } from './people-invite.service';
import { TimelinesService } from '../timelines/timelines.service';
import type { AuthContext } from '../auth/types';

jest.mock('@db', () => ({
  BackgroundCheckStatus: {
    completed: 'completed',
    completed_with_flags: 'completed_with_flags',
  },
  db: {
    organization: { findUnique: jest.fn() },
    user: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
    member: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
    invitation: { create: jest.fn() },
    employeeTrainingVideoCompletion: { createMany: jest.fn() },
    frameworkInstance: { findFirst: jest.fn() },
    organizationRole: { findMany: jest.fn() },
  },
}));
// Real role tables (admin vs auditor vs key scopes). better-auth ships ESM,
// so stub its access helpers the way training/portal-access.spec.ts does.
jest.mock('@trycompai/auth', () =>
  jest.requireActual('../../../../packages/auth/src/permissions'),
);
jest.mock('better-auth/plugins/access', () => ({
  createAccessControl: () => ({
    newRole: (statements: Record<string, readonly string[]>) => ({
      statements,
    }),
  }),
}));
jest.mock('better-auth/plugins/organization/access', () => {
  const crud = ['create', 'update', 'delete'];
  return {
    defaultStatements: {
      organization: ['update', 'delete'],
      member: crud,
      invitation: ['create', 'delete'],
      team: crud,
      ac: ['create', 'read', 'update', 'delete'],
    },
    ownerAc: { statements: {} },
    adminAc: { statements: {} },
  };
});
jest.mock('../email/trigger-email', () => ({
  triggerEmail: jest.fn().mockResolvedValue({ id: 'trigger_1' }),
}));
jest.mock('../frameworks/frameworks-timeline.helper', () => ({
  checkAutoCompletePhases: jest.fn().mockResolvedValue(undefined),
}));
const mockInviteEmail = jest.fn().mockReturnValue('app-email');
jest.mock('../email/templates/invite-member', () => ({
  InviteEmail: (...args: unknown[]) => mockInviteEmail(...args),
}));
jest.mock('@trycompai/email', () => ({
  InvitePortalEmail: jest.fn().mockReturnValue('portal-email'),
}));

import { db } from '@db';
import { statement } from '@trycompai/auth';

const CALLER = 'usr_caller';
const ORG = 'org_123';
const mockDb = jest.mocked(db);
const mock = (fn: unknown) => fn as jest.Mock;

const session = (overrides: Partial<AuthContext> = {}): AuthContext => ({
  organizationId: ORG,
  authType: 'session',
  isApiKey: false,
  isPlatformAdmin: false,
  userId: CALLER,
  userRoles: null,
  ...overrides,
});
const apiKey = (apiKeyScopes: string[]): AuthContext => ({
  organizationId: ORG,
  authType: 'api-key',
  isApiKey: true,
  isPlatformAdmin: false,
  userRoles: null,
  apiKeyScopes,
});
/** Every scope a key can hold, as the API key settings page offers. */
const FULL_ACCESS_SCOPES = Object.entries(statement)
  .filter(([resource]) => !['invitation', 'team'].includes(resource))
  .flatMap(([resource, actions]) => actions.map((a) => `${resource}:${a}`));

/** Route the caller's own membership lookup apart from the invitee lookup. */
function mockMembers({
  callerRole,
  target = null,
}: {
  callerRole: string;
  target?: object | null;
}) {
  mock(mockDb.member.findFirst).mockImplementation(
    async (args: { where: { userId?: string; isActive?: boolean } }) =>
      args.where.userId === CALLER && args.where.isActive === true
        ? { role: callerRole }
        : target,
  );
}
function mockCustomRoles(roles: Record<string, object>) {
  mock(mockDb.organizationRole.findMany).mockImplementation(
    async (args: { where: { name: { in: string[] } } }) =>
      args.where.name.in
        .filter((name) => Object.hasOwn(roles, name))
        .map((name) => ({
          name,
          permissions: JSON.stringify(roles[name]),
          obligations: JSON.stringify({ compliance: true }),
        })),
  );
}
const callerLookups = () =>
  mock(mockDb.member.findFirst).mock.calls.filter(
    ([args]: [{ where: { isActive?: boolean } }]) => args.where.isActive,
  ).length;
const existing = (fields: object) => ({
  id: 'mem_target',
  userId: 'usr_target',
  role: 'employee',
  isActive: true,
  deactivated: false,
  ...fields,
});

describe('PeopleInviteService authorization', () => {
  let service: PeopleInviteService;
  const invite = (authContext: AuthContext, email: string, roles: string[]) =>
    service.inviteMembers({
      organizationId: ORG,
      authContext,
      invites: [{ email, roles, sendPortalEmail: true }],
    });

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        PeopleInviteService,
        { provide: TimelinesService, useValue: {} },
      ],
    }).compile();
    service = module.get(PeopleInviteService);
    mockMembers({ callerRole: 'admin' });
    mockCustomRoles({});
    mock(mockDb.organization.findUnique).mockResolvedValue({ name: 'Org' });
    mock(mockDb.user.findFirst).mockResolvedValue(null);
    mock(mockDb.user.create).mockResolvedValue({ id: 'usr_new' });
    mock(mockDb.member.create).mockResolvedValue({ id: 'mem_new' });
    mock(mockDb.invitation.create).mockResolvedValue({ id: 'inv_1' });
  });

  describe('caller checks', () => {
    it('rejects a caller without member:create with one 403 before any row', async () => {
      mockMembers({ callerRole: 'employee' });

      await expect(
        invite(session(), 'a@example.com', ['employee']),
      ).rejects.toThrow(ForbiddenException);
      expect(mockDb.user.findFirst).not.toHaveBeenCalled();
    });

    it('resolves the caller once for a multi-row invite', async () => {
      await service.inviteMembers({
        organizationId: ORG,
        authContext: session(),
        invites: ['a', 'b', 'c'].map((n) => ({
          email: `${n}@example.com`,
          roles: ['employee'],
        })),
      });

      expect(callerLookups()).toBe(1);
    });

    it('loads custom roles once per row and reuses them for the email', async () => {
      mockCustomRoles({ viewer: { app: ['read'] } });

      const [result] = await invite(session(), 'v@example.com', ['viewer']);

      expect(result.success).toBe(true);
      expect(mockDb.organizationRole.findMany).toHaveBeenCalledTimes(1);
      expect(mockInviteEmail).toHaveBeenCalledWith(
        expect.objectContaining({ portalLink: expect.any(String) }),
      );
    });

    it('treats a role named "constructor" as a custom role', async () => {
      mockCustomRoles({ constructor: { app: ['read'] } });

      const [result] = await invite(session(), 'c@example.com', [
        'constructor',
      ]);

      expect(result.success).toBe(true);
      expect(mockInviteEmail).toHaveBeenCalledWith(
        expect.objectContaining({ portalLink: expect.any(String) }),
      );
    });

    it('lets a platform admin invite without member:create in their membership', async () => {
      mockMembers({ callerRole: 'employee' });

      const [ok] = await invite(
        session({ isPlatformAdmin: true }),
        'a@example.com',
        ['admin'],
      );
      const [owner] = await invite(
        session({ isPlatformAdmin: true }),
        'b@example.com',
        ['owner'],
      );

      expect(ok).toMatchObject({ success: true });
      expect(owner.error).toContain('transfer-ownership');
    });
  });

  describe('admin and auditor need admin-level permissions', () => {
    beforeEach(() => {
      mockMembers({ callerRole: 'people-ops' });
      mockCustomRoles({
        'people-ops': {
          member: ['create', 'read', 'update', 'delete'],
          app: ['read'],
        },
      });
    });

    it.each(['admin', 'auditor', 'employee,admin', ' auditor'])(
      'rejects a member-CRUD-only role assigning %s',
      async (role) => {
        const [result] = await invite(session(), 'alt@example.com', [role]);

        expect(result.error).toContain('privileged role');
        expect(mockDb.invitation.create).not.toHaveBeenCalled();
      },
    );

    it('lets an admin assign auditor', async () => {
      mockMembers({ callerRole: 'admin' });

      const [result] = await invite(session(), 'aud@example.com', ['auditor']);

      expect(result.success).toBe(true);
    });
  });

  describe('API keys', () => {
    beforeEach(() => {
      mockMembers({ callerRole: 'admin', target: { userId: 'usr_owner' } });
      mockCustomRoles({ recruiter: { app: ['read'], invitation: ['create'] } });
    });

    it('lets a Full Access key assign admin and invitation-granting roles', async () => {
      const key = apiKey(FULL_ACCESS_SCOPES);

      const [admin] = await invite(key, 'a@example.com', ['admin']);
      const [recruiter] = await invite(key, 'r@example.com', ['recruiter']);

      expect(admin).toMatchObject({ success: true });
      expect(recruiter).toMatchObject({ success: true });
    });

    it('explains why a narrower key cannot assign invitation permissions', async () => {
      const key = apiKey(['member:create', 'app:read']);

      const [result] = await invite(key, 'r@example.com', ['recruiter']);

      expect(result.error).toContain('only a Full Access API key');
    });

    it('tells a key missing one admin scope to use a new Full Access key', async () => {
      const key = apiKey(FULL_ACCESS_SCOPES.filter((s) => s !== 'secret:read'));

      const [result] = await invite(key, 'a@example.com', ['admin']);

      expect(result.error).toContain('create a new Full Access key');
    });
  });

  it('resends a portal invite for a compliance custom role named "constructor"', async () => {
    mockCustomRoles({ constructor: { app: ['read'] } });
    mockMembers({
      callerRole: 'admin',
      target: {
        role: 'constructor',
        user: { email: 'c@example.com' },
        organization: { name: 'Org' },
      },
    });

    await expect(
      service.resendPortalInvite({ organizationId: ORG, memberId: 'mem_c' }),
    ).resolves.toEqual({ success: true });
  });

  it.each(['process owner', 'Owner', 'ADMIN'])(
    'rejects the custom role name "%s", which reads as owner/admin',
    async (name) => {
      mockCustomRoles({ [name]: { app: ['read'] } });

      const [result] = await invite(session(), 'p@example.com', [name]);

      expect(result.error).toContain('cannot contain "owner" or "admin"');
      expect(mockDb.organizationRole.findMany).not.toHaveBeenCalled();
    },
  );

  describe('existing members follow the PATCH role-change rules', () => {
    const inviteExisting = (
      target: object,
      roles: string[],
      callerRole = 'admin',
      authContext = session(),
    ) => {
      mockMembers({ callerRole, target });
      mock(mockDb.user.findFirst).mockResolvedValue({
        id: 'usr_target',
        emailVerified: true,
      });
      return invite(authContext, 'target@example.com', roles);
    };
    const memberKey = apiKey(['member:create', 'member:update']);

    it('lets a key with member:update add a role to an existing member', async () => {
      const [result] = await inviteExisting(
        existing({}),
        ['contractor'],
        'admin',
        memberKey,
      );

      expect(result).toMatchObject({ success: true });
      expect(mockDb.member.update).toHaveBeenCalledWith({
        where: { id: 'mem_target' },
        data: { role: 'contractor,employee' },
      });
    });

    it('keeps a stale custom role the member already holds', async () => {
      const [result] = await inviteExisting(
        existing({ role: 'employee,Renamed Role' }),
        ['contractor'],
      );

      expect(result).toMatchObject({ success: true });
      expect(mockDb.member.update).toHaveBeenCalledWith({
        where: { id: 'mem_target' },
        data: { role: 'Renamed Role,contractor,employee' },
      });
    });

    it('rejects a member-CRUD-only role changing an existing admin', async () => {
      mockCustomRoles({
        'people-ops': {
          member: ['create', 'read', 'update', 'delete'],
          app: ['read'],
        },
      });

      const [result] = await inviteExisting(
        existing({ role: 'admin' }),
        ['employee'],
        'people-ops',
      );

      expect(result.error).toContain('cannot change the roles of this member');
      expect(mockDb.member.update).not.toHaveBeenCalled();
    });

    it('reactivates an inactive member that is not flagged deactivated', async () => {
      const [result] = await inviteExisting(existing({ isActive: false }), [
        'admin',
      ]);

      expect(result.success).toBe(true);
      expect(mockDb.member.update).toHaveBeenCalledWith({
        where: { id: 'mem_target' },
        data: { deactivated: false, isActive: true, role: 'admin' },
      });
      expect(mockDb.invitation.create).not.toHaveBeenCalled();
    });

    it('requires member:update to reactivate a member', async () => {
      const [result] = await inviteExisting(
        existing({ deactivated: true }),
        ['employee'],
        'auditor',
      );

      expect(result.error).toContain('permission to update members');
      expect(mockDb.member.update).not.toHaveBeenCalled();
    });

    it('rejects callers adding roles to themselves', async () => {
      const [result] = await inviteExisting(
        existing({ userId: CALLER, role: 'admin' }),
        ['auditor'],
      );

      expect(result.error).toContain('cannot change your own role');
      expect(mockDb.member.update).not.toHaveBeenCalled();
    });

    it.each([
      [
        'demoting a deactivated owner',
        { role: 'owner', deactivated: true },
        'transfer-ownership',
      ],
      ['adding roles to an owner', { role: 'owner' }, 'Only an owner'],
    ])('rejects an admin %s', async (_label, fields, message) => {
      const [result] = await inviteExisting(existing(fields), ['auditor']);

      expect(result.error).toContain(message);
      expect(mockDb.member.update).not.toHaveBeenCalled();
    });

    it('rejects an API key adding roles to an owner', async () => {
      const [result] = await inviteExisting(
        existing({ role: 'owner' }),
        ['contractor'],
        'admin',
        memberKey,
      );

      expect(result.error).toContain('Only an owner');
      expect(mockDb.member.update).not.toHaveBeenCalled();
    });
  });
});
