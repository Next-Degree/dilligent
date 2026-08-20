const mockDb = {
  member: { findMany: jest.fn() },
  discoveredVendorCandidate: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
  vendorAccessGrant: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
};

jest.mock('@db', () => ({
  db: mockDb,
  DiscoveredVendorSource: { google_workspace: 'google_workspace' },
  DiscoveredVendorStatus: { pending: 'pending', approved: 'approved', ignored: 'ignored' },
  VendorAccessGrantSource: { google_workspace: 'google_workspace', manual: 'manual' },
  VendorAccessGrantRevokedReason: {
    not_observed: 'not_observed',
    offboarding: 'offboarding',
    manual: 'manual',
  },
  VendorResolutionMethod: {
    existing_vendor: 'existing_vendor',
    global_catalogue: 'global_catalogue',
    integration_definition: 'integration_definition',
    inferred: 'inferred',
    unresolved: 'unresolved',
  },
}));

import type { CheckResultRow } from '../../integration-platform/services/check-results.service';
import { VendorDiscoveryMaterializationService } from './vendor-discovery-materialization.service';

const NOW = new Date('2026-08-20T08:00:00.000Z');

const baseRow = (overrides: Partial<CheckResultRow>): CheckResultRow => ({
  resultId: 'res_1',
  resourceId: 'r',
  resourceType: 'oauth_app',
  passed: true,
  title: 't',
  description: null,
  evidence: {},
  collectedAt: NOW,
  runId: 'run_1',
  connectionId: 'icn_1',
  ...overrides,
});

const marker = (evidence: Record<string, unknown> = {}) =>
  baseRow({
    resourceId: 'google-workspace:oauth-inventory',
    resourceType: 'inventory',
    evidence: { schemaVersion: 1, complete: true, usersInspected: 5, ...evidence },
  });

const appRow = (grantees = [{ email: 'a@example.com', userKey: 'u1', scopeIndices: [0] }]) =>
  baseRow({
    resourceId: 'slack.client',
    evidence: {
      schemaVersion: 1,
      clientId: 'slack.client',
      displayName: 'Slack',
      nativeApp: false,
      anonymous: false,
      scopeCatalog: ['scope.read'],
      grantees,
    },
  });

