import { createCompletionTable, row } from './training-fixtures-spec';
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

const table = createCompletionTable();

describe('TrainingService with lapsed progress', () => {
  let service: TrainingService;

  beforeEach(() => {
    jest.resetAllMocks();
    table.rows = [];
    service = new TrainingService(mockEmailService as never, {} as never);
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
    db.employeeTrainingVideoCompletion.findMany.mockImplementation(
      table.findMany,
    );
    db.employeeTrainingVideoCompletion.upsert.mockImplementation(table.upsert);
    db.employeeTrainingVideoCompletion.update.mockImplementation(
      async ({ where }: { where: { id: string } }) => ({
        ...table.rows.find((r) => r.id === where.id),
        completedAt: new Date(),
      }),
    );
  });

  it('refreshes the date of a video watched over a year ago in an unfinished training', async () => {
    table.rows = [
      row({ videoId: 'sat-1', days: 400 }),
      row({ videoId: 'sat-2', days: 5 }),
    ];

    await service.markVideoComplete('mem_1', 'org_1', 'sat-1');

    expect(db.employeeTrainingVideoCompletion.update).toHaveBeenCalledWith({
      where: { id: 'evc_sat-1_1' },
      data: { completedAt: expect.any(Date) },
    });
  });

  it('does not refresh a video watched recently', async () => {
    table.rows = [
      row({ videoId: 'sat-1', days: 400 }),
      row({ videoId: 'sat-2', days: 5 }),
    ];

    await service.markVideoComplete('mem_1', 'org_1', 'sat-2');

    expect(db.employeeTrainingVideoCompletion.upsert).not.toHaveBeenCalled();
    expect(db.employeeTrainingVideoCompletion.update).not.toHaveBeenCalled();
  });

  it('does not email a certificate when the finished cycle is not valid', async () => {
    const before = ['sat-1', 'sat-2', 'sat-3', 'sat-4'].map((videoId) =>
      row({ videoId, days: 1 }),
    );
    // What the re-read sees after the write: the same cycle, finished, but
    // already expired (as a clock or data race could leave it).
    const after = ['sat-1', 'sat-2', 'sat-3', 'sat-4', 'sat-5'].map((videoId) =>
      row({ videoId, days: 400 }),
    );
    db.employeeTrainingVideoCompletion.findMany
      .mockResolvedValueOnce(before)
      .mockResolvedValue(after);

    await service.markVideoComplete('mem_1', 'org_1', 'sat-5');

    expect(mockEmailService.sendTrainingCompletedEmail).not.toHaveBeenCalled();
  });
});
