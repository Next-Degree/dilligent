import {
  GENERAL,
  createCompletionTable,
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

describe('TrainingService CCPA gate and completion emails', () => {
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

  describe('CCPA gate', () => {
    it('rejects a CCPA module when the org has no CCPA framework', async () => {
      db.frameworkInstance.findFirst.mockResolvedValue(null);

      await expect(
        service.markVideoComplete('mem_1', 'org_1', 'ccpa-1'),
      ).rejects.toThrow('CCPA training is not available for this organization');

      expect(db.frameworkInstance.findFirst).toHaveBeenCalledWith({
        where: { organizationId: 'org_1', framework: { name: 'CCPA' } },
        select: { id: true },
      });
      expect(db.employeeTrainingVideoCompletion.upsert).not.toHaveBeenCalled();
    });

    it('records a CCPA module when the org has the CCPA framework', async () => {
      await service.markVideoComplete('mem_1', 'org_1', 'ccpa-2');

      expect(db.employeeTrainingVideoCompletion.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            memberId_videoId_cycle: {
              memberId: 'mem_1',
              videoId: 'ccpa-2',
              cycle: 1,
            },
          },
        }),
      );
    });

    it('does not run the general training email when a CCPA module is completed', async () => {
      table.rows = rowsFor({ videoIds: GENERAL, days: 10 });

      await service.markVideoComplete('mem_1', 'org_1', 'ccpa-1');
      await service.markVideoComplete('mem_1', 'org_1', 'ccpa-2');

      expect(
        mockEmailService.sendTrainingCompletedEmail,
      ).not.toHaveBeenCalled();
    });
  });

  describe('completion emails', () => {
    it('sends the general email only when the last module of the first cycle is completed', async () => {
      for (const videoId of GENERAL.slice(0, 4)) {
        await service.markVideoComplete('mem_1', 'org_1', videoId);
      }
      expect(
        mockEmailService.sendTrainingCompletedEmail,
      ).not.toHaveBeenCalled();

      await service.markVideoComplete('mem_1', 'org_1', 'sat-5');

      expect(mockEmailService.sendTrainingCompletedEmail).toHaveBeenCalledTimes(
        1,
      );
    });

    it('does not re-send while a renewal is only partly done, even though last year is complete', async () => {
      table.rows = rowsFor({ videoIds: GENERAL, days: 330 });

      await service.markVideoComplete('mem_1', 'org_1', 'sat-1');
      await service.markVideoComplete('mem_1', 'org_1', 'sat-2');

      expect(
        mockEmailService.sendTrainingCompletedEmail,
      ).not.toHaveBeenCalled();
    });

    it('sends the general email once the renewal cycle is finished', async () => {
      table.rows = rowsFor({ videoIds: GENERAL, days: 330 });

      for (const videoId of GENERAL) {
        await service.markVideoComplete('mem_1', 'org_1', videoId);
      }

      expect(mockEmailService.sendTrainingCompletedEmail).toHaveBeenCalledTimes(
        1,
      );
    });

    it('sends the HIPAA email when the single HIPAA module is completed', async () => {
      await service.markVideoComplete('mem_1', 'org_1', 'hipaa-sat-1');

      expect(
        mockEmailService.sendHipaaTrainingCompletedEmail,
      ).toHaveBeenCalledTimes(1);
      expect(
        mockEmailService.sendTrainingCompletedEmail,
      ).not.toHaveBeenCalled();
    });

    it('still records the completion when the email fails', async () => {
      mockEmailService.sendHipaaTrainingCompletedEmail.mockRejectedValue(
        new Error('smtp down'),
      );

      const result = await service.markVideoComplete(
        'mem_1',
        'org_1',
        'hipaa-sat-1',
      );

      expect(result.videoId).toBe('hipaa-sat-1');
    });
  });
});