describe('VendorDiscoveryMaterializationService', () => {
  let service: VendorDiscoveryMaterializationService;
  const resolutionService = {
    resolve: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    resolutionService.resolve.mockResolvedValue({
      method: 'unresolved',
      vendorId: null,
      resolvedName: null,
      resolvedWebsite: null,
      resolvedDescription: null,
      confidence: null,
      autoIgnoreReason: null,
      eligibleForInference: true,
    });
    mockDb.member.findMany.mockResolvedValue([
      { id: 'mem_1', externalUserId: 'u1', user: { email: 'a@example.com' } },
    ]);
    mockDb.discoveredVendorCandidate.findUnique.mockResolvedValue(null);
    mockDb.discoveredVendorCandidate.create.mockResolvedValue({ id: 'dvc_1' });
    mockDb.discoveredVendorCandidate.findMany.mockResolvedValue([]);
    mockDb.discoveredVendorCandidate.updateMany.mockResolvedValue({ count: 0 });
    mockDb.vendorAccessGrant.findUnique.mockResolvedValue(null);
    mockDb.vendorAccessGrant.findMany.mockResolvedValue([]);
    mockDb.vendorAccessGrant.updateMany.mockResolvedValue({ count: 0 });

    service = new VendorDiscoveryMaterializationService(resolutionService as never);
  });

  const materialize = (rows: CheckResultRow[]) =>
    service.materialize({ organizationId: 'org_1', rows, now: NOW });

  describe('recording observations', () => {
    it('creates a candidate and a grant for a newly observed app', async () => {
      const summary = await materialize([marker(), appRow()]);

      expect(summary.candidatesCreated).toBe(1);
      expect(summary.grantsUpserted).toBe(1);
      expect(mockDb.vendorAccessGrant.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            memberId: 'mem_1',
            externalAppId: 'slack.client',
            scopes: ['scope.read'],
          }),
        }),
      );
    });

    it('updates rather than duplicates a previously observed app', async () => {
      mockDb.discoveredVendorCandidate.findUnique.mockResolvedValue({
        id: 'dvc_1',
        status: 'pending',
      });

      const summary = await materialize([marker(), appRow()]);

      expect(summary.candidatesCreated).toBe(0);
      expect(summary.candidatesUpdated).toBe(1);
      expect(mockDb.discoveredVendorCandidate.create).not.toHaveBeenCalled();
    });

    it('auto-approves a candidate that resolves to a vendor already in the register', async () => {
      resolutionService.resolve.mockResolvedValue({
        method: 'existing_vendor',
        vendorId: 'vnd_1',
        resolvedName: 'Slack',
        resolvedWebsite: null,
        resolvedDescription: 'Chat',
        confidence: 1,
        autoIgnoreReason: null,
        eligibleForInference: false,
      });

      await materialize([marker(), appRow()]);

      expect(mockDb.discoveredVendorCandidate.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'approved', vendorId: 'vnd_1' }),
        }),
      );
    });

    it('creates a first-party app already ignored, with its reason', async () => {
      resolutionService.resolve.mockResolvedValue({
        method: 'unresolved',
        vendorId: null,
        resolvedName: null,
        resolvedWebsite: null,
        resolvedDescription: null,
        confidence: null,
        autoIgnoreReason: 'First-party Google application, not a third-party vendor',
        eligibleForInference: false,
      });

      await materialize([marker(), appRow()]);

      expect(mockDb.discoveredVendorCandidate.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'ignored',
            ignoredReason: expect.stringContaining('First-party'),
          }),
        }),
      );
    });
  });

  describe('member matching', () => {
    it('prefers the provider user key over email', async () => {
      // The alias case: same person, different address on the grant.
      mockDb.member.findMany.mockResolvedValue([
        { id: 'mem_key', externalUserId: 'u1', user: { email: 'other@example.com' } },
        { id: 'mem_email', externalUserId: 'u9', user: { email: 'a@example.com' } },
      ]);

      await materialize([marker(), appRow()]);

      expect(mockDb.vendorAccessGrant.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ memberId: 'mem_key' }) }),
      );
    });

    it('reports grantees matching no member rather than dropping them', async () => {
      mockDb.member.findMany.mockResolvedValue([]);

      const summary = await materialize([marker(), appRow()]);

      expect(summary.grantsUpserted).toBe(0);
      expect(summary.unmatchedGrantees).toEqual(['a@example.com']);
    });
  });

  describe('reconciliation safety', () => {
    it('withdraws a grant the complete run no longer reports', async () => {
      mockDb.vendorAccessGrant.findMany.mockResolvedValue([
        { id: 'vag_gone', memberId: 'mem_1', externalAppId: 'removed.client' },
        { id: 'vag_kept', memberId: 'mem_1', externalAppId: 'slack.client' },
      ]);
      mockDb.vendorAccessGrant.updateMany.mockResolvedValue({ count: 1 });

      const summary = await materialize([marker(), appRow()]);

      expect(summary.grantsWithdrawn).toBe(1);
      // Exactly the absent grant, and nothing else.
      expect(mockDb.vendorAccessGrant.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['vag_gone'] } },
        data: { revokedAt: NOW, revokedReason: 'not_observed' },
      });
    });

    it.each([
      ['incomplete', { complete: false }],
      ['no users inspected', { usersInspected: 0 }],
      ['unsupported schema', { schemaVersion: 99 }],
    ])('withdraws nothing when the run is %s', async (_label, evidence) => {
      mockDb.vendorAccessGrant.findMany.mockResolvedValue([
        { id: 'vag_gone', memberId: 'mem_1', externalAppId: 'removed.client' },
      ]);

      const summary = await materialize([marker(evidence), appRow()]);

      expect(summary.trustworthy).toBe(false);
      expect(summary.grantsWithdrawn).toBe(0);
      expect(mockDb.vendorAccessGrant.updateMany).not.toHaveBeenCalled();
      // But it still recorded what it saw.
      expect(summary.grantsUpserted).toBe(1);
    });

    it('withdraws nothing and records nothing when there are no results', async () => {
      const summary = await materialize([]);

      expect(summary.skippedReason).toBe('no-results');
      expect(mockDb.discoveredVendorCandidate.create).not.toHaveBeenCalled();
      expect(mockDb.vendorAccessGrant.updateMany).not.toHaveBeenCalled();
    });

    it('withdraws everything for a complete run reporting a genuinely empty inventory', async () => {
      mockDb.vendorAccessGrant.findMany.mockResolvedValue([
        { id: 'vag_1', memberId: 'mem_1', externalAppId: 'slack.client' },
      ]);
      mockDb.vendorAccessGrant.updateMany.mockResolvedValue({ count: 1 });

      const summary = await materialize([marker({ appCount: 0 })]);

      expect(summary.trustworthy).toBe(true);
      expect(summary.grantsWithdrawn).toBe(1);
    });
  });

  describe('grants reappearing', () => {
    it('restores a grant withdrawn merely for not being observed', async () => {
      mockDb.vendorAccessGrant.findUnique.mockResolvedValue({
        id: 'vag_1',
        revokedAt: new Date('2026-08-01T00:00:00Z'),
        revokedReason: 'not_observed',
      });

      await materialize([marker(), appRow()]);

      expect(mockDb.vendorAccessGrant.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ revokedAt: null, revokedReason: null }),
        }),
      );
    });

    it('keeps an offboarding-revoked grant revoked and records the reappearance', async () => {
      // Someone re-authorized after leaving. That is a finding, not a data refresh.
      mockDb.vendorAccessGrant.findUnique.mockResolvedValue({
        id: 'vag_1',
        revokedAt: new Date('2026-08-01T00:00:00Z'),
        revokedReason: 'offboarding',
      });

      await materialize([marker(), appRow()]);

      const call = mockDb.vendorAccessGrant.update.mock.calls[0][0];
      expect(call.data.reappearedAt).toEqual(NOW);
      expect(call.data.revokedAt).toBeUndefined();
      expect(call.data.revokedReason).toBeUndefined();
    });
  });
});
