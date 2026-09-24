const mockDb = {
  vendor: { findMany: jest.fn() },
  globalVendors: { findMany: jest.fn() },
  dynamicIntegration: { findMany: jest.fn() },
};

jest.mock('@db', () => ({
  db: mockDb,
  VendorResolutionMethod: {
    existing_vendor: 'existing_vendor',
    global_catalogue: 'global_catalogue',
    integration_definition: 'integration_definition',
    inferred: 'inferred',
    unresolved: 'unresolved',
  },
}));

import { VendorResolutionService } from './vendor-resolution.service';

const candidate = (overrides: Partial<Parameters<VendorResolutionService['resolve']>[0]['candidate']> = {}) => ({
  externalAppId: 'client.id',
  displayName: 'Notion',
  nativeApp: false,
  anonymous: false,
  ...overrides,
});

describe('VendorResolutionService', () => {
  let service: VendorResolutionService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockDb.vendor.findMany.mockResolvedValue([]);
    mockDb.globalVendors.findMany.mockResolvedValue([]);
    mockDb.dynamicIntegration.findMany.mockResolvedValue([]);
    // Fresh instance per test so the integration cache never leaks between them.
    service = new VendorResolutionService();
  });

  const resolve = (overrides = {}) =>
    service.resolve({ candidate: candidate(overrides), organizationId: 'org_1' });

  describe('precedence', () => {
    it('prefers an existing vendor over every other tier', async () => {
      mockDb.vendor.findMany.mockResolvedValue([
        { id: 'vnd_1', name: 'Notion', website: 'https://notion.so', description: 'Docs' },
      ]);
      mockDb.globalVendors.findMany.mockResolvedValue([
        { website: 'https://notion.so', company_name: 'Notion', legal_name: null, company_description: 'Catalogue' },
      ]);

      const outcome = await resolve();

      expect(outcome.method).toBe('existing_vendor');
      expect(outcome.vendorId).toBe('vnd_1');
      // The anti-duplicate guarantee: the catalogue is never consulted once the register hits.
      expect(mockDb.globalVendors.findMany).not.toHaveBeenCalled();
    });

    it('falls to the global catalogue when the register has no match', async () => {
      mockDb.globalVendors.findMany.mockResolvedValue([
        {
          website: 'https://notion.so',
          company_name: 'Notion',
          legal_name: null,
          company_description: 'Workspace',
        },
      ]);

      const outcome = await resolve();

      expect(outcome.method).toBe('global_catalogue');
      expect(outcome.vendorId).toBeNull();
      expect(outcome.resolvedWebsite).toBe('https://notion.so');
      expect(outcome.resolvedDescription).toBe('Workspace');
    });

    it('falls to integration definitions when the catalogue has no match', async () => {
      mockDb.dynamicIntegration.findMany.mockResolvedValue([
        { name: 'Notion', description: 'Notion integration', baseUrl: 'https://api.notion.com/v1' },
      ]);

      const outcome = await resolve();

      expect(outcome.method).toBe('integration_definition');
      // Derived from the integration's base URL, reduced to the registrable domain.
      expect(outcome.resolvedWebsite).toBe('https://notion.com');
    });

    it('leaves a real but unknown name for inference', async () => {
      const outcome = await resolve({ displayName: 'Some Internal Tool' });

      expect(outcome.method).toBe('unresolved');
      expect(outcome.eligibleForInference).toBe(true);
    });
  });

  describe('matching discipline', () => {
    it('does not match a near-miss name', async () => {
      // A wrong link silently attributes one company's access to another, which is worse
      // than leaving it for a human.
      mockDb.vendor.findMany.mockResolvedValue([
        { id: 'vnd_1', name: 'Notion Labs', website: null, description: 'x' },
      ]);

      const outcome = await resolve({ displayName: 'Notion' });

      expect(outcome.method).not.toBe('existing_vendor');
      expect(outcome.vendorId).toBeNull();
    });

    it('matches through legal suffixes and sign-in boilerplate', async () => {
      mockDb.vendor.findMany.mockResolvedValue([
        { id: 'vnd_1', name: 'Notion, Inc.', website: null, description: 'x' },
      ]);

      const outcome = await resolve({ displayName: 'Sign in with Notion' });

      expect(outcome.method).toBe('existing_vendor');
      expect(outcome.vendorId).toBe('vnd_1');
    });

    it('matches a catalogue row on its legal name as well as its trading name', async () => {
      mockDb.globalVendors.findMany.mockResolvedValue([
        {
          website: 'https://notion.so',
          company_name: 'Notion',
          legal_name: 'Notion Labs Inc',
          company_description: null,
        },
      ]);

      const outcome = await resolve({ displayName: 'Notion Labs' });

      expect(outcome.method).toBe('global_catalogue');
    });
  });

  describe('applications with no usable identity', () => {
    it('leaves an anonymous app unresolved and out of inference', async () => {
      const outcome = await resolve({ anonymous: true });

      expect(outcome.method).toBe('unresolved');
      expect(outcome.eligibleForInference).toBe(false);
    });

    it.each([null, '', '   '])('leaves display name %p unresolved', async (displayName) => {
      const outcome = await resolve({ displayName });

      expect(outcome.method).toBe('unresolved');
      expect(outcome.eligibleForInference).toBe(false);
    });

    it('never queries the register for an unusable name', async () => {
      await resolve({ displayName: null });

      expect(mockDb.vendor.findMany).not.toHaveBeenCalled();
    });
  });

  describe('first-party applications', () => {
    it.each(['Google Drive', 'Google Chrome', 'YouTube', 'Android Device Manager'])(
      'auto-ignores %s with a recorded reason',
      async (displayName) => {
        const outcome = await resolve({ displayName });

        expect(outcome.autoIgnoreReason).toContain('First-party');
        expect(outcome.eligibleForInference).toBe(false);
      },
    );

    it('does not auto-ignore a third-party app merely for being a native client', async () => {
      // Genuine third-party desktop clients set nativeApp; treating that as first-party
      // would quietly drop real vendors out of the queue.
      const outcome = await resolve({ displayName: 'Figma', nativeApp: true });

      expect(outcome.autoIgnoreReason).toBeNull();
    });
  });

  describe('integration definition cache', () => {
    it('reads the integration table once across repeated resolutions', async () => {
      await resolve({ displayName: 'Unknown One' });
      await resolve({ displayName: 'Unknown Two' });

      expect(mockDb.dynamicIntegration.findMany).toHaveBeenCalledTimes(1);
    });

    it('degrades to the next tier when integrations cannot be read', async () => {
      mockDb.dynamicIntegration.findMany.mockRejectedValue(new Error('db down'));

      const outcome = await resolve({ displayName: 'Some Tool' });

      expect(outcome.method).toBe('unresolved');
      expect(outcome.eligibleForInference).toBe(true);
    });
  });
});
