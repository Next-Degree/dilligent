import { getTrainingGroup } from '@trycompai/company';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  memberFindMany: vi.fn(),
  policyFindMany: vi.fn(),
  completionFindMany: vi.fn(),
  filterComplianceMembers: vi.fn(),
  getRequiredTrainingGroups: vi.fn(),
}));

vi.mock('@db/server', () => ({
  db: {
    member: { findMany: mocks.memberFindMany },
    policy: { findMany: mocks.policyFindMany },
    employeeTrainingVideoCompletion: { findMany: mocks.completionFindMany },
  },
}));
vi.mock('@/lib/compliance', () => ({ filterComplianceMembers: mocks.filterComplianceMembers }));
vi.mock('@/lib/training/required-groups', () => ({
  getRequiredTrainingGroups: mocks.getRequiredTrainingGroups,
}));

import { getPeopleScore } from './getPeople';

const DAY_MS = 24 * 60 * 60 * 1000;
const general = getTrainingGroup('general');
const ccpa = getTrainingGroup('ccpa');

const member = (id: string) => ({ id, user: { id: `usr_${id}` } });

const rows = ({
  memberId,
  videoIds,
  cycle = 1,
  days,
}: {
  memberId: string;
  videoIds: readonly string[];
  cycle?: number;
  days: number;
}) =>
  videoIds.map((videoId) => ({
    memberId,
    videoId,
    cycle,
    completedAt: new Date(Date.now() - days * DAY_MS),
  }));

describe('getPeopleScore', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.memberFindMany.mockResolvedValue([member('mem_1'), member('mem_2')]);
    mocks.filterComplianceMembers.mockImplementation(async (members: unknown[]) => members);
    mocks.policyFindMany.mockResolvedValue([]);
    mocks.getRequiredTrainingGroups.mockResolvedValue([general]);
    mocks.completionFindMany.mockResolvedValue([]);
  });

  it('returns zero when nobody has a compliance obligation', async () => {
    mocks.filterComplianceMembers.mockResolvedValue([]);

    expect(await getPeopleScore('org_1')).toEqual({ totalMembers: 0, completedMembers: 0 });
    expect(mocks.completionFindMany).not.toHaveBeenCalled();
  });

  it('counts members whose required training is valid', async () => {
    mocks.completionFindMany.mockResolvedValue([
      ...rows({ memberId: 'mem_1', videoIds: general.moduleIds, days: 10 }),
      ...rows({ memberId: 'mem_2', videoIds: general.moduleIds.slice(0, 2), days: 10 }),
    ]);

    expect(await getPeopleScore('org_1')).toEqual({ totalMembers: 2, completedMembers: 1 });
  });

  it('counts a member whose training is only due for renewal, not one whose training expired', async () => {
    mocks.completionFindMany.mockResolvedValue([
      ...rows({ memberId: 'mem_1', videoIds: general.moduleIds, days: 330 }),
      ...rows({ memberId: 'mem_2', videoIds: general.moduleIds, days: 400 }),
    ]);

    expect(await getPeopleScore('org_1')).toEqual({ totalMembers: 2, completedMembers: 1 });
  });

  it('does not double count a member who has both an old and a renewed cycle', async () => {
    mocks.completionFindMany.mockResolvedValue([
      ...rows({ memberId: 'mem_1', videoIds: general.moduleIds, cycle: 1, days: 400 }),
      ...rows({ memberId: 'mem_1', videoIds: general.moduleIds, cycle: 2, days: 5 }),
    ]);

    expect(await getPeopleScore('org_1')).toEqual({ totalMembers: 2, completedMembers: 1 });
  });

  it('also requires CCPA training when the org requires it', async () => {
    mocks.getRequiredTrainingGroups.mockResolvedValue([general, ccpa]);
    mocks.completionFindMany.mockResolvedValue([
      ...rows({ memberId: 'mem_1', videoIds: general.moduleIds, days: 10 }),
      ...rows({ memberId: 'mem_1', videoIds: ccpa.moduleIds, days: 10 }),
      ...rows({ memberId: 'mem_2', videoIds: general.moduleIds, days: 10 }),
    ]);

    expect(await getPeopleScore('org_1')).toEqual({ totalMembers: 2, completedMembers: 1 });
  });

  it('requires signed policies as well as training', async () => {
    mocks.policyFindMany.mockResolvedValue([{ id: 'pol_1', signedBy: ['mem_1'] }]);
    mocks.completionFindMany.mockResolvedValue([
      ...rows({ memberId: 'mem_1', videoIds: general.moduleIds, days: 10 }),
      ...rows({ memberId: 'mem_2', videoIds: general.moduleIds, days: 10 }),
    ]);

    expect(await getPeopleScore('org_1')).toEqual({ totalMembers: 2, completedMembers: 1 });
  });

  it('counts on policies alone, without reading completions, when no training is required', async () => {
    mocks.getRequiredTrainingGroups.mockResolvedValue([]);
    mocks.policyFindMany.mockResolvedValue([{ id: 'pol_1', signedBy: ['mem_1', 'mem_2'] }]);

    expect(await getPeopleScore('org_1')).toEqual({ totalMembers: 2, completedMembers: 2 });
    expect(mocks.completionFindMany).not.toHaveBeenCalled();
  });
});
