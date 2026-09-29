import { NotFoundException } from '@nestjs/common';
import { db } from '@db';
import { TrustPublicSummaryService } from './trust-public-summary.service';

jest.mock('@db', () => ({
  db: {
    trust: { findFirst: jest.fn() },
    policy: { findMany: jest.fn() },
    control: { findMany: jest.fn() },
    frameworkInstance: { count: jest.fn() },
    vendor: { count: jest.fn() },
  },
}));

jest.mock('../app/s3', () => ({
  APP_AWS_ORG_ASSETS_BUCKET: 'org-assets',
  s3Client: { send: jest.fn() },
  getSignedUrl: jest.fn().mockResolvedValue('https://signed.example/asset'),
}));

const mockDb = db as unknown as {
  trust: { findFirst: jest.Mock };
  policy: { findMany: jest.Mock };
  control: { findMany: jest.Mock };
  frameworkInstance: { count: jest.Mock };
  vendor: { count: jest.Mock };
};

const baseTrust = {
  organizationId: 'org_1',
  friendlyUrl: 'acme',
  favicon: 'favicons/acme.png',
  soc2: false,
  soc2type1: false,
  soc2type2: true,
  soc3: false,
  iso27001: true,
  iso42001: false,
  nen7510: false,
  gdpr: true,
  hipaa: false,
  pci_dss: false,
  iso9001: false,
  pipeda: false,
  ccpa: false,
  soc2_status: 'started',
  soc2type1_status: 'started',
  soc2type2_status: 'compliant',
  soc3_status: 'started',
  iso27001_status: 'in_progress',
  iso42001_status: 'started',
  nen7510_status: 'started',
  gdpr_status: 'compliant',
  hipaa_status: 'started',
  pci_dss_status: 'started',
  iso9001_status: 'started',
  pipeda_status: 'started',
  ccpa_status: 'started',
  organization: {
    name: 'Acme Inc.',
    logo: 'logos/acme.png',
    primaryColor: '#0f766e',
    website: 'https://acme.com',
  },
};

describe('TrustPublicSummaryService', () => {
  const service = new TrustPublicSummaryService();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('resolveDomain', () => {
    it('returns the friendlyUrl for a verified, published domain', async () => {
      mockDb.trust.findFirst.mockResolvedValue({ friendlyUrl: 'acme' });

      await expect(
        service.resolveDomain('  Security.Acme.com '),
      ).resolves.toEqual({ friendlyUrl: 'acme' });
      expect(mockDb.trust.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            domain: 'security.acme.com',
            domainVerified: true,
            status: 'published',
          }),
        }),
      );
    });

    it('throws NotFound for an unknown domain', async () => {
      mockDb.trust.findFirst.mockResolvedValue(null);

      await expect(service.resolveDomain('nope.example.com')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getSummary', () => {
    beforeEach(() => {
      mockDb.policy.findMany.mockResolvedValue([
        { id: 'pol_1', name: 'Acceptable Use', description: null },
        { id: 'pol_2', name: 'Data Retention', description: 'How long' },
      ]);
      mockDb.control.findMany.mockResolvedValue([
        { id: 'ctl_1', name: 'Access Rights' },
      ]);
      mockDb.frameworkInstance.count.mockResolvedValue(2);
      mockDb.vendor.count.mockResolvedValue(6);
    });

    it('builds the summary with only enabled certifications', async () => {
      mockDb.trust.findFirst.mockResolvedValue(baseTrust);

      const result = await service.getSummary('acme');

      expect(result.organizationName).toBe('Acme Inc.');
      expect(result.logoUrl).toBe('https://signed.example/asset');
      expect(result.faviconUrl).toBe('https://signed.example/asset');
      expect(result.certifications).toEqual([
        { framework: 'soc2_type2', status: 'compliant' },
        { framework: 'iso_27001', status: 'in_progress' },
        { framework: 'gdpr', status: 'compliant' },
      ]);
      expect(result.stats).toEqual({
        policies: 2,
        controls: 1,
        frameworks: 3,
        subprocessors: 6,
      });
    });

    it('only queries published, non-archived policies for the org', async () => {
      mockDb.trust.findFirst.mockResolvedValue(baseTrust);

      await service.getSummary('acme');

      expect(mockDb.policy.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            organizationId: 'org_1',
            status: 'published',
            isArchived: false,
            archivedAt: null,
          },
        }),
      );
    });

    it('falls back to organization id when no friendlyUrl matches', async () => {
      mockDb.trust.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ ...baseTrust, friendlyUrl: null });

      const result = await service.getSummary('org_1');

      expect(result.friendlyUrl).toBe('org_1');
    });

    it('throws NotFound when the portal is not published', async () => {
      mockDb.trust.findFirst.mockResolvedValue(null);

      await expect(service.getSummary('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
