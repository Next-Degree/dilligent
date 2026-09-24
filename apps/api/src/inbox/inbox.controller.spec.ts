// Stub the dependencies HybridAuthGuard pulls in so the controller can be
// imported without booting Prisma or better-auth. Guards are tested elsewhere.
jest.mock('@db', () => ({ db: {} }));
jest.mock('@trycompai/auth', () => ({
  statement: {},
  ac: { newRole: () => ({}) },
}));
jest.mock('../auth/auth.server', () => ({
  auth: { api: { getSession: jest.fn() } },
}));

import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { HybridAuthGuard } from '../auth/hybrid-auth.guard';
import { PERMISSIONS_KEY, PermissionGuard } from '../auth/permission.guard';
import type { AuthContext } from '../auth/types';
import { InboxController } from './inbox.controller';
import { InboxService } from './inbox.service';

const AUTH: AuthContext = {
  organizationId: 'org_1',
  authType: 'session',
  isApiKey: false,
  isPlatformAdmin: false,
  userRoles: ['admin'],
};

const permissionsFor = (controller: object, method: string) =>
  new Reflector().get<Array<{ resource: string; actions: string[] }>>(
    PERMISSIONS_KEY,
    (controller as Record<string, () => unknown>)[method],
  );

describe('InboxController', () => {
  let controller: InboxController;
  const inboxService = { list: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    inboxService.list.mockResolvedValue({ items: [], totals: {} });

    const moduleRef = await Test.createTestingModule({
      controllers: [InboxController],
      providers: [{ provide: InboxService, useValue: inboxService }],
    })
      .overrideGuard(HybridAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = moduleRef.get(InboxController);
  });

  it('is gated on app:read', () => {
    expect(permissionsFor(InboxController.prototype, 'list')).toEqual([
      { resource: 'app', actions: ['read'] },
    ]);
  });

  it('defaults to 100 items', async () => {
    await controller.list(AUTH, {});

    expect(inboxService.list).toHaveBeenCalledWith({ auth: AUTH, limit: 100 });
  });

  it('passes an explicit limit through', async () => {
    await controller.list(AUTH, { limit: 5 });

    expect(inboxService.list).toHaveBeenCalledWith({ auth: AUTH, limit: 5 });
  });

  it('returns the standard list envelope plus per-kind totals', async () => {
    const item = {
      key: 'v1:task-failed:tsk_1',
      kind: 'task-failed' as const,
      severity: 'critical' as const,
      title: 'T',
      detail: 'D',
      path: 'tasks/tsk_1',
      occurredAt: new Date('2026-09-20T00:00:00Z'),
      assigneeMemberId: null,
    };
    inboxService.list.mockResolvedValue({
      items: [item],
      totals: { 'task-failed': 9 },
    });

    await expect(controller.list(AUTH, {})).resolves.toEqual({
      data: [item],
      count: 1,
      totals: { 'task-failed': 9 },
    });
  });
});
