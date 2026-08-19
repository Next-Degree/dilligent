import { NotFoundException } from '@nestjs/common';

jest.mock('@db', () => ({
  db: {
    vendor: { findMany: jest.fn(), findFirst: jest.fn() },
    member: { findMany: jest.fn() },
  },
}));

jest.mock('@trycompai/integration-platform', () => ({
  getActiveManifests: jest.fn(),
  getManifest: jest.fn(),
}));

import { db } from '@db';
import {
  getActiveManifests,
  getManifest,
} from '@trycompai/integration-platform';
import { VendorIntegrationService } from './vendor-integration.service';

const mockVendorFindMany = (db.vendor as unknown as { findMany: jest.Mock })
  .findMany;
const mockVendorFindFirst = (db.vendor as unknown as { findFirst: jest.Mock })
  .findFirst;
const mockMemberFindMany = (db.member as unknown as { findMany: jest.Mock })
  .findMany;
const mockGetActiveManifests = getActiveManifests as unknown as jest.Mock;
const mockGetManifest = getManifest as unknown as jest.Mock;

const mockCheckResults = {
  listSourcesBySlugs: jest.fn(),
  getLatestRunSummariesByConnection: jest.fn(),
  getLatestResultsByCheck: jest.fn(),
};

const ORG = 'org_1';
const GITHUB_CHECKS = [
  {
    id: 'github_employee_access',
    name: 'Employee Access',
    description: 'Reviews who can access the organization',
    taskMapping: 'access-control',
  },
  {
    id: 'github_branch_protection',
    name: 'Branch Protection',
    description: 'Requires review before merge',
  },
];

function source(slug: string, connected: boolean) {
  return {
    slug,
    name: slug === 'github' ? 'GitHub' : slug,
    logoUrl: null,
    connected,
    connectionId: connected ? `icn_${slug}` : null,
    lastSyncAt: null,
    nextSyncAt: null,
    category: 'Development',
  };
}

function makeService() {
  return new VendorIntegrationService(mockCheckResults as never);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetActiveManifests.mockReturnValue([
    { id: 'github', name: 'GitHub', baseUrl: 'https://api.github.com' },
    { id: 'linear', name: 'Linear', baseUrl: 'https://api.linear.app' },
  ]);
  mockGetManifest.mockReturnValue({
    id: 'github',
    name: 'GitHub',
    checks: GITHUB_CHECKS,
  });
  mockMemberFindMany.mockResolvedValue([
    {
      id: 'mem_1',
      deactivated: false,
      user: { name: 'Ada Lovelace', email: 'Ada@acme.com', image: null },
    },
  ]);
  mockCheckResults.listSourcesBySlugs.mockResolvedValue([]);
  mockCheckResults.getLatestRunSummariesByConnection.mockResolvedValue([]);
  mockCheckResults.getLatestResultsByCheck.mockResolvedValue([]);
});

