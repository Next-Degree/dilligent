import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { HybridAuthGuard } from '../auth/hybrid-auth.guard';
import { PERMISSIONS_KEY, PermissionGuard } from '../auth/permission.guard';
import { PortalTasksController } from './portal-tasks.controller';
import { PortalTasksService } from './portal-tasks.service';

jest.mock('../auth/auth.server', () => ({
  auth: { api: { getSession: jest.fn() } },
}));

jest.mock('@trycompai/auth', () => ({
  statement: {},
  BUILT_IN_ROLE_PERMISSIONS: {},
}));

describe('PortalTasksController', () => {
  let controller: PortalTasksController;

  const mockService = {
    listForManagement: jest.fn(),
    listAssigned: jest.fn(),
    listCompletions: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    archive: jest.fn(),
    complete: jest.fn(),
  };

  const mockGuard = { canActivate: jest.fn().mockReturnValue(true) };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PortalTasksController],
      providers: [{ provide: PortalTasksService, useValue: mockService }],
    })
      .overrideGuard(HybridAuthGuard)
      .useValue(mockGuard)
      .overrideGuard(PermissionGuard)
      .useValue(mockGuard)
      .compile();

    controller = module.get<PortalTasksController>(PortalTasksController);

    jest.clearAllMocks();
  });

  it('parses the includeArchived query flag', async () => {
    await controller.list('org_1', 'true');
    expect(mockService.listForManagement).toHaveBeenCalledWith('org_1', true);

    await controller.list('org_1');
    expect(mockService.listForManagement).toHaveBeenLastCalledWith(
      'org_1',
      false,
    );
  });

  it('requires a session for the portal-facing endpoints', async () => {
    await expect(controller.listAssigned(undefined, 'org_1')).rejects.toThrow(
      BadRequestException,
    );
    await expect(
      controller.complete('org_1', undefined, 'ptsk_1'),
    ).rejects.toThrow(BadRequestException);
  });

  it('passes the authenticated member through to completion', async () => {
    await controller.complete('org_1', 'mem_1', 'ptsk_1');
    expect(mockService.complete).toHaveBeenCalledWith(
      'org_1',
      'mem_1',
      'ptsk_1',
    );
  });

  it('attributes created tasks to the authenticated member', async () => {
    const body = { title: 'Acknowledge handbook' };
    await controller.create('org_1', 'mem_1', body);
    expect(mockService.create).toHaveBeenCalledWith('org_1', 'mem_1', body);
  });

  describe('RBAC - permission decorators', () => {
    const cases: Array<[keyof PortalTasksController, string, string]> = [
      ['listAssigned', 'portal', 'read'],
      ['complete', 'portal', 'update'],
      ['list', 'task', 'read'],
      ['listCompletions', 'task', 'read'],
      ['create', 'task', 'create'],
      ['update', 'task', 'update'],
      ['archive', 'task', 'delete'],
    ];

    it.each(cases)('%s requires %s:%s', (method, resource, action) => {
      const permissions = Reflect.getMetadata(
        PERMISSIONS_KEY,
        controller[method],
      );
      expect(permissions).toEqual([{ resource, actions: [action] }]);
    });
  });
});
