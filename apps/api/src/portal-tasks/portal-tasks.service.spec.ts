import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { PortalTasksService } from './portal-tasks.service';
import { PortalTaskKindDto } from './dto/create-portal-task.dto';

jest.mock('@db', () => ({
  db: {
    portalTask: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    portalTaskCompletion: {
      findMany: jest.fn(),
      upsert: jest.fn(),
    },
    member: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
  },
}));

jest.mock('../utils/compliance-filters', () => ({
  filterComplianceMembers: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { db } = require('@db') as {
  db: {
    portalTask: {
      findMany: jest.Mock;
      findFirst: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    portalTaskCompletion: { findMany: jest.Mock; upsert: jest.Mock };
    member: { findMany: jest.Mock; findFirst: jest.Mock };
  };
};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { filterComplianceMembers } = require('../utils/compliance-filters') as {
  filterComplianceMembers: jest.Mock;
};

const organizationId = 'org_1';

describe('PortalTasksService', () => {
  let service: PortalTasksService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [PortalTasksService],
    }).compile();

    service = module.get<PortalTasksService>(PortalTasksService);
  });

  describe('listForManagement', () => {
    it('counts only completions from members still in the portal audience', async () => {
      db.portalTask.findMany.mockResolvedValue([
        {
          id: 'ptsk_1',
          title: 'Acknowledge handbook',
          completions: [
            { memberId: 'mem_active' },
            { memberId: 'mem_departed' },
          ],
        },
      ]);
      db.member.findMany.mockResolvedValue([
        { id: 'mem_active', role: 'employee', user: { role: null } },
      ]);
      filterComplianceMembers.mockResolvedValue([
        { id: 'mem_active', role: 'employee', user: { role: null } },
      ]);

      const [task] = await service.listForManagement(organizationId);

      expect(task.completedCount).toBe(1);
      expect(task.audienceCount).toBe(1);
    });

    it('hides archived tasks unless explicitly requested', async () => {
      db.portalTask.findMany.mockResolvedValue([]);
      db.member.findMany.mockResolvedValue([]);
      filterComplianceMembers.mockResolvedValue([]);

      await service.listForManagement(organizationId);
      expect(db.portalTask.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { organizationId, isArchived: false },
        }),
      );

      await service.listForManagement(organizationId, true);
      expect(db.portalTask.findMany).toHaveBeenLastCalledWith(
        expect.objectContaining({ where: { organizationId } }),
      );
    });
  });

  describe('create', () => {
    it('rejects a link task with no destination', async () => {
      await expect(
        service.create(organizationId, 'mem_1', {
          title: 'Read the handbook',
          kind: PortalTaskKindDto.link,
        }),
      ).rejects.toThrow(BadRequestException);
      expect(db.portalTask.create).not.toHaveBeenCalled();
    });

    it('creates tasks as unpublished drafts by default', async () => {
      db.portalTask.create.mockResolvedValue({ id: 'ptsk_1' });

      await service.create(organizationId, 'mem_1', { title: 'Acknowledge' });

      expect(db.portalTask.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          organizationId,
          isPublished: false,
          isRequired: true,
          kind: 'acknowledgement',
          createdByMemberId: 'mem_1',
        }),
      });
    });
  });

  describe('update', () => {
    it('rejects switching to link without a stored or incoming url', async () => {
      db.portalTask.findFirst.mockResolvedValue({
        id: 'ptsk_1',
        kind: 'acknowledgement',
        externalUrl: null,
      });

      await expect(
        service.update(organizationId, 'ptsk_1', {
          kind: PortalTaskKindDto.link,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('keeps the stored url when switching kind without sending one', async () => {
      db.portalTask.findFirst.mockResolvedValue({
        id: 'ptsk_1',
        kind: 'acknowledgement',
        externalUrl: 'https://example.com/handbook',
      });
      db.portalTask.update.mockResolvedValue({ id: 'ptsk_1' });

      await service.update(organizationId, 'ptsk_1', {
        kind: PortalTaskKindDto.link,
      });

      expect(db.portalTask.update).toHaveBeenCalledWith({
        where: { id: 'ptsk_1' },
        data: { kind: 'link' },
      });
    });

    it('throws for a task belonging to another organization', async () => {
      db.portalTask.findFirst.mockResolvedValue(null);

      await expect(
        service.update(organizationId, 'ptsk_other', { title: 'Nope' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('archive', () => {
    it('soft-archives so completion evidence survives', async () => {
      db.portalTask.findFirst.mockResolvedValue({ id: 'ptsk_1' });
      db.portalTask.update.mockResolvedValue({ id: 'ptsk_1' });

      await service.archive(organizationId, 'ptsk_1');

      expect(db.portalTask.update).toHaveBeenCalledWith({
        where: { id: 'ptsk_1' },
        data: { isArchived: true },
      });
    });
  });

  describe('listAssigned', () => {
    it('returns published tasks with this member completion state', async () => {
      db.member.findFirst.mockResolvedValue({ id: 'mem_1' });
      db.portalTask.findMany.mockResolvedValue([
        {
          id: 'ptsk_1',
          title: 'A',
          completions: [{ completedAt: new Date(1) }],
        },
        { id: 'ptsk_2', title: 'B', completions: [] },
      ]);

      const tasks = await service.listAssigned(organizationId, 'mem_1');

      expect(db.portalTask.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { organizationId, isPublished: true, isArchived: false },
        }),
      );
      expect(tasks[0].completedAt).toEqual(new Date(1));
      expect(tasks[1].completedAt).toBeNull();
      expect(tasks[0]).not.toHaveProperty('completions');
    });

    it('throws for a deactivated member', async () => {
      db.member.findFirst.mockResolvedValue(null);

      await expect(
        service.listAssigned(organizationId, 'mem_gone'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('complete', () => {
    it('snapshots the acknowledgement wording and stays idempotent', async () => {
      db.member.findFirst.mockResolvedValue({ id: 'mem_1' });
      db.portalTask.findFirst.mockResolvedValue({
        id: 'ptsk_1',
        acknowledgementText: 'I agree to the handbook.',
      });
      db.portalTaskCompletion.upsert.mockResolvedValue({ id: 'ptc_1' });

      await service.complete(organizationId, 'mem_1', 'ptsk_1');

      expect(db.portalTaskCompletion.upsert).toHaveBeenCalledWith({
        where: {
          portalTaskId_memberId: { portalTaskId: 'ptsk_1', memberId: 'mem_1' },
        },
        create: {
          portalTaskId: 'ptsk_1',
          memberId: 'mem_1',
          acknowledgedText: 'I agree to the handbook.',
        },
        update: {},
      });
    });

    it('refuses to complete an unpublished or archived task', async () => {
      db.member.findFirst.mockResolvedValue({ id: 'mem_1' });
      db.portalTask.findFirst.mockResolvedValue(null);

      await expect(
        service.complete(organizationId, 'mem_1', 'ptsk_draft'),
      ).rejects.toThrow(NotFoundException);
      expect(db.portalTaskCompletion.upsert).not.toHaveBeenCalled();
    });
  });

  describe('listCompletions', () => {
    it('lists the whole audience, outstanding members included', async () => {
      db.portalTask.findFirst.mockResolvedValue({ id: 'ptsk_1' });
      db.member.findMany.mockResolvedValue([]);
      filterComplianceMembers.mockResolvedValue([
        {
          id: 'mem_1',
          role: 'employee',
          user: { name: 'Ada', email: 'ada@x.com' },
        },
        {
          id: 'mem_2',
          role: 'employee',
          user: { name: 'Bo', email: 'bo@x.com' },
        },
      ]);
      db.portalTaskCompletion.findMany.mockResolvedValue([
        { memberId: 'mem_1', completedAt: new Date(1) },
      ]);

      const rows = await service.listCompletions(organizationId, 'ptsk_1');

      expect(rows).toEqual([
        {
          memberId: 'mem_1',
          name: 'Ada',
          email: 'ada@x.com',
          completedAt: new Date(1),
        },
        { memberId: 'mem_2', name: 'Bo', email: 'bo@x.com', completedAt: null },
      ]);
    });
  });
});
