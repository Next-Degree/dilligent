const mockDb = {
  discoveredVendorCandidate: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
  },
  vendor: { findFirst: jest.fn(), update: jest.fn() },
  vendorAccessGrant: { updateMany: jest.fn() },
  $transaction: jest.fn(),
};

jest.mock('@db', () => ({
  db: mockDb,
  DiscoveredVendorSource: { google_workspace: 'google_workspace' },
  DiscoveredVendorStatus: { pending: 'pending', approved: 'approved', ignored: 'ignored' },
  VendorCategory: { other: 'other', cloud_infrastructure: 'cloud_infrastructure' },
  VendorSource: { manual: 'manual', discovered: 'discovered' },
}));

import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DiscoveredVendorsService } from './discovered-vendors.service';

const CANDIDATE = {
  id: 'dvc_1',
  organizationId: 'org_1',
  source: 'google_workspace',
  externalAppId: 'slack.client',
  displayName: 'Slack',
  status: 'pending',
  vendorId: null,
  resolvedName: 'Slack',
  resolvedWebsite: 'https://slack.com',
  resolvedDescription: 'Team chat',
  resolvedCategory: null,
  granteeCount: 4,
  firstSeenAt: new Date('2026-08-01T00:00:00Z'),
};

describe('DiscoveredVendorsService.approve', () => {
  let service: DiscoveredVendorsService;
  const vendorsService = { create: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    mockDb.discoveredVendorCandidate.findFirst.mockResolvedValue(CANDIDATE);
    mockDb.$transaction.mockImplementation(async () => [{ ...CANDIDATE, status: 'approved' }]);
    vendorsService.create.mockResolvedValue({ id: 'vnd_1', name: 'Slack' });
    service = new DiscoveredVendorsService(vendorsService as never);
  });

  const approve = (overrides = {}) =>
    service.approve({
      organizationId: 'org_1',
      candidateId: 'dvc_1',
      actingUserId: 'usr_1',
      ...overrides,
    });

  it('creates a vendor through the standard creation path', async () => {
    const result = await approve();

    expect(result.created).toBe(true);
    expect(vendorsService.create).toHaveBeenCalledWith(
      'org_1',
      expect.objectContaining({ name: 'Slack', website: 'https://slack.com' }),
      'usr_1',
    );
  });

  it('normalises a retired category left on an old candidate row', async () => {
    // The create DTO rejects retired values, so approving an un-backfilled
    // candidate would 400 on a row the reviewer never touched.
    mockDb.discoveredVendorCandidate.findFirst.mockResolvedValue({
      ...CANDIDATE,
      resolvedCategory: 'software_as_a_service',
    });

    await approve();

    expect(vendorsService.create).toHaveBeenCalledWith(
      'org_1',
      expect.objectContaining({ category: 'other' }),
      'usr_1',
    );
  });

  it('passes the reviewer\'s classification through to the vendor', async () => {
    await approve({
      category: 'data_enrichment',
      deliveryModels: ['api_service'],
      dataServiceTypes: ['enrichment'],
      dataFlowRoles: ['processor', 'source'],
    });

    expect(vendorsService.create).toHaveBeenCalledWith(
      'org_1',
      expect.objectContaining({
        category: 'data_enrichment',
        deliveryModels: ['api_service'],
        dataServiceTypes: ['enrichment'],
        dataFlowRoles: ['processor', 'source'],
      }),
      'usr_1',
    );
  });

  it('records discovery as the vendor source with its discovery date', async () => {
    await approve();

    const calls = mockDb.$transaction.mock.calls[0][0];
    expect(mockDb.vendor.update).toHaveBeenCalledWith({
      where: { id: 'vnd_1' },
      data: { source: 'discovered', discoveredAt: CANDIDATE.firstSeenAt },
    });
    expect(calls).toHaveLength(3);
  });

  it('re-associates the candidate grants with the new vendor', async () => {
    await approve();

    expect(mockDb.vendorAccessGrant.updateMany).toHaveBeenCalledWith({
      where: { candidateId: 'dvc_1' },
      data: { vendorId: 'vnd_1' },
    });
  });

  it('is idempotent — re-approving does not create a second vendor', async () => {
    // Approval is a button that can be double-clicked, and vendor creation triggers a
    // risk assessment, so a duplicate is both a wrong register entry and wasted research.
    mockDb.discoveredVendorCandidate.findFirst.mockResolvedValue({
      ...CANDIDATE,
      status: 'approved',
      vendorId: 'vnd_existing',
    });
    mockDb.vendor.findFirst.mockResolvedValue({ id: 'vnd_existing', name: 'Slack' });

    const result = await approve();

    expect(result.created).toBe(false);
    expect(result.vendor.id).toBe('vnd_existing');
    expect(vendorsService.create).not.toHaveBeenCalled();
  });

  it('rejects an approval with no attributable user', async () => {
    await expect(approve({ actingUserId: null })).rejects.toBeInstanceOf(BadRequestException);
    expect(vendorsService.create).not.toHaveBeenCalled();
  });

  it('does not disclose a candidate from another organization', async () => {
    mockDb.discoveredVendorCandidate.findFirst.mockResolvedValue(null);

    await expect(approve()).rejects.toBeInstanceOf(NotFoundException);
  });

  describe('description fallback', () => {
    it('prefers the resolved description', async () => {
      await approve();

      expect(vendorsService.create).toHaveBeenCalledWith(
        'org_1',
        expect.objectContaining({ description: 'Team chat' }),
        'usr_1',
      );
    });

    it('generates one recording the discovery when none is available', async () => {
      mockDb.discoveredVendorCandidate.findFirst.mockResolvedValue({
        ...CANDIDATE,
        resolvedDescription: null,
      });

      await approve();

      const { description } = vendorsService.create.mock.calls[0][1];
      // Vendor.description is non-null; an empty one makes the register unreadable later.
      expect(description).toContain('Google Workspace sign-in');
      expect(description).toContain('2026-08-01');
      expect(description).toContain('4 employees have granted access');
    });

    it('lets the reviewer override the prefilled values', async () => {
      await approve({
        name: 'Slack Technologies',
        description: 'Our chat tool',
        website: 'https://slack.com/enterprise',
      });

      expect(vendorsService.create).toHaveBeenCalledWith(
        'org_1',
        expect.objectContaining({
          name: 'Slack Technologies',
          description: 'Our chat tool',
          website: 'https://slack.com/enterprise',
        }),
        'usr_1',
      );
    });
  });

  it('rejects approval of an application that reported no name', async () => {
    mockDb.discoveredVendorCandidate.findFirst.mockResolvedValue({
      ...CANDIDATE,
      displayName: null,
      resolvedName: null,
    });

    await expect(approve()).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('DiscoveredVendorsService.ignore and reopen', () => {
  let service: DiscoveredVendorsService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockDb.discoveredVendorCandidate.findFirst.mockResolvedValue({ id: 'dvc_1' });
    mockDb.discoveredVendorCandidate.update.mockResolvedValue({ id: 'dvc_1' });
    service = new DiscoveredVendorsService({ create: jest.fn() } as never);
  });

  it('records the decision, actor and reason when ignoring', async () => {
    await service.ignore({
      organizationId: 'org_1',
      candidateId: 'dvc_1',
      actingUserId: 'usr_1',
      reason: 'Personal account, not a company vendor',
    });

    expect(mockDb.discoveredVendorCandidate.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'ignored',
          ignoredReason: 'Personal account, not a company vendor',
          decidedById: 'usr_1',
        }),
      }),
    );
  });

  it('returns an ignored candidate to the queue and clears its reason', async () => {
    await service.reopen({
      organizationId: 'org_1',
      candidateId: 'dvc_1',
      actingUserId: 'usr_1',
    });

    expect(mockDb.discoveredVendorCandidate.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'pending', ignoredReason: null }),
      }),
    );
  });

  it('refuses to ignore a candidate belonging to another organization', async () => {
    mockDb.discoveredVendorCandidate.findFirst.mockResolvedValue(null);

    await expect(
      service.ignore({ organizationId: 'org_1', candidateId: 'dvc_x', actingUserId: 'usr_1' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