describe('VendorIntegrationService.getForVendor', () => {
  it('404s for a vendor outside the organization', async () => {
    mockVendorFindFirst.mockResolvedValue(null);
    await expect(
      makeService().getForVendor('vnd_1', ORG),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('reports no integration when nothing identifies the vendor', async () => {
    mockVendorFindFirst.mockResolvedValue({
      id: 'vnd_1',
      name: 'Some Local Printer',
      website: null,
    });

    expect(await makeService().getForVendor('vnd_1', ORG)).toEqual({
      vendorId: 'vnd_1',
      integration: null,
      checks: [],
      users: [],
    });
    expect(mockCheckResults.listSourcesBySlugs).not.toHaveBeenCalled();
  });

  it('reports a matched integration that is not connected, without loading checks', async () => {
    mockVendorFindFirst.mockResolvedValue({
      id: 'vnd_1',
      name: 'GitHub',
      website: null,
    });
    mockCheckResults.listSourcesBySlugs.mockResolvedValue([
      source('github', false),
    ]);

    const result = await makeService().getForVendor('vnd_1', ORG);

    expect(result.integration).toMatchObject({
      slug: 'github',
      connected: false,
      matchedOn: 'slug',
    });
    expect(result.checks).toEqual([]);
    expect(result.users).toEqual([]);
    expect(
      mockCheckResults.getLatestRunSummariesByConnection,
    ).not.toHaveBeenCalled();
  });

  it('returns the connected integration checks with their latest run', async () => {
    mockVendorFindFirst.mockResolvedValue({
      id: 'vnd_1',
      name: 'GitHub',
      website: null,
    });
    mockCheckResults.listSourcesBySlugs.mockResolvedValue([
      source('github', true),
    ]);
    mockCheckResults.getLatestRunSummariesByConnection.mockResolvedValue([
      {
        checkId: 'github_employee_access',
        checkName: 'Employee Access',
        runId: 'icr_1',
        status: 'success',
        startedAt: new Date('2026-01-01T00:00:00.000Z'),
        completedAt: new Date('2026-01-01T00:01:00.000Z'),
        totalChecked: 2,
        passedCount: 1,
        failedCount: 1,
        errorMessage: null,
      },
      {
        checkId: 'github_retired_check',
        checkName: 'Retired Check',
        runId: 'icr_2',
        status: 'success',
        startedAt: null,
        completedAt: null,
        totalChecked: 0,
        passedCount: 0,
        failedCount: 0,
        errorMessage: null,
      },
    ]);

    const { checks } = await makeService().getForVendor('vnd_1', ORG);

    expect(checks).toHaveLength(3);
    expect(checks[0]).toMatchObject({
      checkId: 'github_employee_access',
      taskMapping: 'access-control',
      lastRun: { runId: 'icr_1', status: 'success', failedCount: 1 },
    });
    // A manifest check that has never run is still listed, as "not run yet".
    expect(checks[1]).toMatchObject({
      checkId: 'github_branch_protection',
      lastRun: null,
    });
    // A run whose check left the manifest still surfaces.
    expect(checks[2]).toMatchObject({
      checkId: 'github_retired_check',
      name: 'Retired Check',
    });
  });

  it('returns the people the access checks report, joined to org members', async () => {
    mockVendorFindFirst.mockResolvedValue({
      id: 'vnd_1',
      name: 'GitHub',
      website: null,
    });
    mockCheckResults.listSourcesBySlugs.mockResolvedValue([
      source('github', true),
    ]);
    mockCheckResults.getLatestResultsByCheck.mockImplementation(
      ({ checkId }: { checkId: string }) =>
        checkId === 'github_employee_access'
          ? Promise.resolve([
              {
                resultId: 'icx_1',
                resourceId: 'ada@acme.com',
                resourceType: 'user',
                passed: true,
                title: 'Has access',
                description: null,
                evidence: { role: 'admin', isAdmin: true },
                collectedAt: new Date('2026-01-01T00:00:00.000Z'),
                runId: 'icr_1',
                connectionId: 'icn_github',
              },
            ])
          : Promise.resolve([]),
    );

    const { users } = await makeService().getForVendor('vnd_1', ORG);

    expect(users).toEqual([
      expect.objectContaining({
        email: 'ada@acme.com',
        role: 'admin',
        checks: [
          { checkId: 'github_employee_access', checkName: 'Employee Access' },
        ],
        member: expect.objectContaining({ id: 'mem_1', email: 'ada@acme.com' }),
      }),
    ]);
    // Only per-person rows are requested — never the whole result set.
    expect(mockCheckResults.getLatestResultsByCheck).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceType: 'user',
        connectionId: 'icn_github',
      }),
    );
  });
});

describe('VendorIntegrationService.listLinks', () => {
  it('returns one link per matching vendor and skips the rest', async () => {
    mockVendorFindMany.mockResolvedValue([
      { id: 'vnd_1', name: 'GitHub', website: null },
      { id: 'vnd_2', name: 'Local Catering Co', website: null },
      { id: 'vnd_3', name: 'Linear', website: 'https://linear.app' },
    ]);
    mockCheckResults.listSourcesBySlugs.mockResolvedValue([
      source('github', true),
      source('linear', false),
    ]);

    const links = await makeService().listLinks(ORG);

    expect(links).toEqual([
      expect.objectContaining({
        vendorId: 'vnd_1',
        slug: 'github',
        connected: true,
      }),
      expect.objectContaining({
        vendorId: 'vnd_3',
        slug: 'linear',
        connected: false,
      }),
    ]);
    // One connection lookup for every candidate slug, not one per vendor.
    expect(mockCheckResults.listSourcesBySlugs).toHaveBeenCalledTimes(1);
  });

  it('short-circuits when the org has no vendors', async () => {
    mockVendorFindMany.mockResolvedValue([]);
    expect(await makeService().listLinks(ORG)).toEqual([]);
    expect(mockCheckResults.listSourcesBySlugs).not.toHaveBeenCalled();
  });
});
