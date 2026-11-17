jest.mock('@db', () => ({
  BackgroundCheckStatus: {
    completed: 'completed',
    completed_with_flags: 'completed_with_flags',
  },
  db: {
    employeeTrainingVideoCompletion: { findMany: jest.fn() },
    device: { findMany: jest.fn() },
    member: { findMany: jest.fn() },
    fleetPolicyResult: { findMany: jest.fn() },
    backgroundCheckRequest: { findMany: jest.fn() },
  },
}));

jest.mock('../utils/compliance-filters', () => ({
  filterComplianceMembers: jest.fn(),
}));

import { db } from '@db';
import { filterComplianceMembers } from '../utils/compliance-filters';
import { computePeopleScore } from './frameworks-people-score.helper';

const mockDb = db as jest.Mocked<typeof db>;
const mockFilterComplianceMembers =
  filterComplianceMembers as jest.MockedFunction<
    typeof filterComplianceMembers
  >;

const DAY_MS = 24 * 60 * 60 * 1000;
const GENERAL = ['sat-1', 'sat-2', 'sat-3', 'sat-4', 'sat-5'];

const member = (id: string) => ({
  id,
  role: 'owner',
  user: { id: `usr_${id}`, email: `${id}@example.com`, role: 'owner' },
});

const rows = ({
  memberId,
  videoIds,
  cycle = 1,
  days,
}: {
  memberId: string;
  videoIds: string[];
  cycle?: number;
  days: number;
}) =>
  videoIds.map((videoId) => ({
    memberId,
    videoId,
    cycle,
    completedAt: new Date(Date.now() - days * DAY_MS),
  }));

const score = ({
  securityTrainingStepEnabled = true,
  frameworkNames = [],
}: {
  securityTrainingStepEnabled?: boolean;
  frameworkNames?: string[];
}) =>
  computePeopleScore({
    organizationId: 'org_1',
    allPolicies: [],
    employees: [member('mem_1'), member('mem_2')],
    securityTrainingStepEnabled,
    deviceAgentStepEnabled: false,
    backgroundCheckStepEnabled: false,
    frameworkNames,
  });

const seedCompletions = (completions: ReturnType<typeof rows>): jest.Mock => {
  const findMany = mockDb.employeeTrainingVideoCompletion.findMany as jest.Mock;
  findMany.mockResolvedValue(completions);
  return findMany;
};

describe('computePeopleScore training requirements', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFilterComplianceMembers.mockResolvedValue([
      member('mem_1'),
      member('mem_2'),
    ]);
  });

  it('counts a member whose training is only due for renewal as complete', async () => {
    seedCompletions([
      ...rows({ memberId: 'mem_1', videoIds: GENERAL, days: 330 }),
      ...rows({ memberId: 'mem_2', videoIds: GENERAL, days: 330 }),
    ]);

    expect(await score({})).toEqual({ total: 2, completed: 2 });
  });

  it('does not count a member whose training has expired', async () => {
    seedCompletions([
      ...rows({ memberId: 'mem_1', videoIds: GENERAL, days: 400 }),
      ...rows({ memberId: 'mem_2', videoIds: GENERAL, days: 10 }),
    ]);

    expect(await score({})).toEqual({ total: 2, completed: 1 });
  });

  it('does not treat a partly finished renewal as renewed', async () => {
    seedCompletions([
      ...rows({ memberId: 'mem_1', videoIds: GENERAL, days: 400 }),
      ...rows({ memberId: 'mem_1', videoIds: ['sat-1'], cycle: 2, days: 1 }),
      ...rows({ memberId: 'mem_2', videoIds: GENERAL, days: 10 }),
    ]);

    expect(await score({})).toEqual({ total: 2, completed: 1 });
  });

  it('counts a member whose renewal is fully finished', async () => {
    seedCompletions([
      ...rows({ memberId: 'mem_1', videoIds: GENERAL, days: 400 }),
      ...rows({ memberId: 'mem_1', videoIds: GENERAL, cycle: 2, days: 3 }),
      ...rows({ memberId: 'mem_2', videoIds: GENERAL, days: 10 }),
    ]);

    expect(await score({})).toEqual({ total: 2, completed: 2 });
  });

  it('keeps one member completions from satisfying another', async () => {
    seedCompletions(rows({ memberId: 'mem_1', videoIds: GENERAL, days: 10 }));

    expect(await score({})).toEqual({ total: 2, completed: 1 });
  });

  it('requires CCPA training when the org has the CCPA framework', async () => {
    const general = [
      ...rows({ memberId: 'mem_1', videoIds: GENERAL, days: 10 }),
      ...rows({ memberId: 'mem_2', videoIds: GENERAL, days: 10 }),
    ];
    seedCompletions(general);

    expect(await score({ frameworkNames: ['CCPA'] })).toEqual({
      total: 2,
      completed: 0,
    });

    seedCompletions([
      ...general,
      ...rows({ memberId: 'mem_1', videoIds: ['ccpa-1', 'ccpa-2'], days: 2 }),
      ...rows({ memberId: 'mem_2', videoIds: ['ccpa-1'], days: 2 }),
    ]);

    expect(await score({ frameworkNames: ['CCPA'] })).toEqual({
      total: 2,
      completed: 1,
    });
  });

  it('requires HIPAA training when the org has the HIPAA framework', async () => {
    seedCompletions([
      ...rows({ memberId: 'mem_1', videoIds: GENERAL, days: 10 }),
      ...rows({ memberId: 'mem_1', videoIds: ['hipaa-sat-1'], days: 10 }),
      ...rows({ memberId: 'mem_2', videoIds: GENERAL, days: 10 }),
    ]);

    expect(await score({ frameworkNames: ['HIPAA'] })).toEqual({
      total: 2,
      completed: 1,
    });
  });

  it('still requires CCPA training when general training is switched off', async () => {
    seedCompletions(
      rows({ memberId: 'mem_1', videoIds: ['ccpa-1', 'ccpa-2'], days: 2 }),
    );

    expect(
      await score({
        securityTrainingStepEnabled: false,
        frameworkNames: ['CCPA'],
      }),
    ).toEqual({ total: 2, completed: 1 });
  });

  it('ignores frameworks that do not gate any training', async () => {
    seedCompletions(rows({ memberId: 'mem_1', videoIds: GENERAL, days: 10 }));

    expect(await score({ frameworkNames: ['SOC 2', 'ISO 27001'] })).toEqual({
      total: 2,
      completed: 1,
    });
  });

  it('does not read completions when no training is required', async () => {
    const findMany = seedCompletions([]);

    expect(await score({ securityTrainingStepEnabled: false })).toEqual({
      total: 2,
      completed: 2,
    });
    expect(findMany).not.toHaveBeenCalled();
  });
});
