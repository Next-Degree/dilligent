import { BadRequestException } from '@nestjs/common';
import { TrainingService } from './training.service';

jest.mock('@db', () => ({
  db: {
    member: { findFirst: jest.fn(), findUnique: jest.fn() },
    // markVideoComplete gates hipaa-sat-1 on the org having a HIPAA framework
    // instance, so the HIPAA path must be able to resolve one.
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
};

const completedRecord = ({ id, videoId }: { id: string; videoId: string }) => ({
  id,
  videoId,
  memberId: 'mem_1',
  cycle: 1,
  dueAt: null,
  completedAt: new Date(),
});

describe('TrainingService — HIPAA training', () => {
  let service: TrainingService;

  beforeEach(() => {
    jest.resetAllMocks();
    service = new TrainingService(
      mockEmailService as never,
      mockCertService as never,
    );
    db.member.findFirst.mockResolvedValue({
      id: 'mem_1',
      organizationId: 'org_1',
    });
    db.employeeTrainingVideoCompletion.findMany.mockResolvedValue([]);
  });

  it('should accept hipaa-sat-1 as a valid training ID', async () => {
    db.frameworkInstance.findFirst.mockResolvedValue({ id: 'frm_1' });
    db.employeeTrainingVideoCompletion.upsert.mockResolvedValue(
      completedRecord({ id: 'evc_1', videoId: 'hipaa-sat-1' }),
    );

    const result = await service.markVideoComplete(
      'mem_1',
      'org_1',
      'hipaa-sat-1',
    );

    expect(result.videoId).toBe('hipaa-sat-1');
    expect(db.employeeTrainingVideoCompletion.upsert).toHaveBeenCalledWith({
      where: {
        memberId_videoId_cycle: {
          memberId: 'mem_1',
          videoId: 'hipaa-sat-1',
          cycle: 1,
        },
      },
      create: {
        videoId: 'hipaa-sat-1',
        memberId: 'mem_1',
        cycle: 1,
        completedAt: expect.any(Date),
      },
      update: {},
    });
  });

  // Mirrors the portal's complete-training route: the two completion paths
  // must agree on which orgs may complete HIPAA training, or one can create
  // records — and certificate artifacts — the other would have rejected.
  it('should reject hipaa-sat-1 when the org has no HIPAA framework', async () => {
    db.frameworkInstance.findFirst.mockResolvedValue(null);

    await expect(
      service.markVideoComplete('mem_1', 'org_1', 'hipaa-sat-1'),
    ).rejects.toThrow(BadRequestException);

    expect(db.frameworkInstance.findFirst).toHaveBeenCalledWith({
      where: { organizationId: 'org_1', framework: { name: 'HIPAA' } },
      select: { id: true },
    });
    expect(db.employeeTrainingVideoCompletion.upsert).not.toHaveBeenCalled();
  });

  it('should reject unknown training IDs', async () => {
    await expect(
      service.markVideoComplete('mem_1', 'org_1', 'unknown-id'),
    ).rejects.toThrow(BadRequestException);
  });

  it('should still accept general SAT IDs without a framework lookup', async () => {
    db.employeeTrainingVideoCompletion.upsert.mockResolvedValue(
      completedRecord({ id: 'evc_2', videoId: 'sat-3' }),
    );

    const result = await service.markVideoComplete('mem_1', 'org_1', 'sat-3');

    expect(result.videoId).toBe('sat-3');
    expect(db.frameworkInstance.findFirst).not.toHaveBeenCalled();
  });
});
