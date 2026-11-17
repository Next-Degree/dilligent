import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  organizationFindUnique: vi.fn(),
  frameworkInstanceFindMany: vi.fn(),
}));

vi.mock('@db/server', () => ({
  db: {
    organization: { findUnique: mocks.organizationFindUnique },
    frameworkInstance: { findMany: mocks.frameworkInstanceFindMany },
  },
}));

import { getRequiredTrainingGroups } from './required-groups';

const groupIds = async (organizationId = 'org_1'): Promise<string[]> =>
  (await getRequiredTrainingGroups(organizationId)).map((group) => group.id);

describe('getRequiredTrainingGroups', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.organizationFindUnique.mockResolvedValue({ securityTrainingStepEnabled: true });
    mocks.frameworkInstanceFindMany.mockResolvedValue([]);
  });

  it('requires general training when the org switched security training on', async () => {
    expect(await groupIds()).toEqual(['general']);
  });

  it('requires nothing when security training is off and no framework applies', async () => {
    mocks.organizationFindUnique.mockResolvedValue({ securityTrainingStepEnabled: false });

    expect(await groupIds()).toEqual([]);
  });

  it('adds HIPAA and CCPA training for orgs with those frameworks', async () => {
    mocks.frameworkInstanceFindMany.mockResolvedValue([
      { framework: { name: 'HIPAA' } },
      { framework: { name: 'CCPA' } },
    ]);

    expect([...(await groupIds())].sort()).toEqual(['ccpa', 'general', 'hipaa']);
  });

  it('ignores a custom framework instance, which has no framework record', async () => {
    mocks.frameworkInstanceFindMany.mockResolvedValue([{ framework: null }]);

    expect(await groupIds()).toEqual(['general']);
  });

  it('finds the relevant frameworks with one query scoped to the org', async () => {
    await groupIds('org_9');

    expect(mocks.frameworkInstanceFindMany).toHaveBeenCalledTimes(1);
    expect(mocks.frameworkInstanceFindMany).toHaveBeenCalledWith({
      where: {
        organizationId: 'org_9',
        framework: { name: { in: ['HIPAA', 'CCPA'] } },
      },
      select: { framework: { select: { name: true } } },
    });
  });
});
