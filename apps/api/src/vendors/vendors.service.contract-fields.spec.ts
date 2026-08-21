import { BadRequestException } from '@nestjs/common';

const mockDb = {
  vendor: { findFirst: jest.fn(), update: jest.fn() },
  member: { findFirst: jest.fn() },
  globalVendors: { findMany: jest.fn().mockResolvedValue([]) },
};

jest.mock('@db', () => ({
  ...jest.requireActual('@prisma/client'),
  db: mockDb,
}));
jest.mock('@trigger.dev/sdk', () => ({ tasks: { trigger: jest.fn() } }));

const mockIsMemberOrgParticipant = jest.fn().mockResolvedValue(true);
jest.mock('../utils/org-participation', () => ({
  isMemberOrgParticipant: (...args: unknown[]) =>
    mockIsMemberOrgParticipant(...args),
}));

import { VendorsService } from './vendors.service';

const ORG = 'org_1';
const VENDOR_ID = 'vnd_1';

const existingVendor = {
  id: VENDOR_ID,
  name: 'Acronis',
  organizationId: ORG,
  assigneeId: null,
  ownerId: null,
  website: null,
  treatmentStrategy: 'mitigate',
  treatmentStrategyDescription: null,
  strategyDescriptions: null,
};

describe('VendorsService contract fields', () => {
  let service: VendorsService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockIsMemberOrgParticipant.mockResolvedValue(true);
    mockDb.globalVendors.findMany.mockResolvedValue([]);
    mockDb.vendor.findFirst.mockResolvedValue(existingVendor);
    mockDb.vendor.update.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ ...existingVendor, ...data }),
    );
    service = new VendorsService();
  });

  it('persists every contract field', async () => {
    const contract = {
      totalSeats: 50,
      usedSeats: 42,
      renewalDate: '2027-01-31T00:00:00.000Z',
      annualCostCents: 1_200_000,
      contractTerm: 'yearly' as const,
      noticePeriodDays: 30,
    };

    await service.updateById(VENDOR_ID, ORG, contract);

    expect(mockDb.vendor.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: VENDOR_ID },
        data: expect.objectContaining(contract),
      }),
    );
  });

  it('clears contract fields when null is sent', async () => {
    await service.updateById(VENDOR_ID, ORG, {
      renewalDate: null,
      annualCostCents: null,
      ownerId: null,
    });

    const { data } = mockDb.vendor.update.mock.calls[0][0];
    expect(data.renewalDate).toBeNull();
    expect(data.annualCostCents).toBeNull();
    expect(data.ownerId).toBeNull();
    expect(mockDb.member.findFirst).not.toHaveBeenCalled();
  });

  it('accepts an owner who is a member of the organization', async () => {
    mockDb.member.findFirst.mockResolvedValue({
      id: 'mem_owner',
      user: { role: 'member' },
    });

    await service.updateById(VENDOR_ID, ORG, { ownerId: 'mem_owner' });

    expect(mockDb.member.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'mem_owner', organizationId: ORG },
      }),
    );
    expect(mockDb.vendor.update).toHaveBeenCalled();
  });

  it('rejects an owner from another organization', async () => {
    mockDb.member.findFirst.mockResolvedValue(null);

    await expect(
      service.updateById(VENDOR_ID, ORG, { ownerId: 'mem_other_org' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(mockDb.vendor.update).not.toHaveBeenCalled();
  });

  it('rejects a platform admin as owner', async () => {
    mockDb.member.findFirst.mockResolvedValue({
      id: 'mem_admin',
      user: { role: 'admin' },
    });
    mockIsMemberOrgParticipant.mockResolvedValue(false);

    await expect(
      service.updateById(VENDOR_ID, ORG, { ownerId: 'mem_admin' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(mockDb.vendor.update).not.toHaveBeenCalled();
  });

  it('skips revalidation when the owner is unchanged', async () => {
    mockDb.vendor.findFirst.mockResolvedValue({
      ...existingVendor,
      ownerId: 'mem_owner',
    });

    await service.updateById(VENDOR_ID, ORG, { ownerId: 'mem_owner' });

    expect(mockDb.member.findFirst).not.toHaveBeenCalled();
    expect(mockDb.vendor.update).toHaveBeenCalled();
  });
});
