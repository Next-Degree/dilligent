import { BadRequestException } from '@nestjs/common';
import {
  GENERAL,
  createCompletionTable,
  row,
  rowsFor,
} from './training-fixtures-spec';
import { TrainingService } from './training.service';

jest.mock('@db', () => ({
  db: {
    member: { findFirst: jest.fn(), findUnique: jest.fn() },
    frameworkInstance: { findFirst: jest.fn() },
    employeeTrainingVideoCompletion: {
      findMany: jest.fn(),
      upsert: jest.fn(),
      update: jest.fn(),
    },
  },
}));

const { db } = jest.requireMock('@db');

const mockEmailService = {
  sendTrainingCompletedEmail: jest.fn(),
  sendHipaaTrainingCompletedEmail: jest.fn(),
};

const mockCertService = {
  generateTrainingCertificatePdf: jest.fn(),
  generateHipaaCertificatePdf: jest.fn(),
};

const table = createCompletionTable();

const cycleKey = ({ videoId, cycle }: { videoId: string; cycle: number }) => ({
  memberId_videoId_cycle: { memberId: 'mem_1', videoId, cycle },
});

describe('TrainingService renewal cycles', () => {
  let service: TrainingService;

  beforeEach(() => {
    jest.resetAllMocks();
    table.rows = [];
    service = new TrainingService(
      mockEmailService as never,
      mockCertService as never,
    );

    db.member.findFirst.mockResolvedValue({
      id: 'mem_1',
      organizationId: 'org_1',
    });
    db.member.findUnique.mockResolvedValue({
      id: 'mem_1',
      organizationId: 'org_1',
      user: { email: 'a@example.com', name: 'Ada' },
      organization: { name: 'Acme' },
    });
    db.frameworkInstance.findFirst.mockResolvedValue({ id: 'frm_1' });
    db.employeeTrainingVideoCompletion.findMany.mockImplementation(
      table.findMany,
    );
    db.employeeTrainingVideoCompletion.upsert.mockImplementation(table.upsert);
  });

  describe('markVideoComplete', () => {
    it('records a first completion on cycle 1, upserting on the cycle aware key', async () => {
      await service.markVideoComplete('mem_1', 'org_1', 'sat-1');

      expect(db.employeeTrainingVideoCompletion.upsert).toHaveBeenCalledWith({
        where: cycleKey({ videoId: 'sat-1', cycle: 1 }),
        create: expect.objectContaining({
          memberId: 'mem_1',
          videoId: 'sat-1',
          cycle: 1,
          completedAt: expect.any(Date),
        }),
        update: {},
      });
    });

    it('stamps a pre-existing pending row whose completedAt is still null', async () => {
      table.rows = [row({ videoId: 'sat-1', days: null })];
      db.employeeTrainingVideoCompletion.update.mockResolvedValue({
        ...table.rows[0],
        completedAt: new Date(),
      });

      await service.markVideoComplete('mem_1', 'org_1', 'sat-1');

      expect(db.employeeTrainingVideoCompletion.update).toHaveBeenCalledWith({
        where: { id: 'evc_sat-1_1' },
        data: { completedAt: expect.any(Date) },
      });
    });

    it('does not touch a module that is already completed in the active cycle', async () => {
      table.rows = [row({ videoId: 'sat-1', days: 3 })];

      const result = await service.markVideoComplete('mem_1', 'org_1', 'sat-1');

      expect(result).toBe(table.rows[0]);
      expect(db.employeeTrainingVideoCompletion.upsert).not.toHaveBeenCalled();
    });

    it('does not start a renewal while the training is still comfortably valid', async () => {
      table.rows = rowsFor({ videoIds: GENERAL, days: 30 });

      const result = await service.markVideoComplete('mem_1', 'org_1', 'sat-1');

      expect(result).toBe(table.rows[0]);
      expect(db.employeeTrainingVideoCompletion.upsert).not.toHaveBeenCalled();
    });

    it('records a renewal on cycle 2 once the renewal window has opened', async () => {
      table.rows = rowsFor({ videoIds: GENERAL, days: 330 });

      await service.markVideoComplete('mem_1', 'org_1', 'sat-1');

      expect(db.employeeTrainingVideoCompletion.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: cycleKey({ videoId: 'sat-1', cycle: 2 }),
        }),
      );
    });

    it('records a renewal on cycle 2 for an expired member', async () => {
      table.rows = rowsFor({ videoIds: GENERAL, days: 400 });

      await service.markVideoComplete('mem_1', 'org_1', 'sat-3');

      expect(db.employeeTrainingVideoCompletion.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: cycleKey({ videoId: 'sat-3', cycle: 2 }),
        }),
      );
    });

    it('rejects unknown training ids', async () => {
      await expect(
        service.markVideoComplete('mem_1', 'org_1', 'unknown-id'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('lookups', () => {
    it('reports general training as not complete when modules are missing', async () => {
      table.rows = rowsFor({ videoIds: GENERAL.slice(0, 2), days: 5 });

      await expect(
        service.sendTrainingCompletionEmailIfComplete('mem_1', 'org_1'),
      ).resolves.toEqual({ sent: false, reason: 'training_not_complete' });
      await expect(
        service.generateCertificate('mem_1', 'org_1'),
      ).resolves.toEqual({ error: 'training_not_complete' });
    });

    it('reports HIPAA training as not complete when it was never done', async () => {
      await expect(
        service.sendHipaaCompletionEmailIfComplete('mem_1', 'org_1'),
      ).resolves.toEqual({
        sent: false,
        reason: 'hipaa_training_not_complete',
      });
      await expect(
        service.generateHipaaCertificate('mem_1', 'org_1'),
      ).resolves.toEqual({ error: 'hipaa_training_not_complete' });
    });

    it('dates the certificate from the latest fully completed cycle, not a partial renewal', async () => {
      mockCertService.generateTrainingCertificatePdf.mockResolvedValue(
        Buffer.from('pdf'),
      );
      const firstCycle = rowsFor({ videoIds: GENERAL, days: 400 });
      table.rows = [
        ...firstCycle,
        row({ videoId: 'sat-1', cycle: 2, days: 1 }),
      ];
      const newestFirstCycle = new Date(
        Math.max(...firstCycle.map((r) => r.completedAt?.getTime() ?? 0)),
      );

      const result = await service.generateCertificate('mem_1', 'org_1');

      expect('pdf' in result).toBe(true);
      expect(
        mockCertService.generateTrainingCertificatePdf,
      ).toHaveBeenCalledWith(
        expect.objectContaining({ completedAt: newestFirstCycle }),
      );
    });
  });
});
