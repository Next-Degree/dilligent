jest.mock('@db', () => ({
  db: {
    frameworkInstance: { findMany: jest.fn() },
    employeeTrainingVideoCompletion: { createMany: jest.fn() },
  },
}));

import { createInitialTrainingRows } from './initial-training-rows';

const { db } = jest.requireMock('@db');

const GENERAL = ['sat-1', 'sat-2', 'sat-3', 'sat-4', 'sat-5'];

const createdVideoIds = (): string[] => {
  const [call] = db.employeeTrainingVideoCompletion.createMany.mock.calls;
  return call[0].data.map((row: { videoId: string }) => row.videoId);
};

describe('createInitialTrainingRows', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    db.frameworkInstance.findMany.mockResolvedValue([]);
    db.employeeTrainingVideoCompletion.createMany.mockResolvedValue({
      count: 0,
    });
  });

  it('assigns the general training to every new member', async () => {
    await createInitialTrainingRows({
      memberId: 'mem_1',
      organizationId: 'org_1',
    });

    expect(createdVideoIds()).toEqual(GENERAL);
  });

  it('also assigns HIPAA training in an org with the HIPAA framework', async () => {
    db.frameworkInstance.findMany.mockResolvedValue([
      { framework: { name: 'HIPAA' } },
    ]);

    await createInitialTrainingRows({
      memberId: 'mem_1',
      organizationId: 'org_1',
    });

    expect(createdVideoIds()).toEqual([...GENERAL, 'hipaa-sat-1']);
  });

  it('also assigns both CCPA videos in an org with the CCPA framework', async () => {
    db.frameworkInstance.findMany.mockResolvedValue([
      { framework: { name: 'CCPA' } },
    ]);

    await createInitialTrainingRows({
      memberId: 'mem_1',
      organizationId: 'org_1',
    });

    expect(createdVideoIds()).toEqual([...GENERAL, 'ccpa-1', 'ccpa-2']);
  });

  it('ignores a custom framework instance, which has no framework record', async () => {
    db.frameworkInstance.findMany.mockResolvedValue([{ framework: null }]);

    await createInitialTrainingRows({
      memberId: 'mem_1',
      organizationId: 'org_1',
    });

    expect(createdVideoIds()).toEqual(GENERAL);
  });

  it('creates pending first cycle rows for the member, skipping any that exist', async () => {
    await createInitialTrainingRows({
      memberId: 'mem_9',
      organizationId: 'org_1',
    });

    expect(db.employeeTrainingVideoCompletion.createMany).toHaveBeenCalledWith({
      data: GENERAL.map((videoId) => ({ memberId: 'mem_9', videoId })),
      skipDuplicates: true,
    });
  });

  it('finds the relevant frameworks with one query scoped to the org', async () => {
    await createInitialTrainingRows({
      memberId: 'mem_1',
      organizationId: 'org_7',
    });

    expect(db.frameworkInstance.findMany).toHaveBeenCalledTimes(1);
    expect(db.frameworkInstance.findMany).toHaveBeenCalledWith({
      where: {
        organizationId: 'org_7',
        framework: { name: { in: ['HIPAA', 'CCPA'] } },
      },
      select: { framework: { select: { name: true } } },
    });
  });
});
