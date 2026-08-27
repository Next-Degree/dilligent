import { MemberQueries } from './member-queries';

jest.mock('@db', () => ({
  db: {
    member: {
      update: jest.fn(),
      findFirstOrThrow: jest.fn(),
    },
    user: {
      update: jest.fn(),
    },
  },
}));

import { db } from '@db';

const mockedDb = db as jest.Mocked<typeof db>;

describe('MemberQueries.updateMember — background-check exemption fields', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (mockedDb.member.update as jest.Mock).mockResolvedValue({ id: 'mem_1' });
  });

  it('persists reason and justification when backgroundCheckExempt is true', async () => {
    await MemberQueries.updateMember('mem_1', 'org_1', {
      backgroundCheckExempt: true,
      backgroundCheckExemptReason: 'other',
      backgroundCheckExemptJustification: 'Founder',
    });

    expect(mockedDb.member.update).toHaveBeenCalledTimes(1);
    expect(mockedDb.member.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'mem_1', organizationId: 'org_1' },
        data: expect.objectContaining({
          backgroundCheckExempt: true,
          backgroundCheckExemptReason: 'other',
          backgroundCheckExemptJustification: 'Founder',
        }),
      }),
    );
  });

  it('clears reason and justification when backgroundCheckExempt is set to false', async () => {
    await MemberQueries.updateMember('mem_1', 'org_1', {
      backgroundCheckExempt: false,
    });

    expect(mockedDb.member.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          backgroundCheckExempt: false,
          backgroundCheckExemptReason: null,
          backgroundCheckExemptJustification: null,
        }),
      }),
    );
  });

  it('overrides incoming reason/justification when un-exempting', async () => {
    // Defensive: if a client sends contradictory data, false wins —
    // an un-exempt request must not retain stale reason text.
    await MemberQueries.updateMember('mem_1', 'org_1', {
      backgroundCheckExempt: false,
      backgroundCheckExemptReason: 'stale_reason',
      backgroundCheckExemptJustification: 'stale text',
    });

    expect(mockedDb.member.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          backgroundCheckExempt: false,
          backgroundCheckExemptReason: null,
          backgroundCheckExemptJustification: null,
        }),
      }),
    );
  });

  it('does not touch reason or justification when the patch omits backgroundCheckExempt', async () => {
    await MemberQueries.updateMember('mem_1', 'org_1', {
      jobTitle: 'Engineer',
    });

    expect(mockedDb.member.update).toHaveBeenCalledTimes(1);
    const call = (mockedDb.member.update as jest.Mock).mock.calls[0][0];
    expect(call.data).not.toHaveProperty('backgroundCheckExemptReason');
    expect(call.data).not.toHaveProperty('backgroundCheckExemptJustification');
  });
});

describe('MemberQueries.updateMember — reactivation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (mockedDb.member.update as jest.Mock).mockResolvedValue({ id: 'mem_1' });
  });

  // Regression for "Unable to reactivate user": a member deactivated via
  // offboarding carries deactivated:true. The status dropdown reactivates by
  // sending { isActive: true }; without also clearing deactivated the member
  // stays hidden from the people list, so isActive alone is not enough.
  it('clears deactivated when reactivating via isActive: true', async () => {
    await MemberQueries.updateMember('mem_1', 'org_1', { isActive: true });

    expect(mockedDb.member.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'mem_1', organizationId: 'org_1' },
        data: expect.objectContaining({ isActive: true, deactivated: false }),
      }),
    );
  });

  it('does not touch deactivated when the patch omits isActive', async () => {
    await MemberQueries.updateMember('mem_1', 'org_1', { jobTitle: 'Engineer' });

    const call = (mockedDb.member.update as jest.Mock).mock.calls[0][0];
    expect(call.data).not.toHaveProperty('deactivated');
  });

  it('does not reactivate when deactivating via isActive: false', async () => {
    await MemberQueries.updateMember('mem_1', 'org_1', { isActive: false });

    const call = (mockedDb.member.update as jest.Mock).mock.calls[0][0];
    expect(call.data.isActive).toBe(false);
    expect(call.data).not.toHaveProperty('deactivated');
  });
});

describe('MemberQueries.updateMember — employment type', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (mockedDb.member.update as jest.Mock).mockResolvedValue({ id: 'mem_1' });
    (mockedDb.member.findFirstOrThrow as jest.Mock).mockResolvedValue({
      employmentType: 'permanent',
      contractExpiryDate: null,
    });
  });

  it('writes the expiry when a member moves to contract', async () => {
    await MemberQueries.updateMember('mem_1', 'org_1', {
      employmentType: 'contract',
      contractExpiryDate: '2027-06-30T00:00:00.000Z',
    });

    expect(mockedDb.member.findFirstOrThrow).toHaveBeenCalledWith({
      where: { id: 'mem_1', organizationId: 'org_1' },
      select: { employmentType: true, contractExpiryDate: true },
    });
    const call = (mockedDb.member.update as jest.Mock).mock.calls[0][0];
    expect(call.data).toMatchObject({
      employmentType: 'contract',
      contractExpiryDate: new Date('2027-06-30T00:00:00.000Z'),
    });
  });

  it('clears a stored expiry when a contractor becomes permanent', async () => {
    (mockedDb.member.findFirstOrThrow as jest.Mock).mockResolvedValue({
      employmentType: 'contract',
      contractExpiryDate: new Date('2026-12-31T00:00:00.000Z'),
    });

    await MemberQueries.updateMember('mem_1', 'org_1', {
      employmentType: 'permanent',
    });

    const call = (mockedDb.member.update as jest.Mock).mock.calls[0][0];
    expect(call.data).toMatchObject({
      employmentType: 'permanent',
      contractExpiryDate: null,
    });
  });

  it('rejects a move to contract with no expiry on file', async () => {
    await expect(
      MemberQueries.updateMember('mem_1', 'org_1', {
        employmentType: 'contract',
      }),
    ).rejects.toThrow('Contract expiry date is required for contract employment');

    expect(mockedDb.member.update).not.toHaveBeenCalled();
  });

  it('skips the employment read when the patch omits both fields', async () => {
    await MemberQueries.updateMember('mem_1', 'org_1', { jobTitle: 'Engineer' });

    expect(mockedDb.member.findFirstOrThrow).not.toHaveBeenCalled();
    const call = (mockedDb.member.update as jest.Mock).mock.calls[0][0];
    expect(call.data).not.toHaveProperty('employmentType');
    expect(call.data).not.toHaveProperty('contractExpiryDate');
  });
});
