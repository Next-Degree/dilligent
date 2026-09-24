import { Test, TestingModule } from '@nestjs/testing';
import { SyncController } from './sync.controller';
import { HybridAuthGuard } from '../../auth/hybrid-auth.guard';
import { PermissionGuard } from '../../auth/permission.guard';
import { ConnectionRepository } from '../repositories/connection.repository';
import { CredentialVaultService } from '../services/credential-vault.service';
import { OAuthCredentialsService } from '../services/oauth-credentials.service';
import { IntegrationSyncLoggerService } from '../services/integration-sync-logger.service';
import { GenericEmployeeSyncService } from '../services/generic-employee-sync.service';
import { GenericDeviceSyncService } from '../services/generic-device-sync.service';
import { DynamicIntegrationRepository } from '../repositories/dynamic-integration.repository';
import { CheckRunRepository } from '../repositories/check-run.repository';
import type { SyncDevice } from '@trycompai/integration-platform';

const mockGetManifest = jest.fn();
const mockInterpretDeclarativeDeviceSync = jest.fn();
const mockCreateCheckContext = jest.fn();
const mockProviderFindUnique = jest.fn();

jest.mock('@db', () => ({
  db: {
    integrationProvider: {
      findUnique: (...args: unknown[]) => mockProviderFindUnique(...args),
    },
  },
}));

jest.mock('../../auth/auth.server', () => ({
  auth: { api: { getSession: jest.fn() } },
}));

jest.mock('@trycompai/auth', () => ({
  statement: { integration: ['create', 'read', 'update', 'delete'] },
  BUILT_IN_ROLE_PERMISSIONS: {},
}));

jest.mock('@trycompai/integration-platform', () => {
  const actual = jest.requireActual<
    typeof import('@trycompai/integration-platform')
  >('@trycompai/integration-platform');
  return {
    ...actual,
    getManifest: (...args: unknown[]) => mockGetManifest(...args),
    interpretDeclarativeDeviceSync: (...args: unknown[]) =>
      mockInterpretDeclarativeDeviceSync(...args),
    createCheckContext: (...args: unknown[]) => mockCreateCheckContext(...args),
    TASK_TEMPLATE_INFO: {},
  };
});

describe('SyncController - dynamic provider device sync', () => {
  let controller: SyncController;

  const mockProcessDevices = jest.fn();
  const mockFindById = jest.fn();
  const mockFindBySlug = jest.fn();
  const mockGetDecryptedCredentials = jest.fn();
  const mockCheckRunCreate = jest.fn();
  const mockCheckRunComplete = jest.fn();
  const mockConnectionUpdate = jest.fn();
  const warn = jest.fn();

  const orgId = 'org_test123';
  const connectionId = 'conn_test123';
  const providerId = 'prov_test123';
  const providerSlug = 'mosyle';

  const device: SyncDevice = {
    name: "Ada's MacBook Pro",
    platform: 'macos',
    userEmail: 'ada@example.com',
    status: 'active',
    serialNumber: 'A12B345K3P',
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    mockFindById.mockResolvedValue({
      id: connectionId,
      organizationId: orgId,
      providerId,
      variables: {},
      metadata: {},
    });
    mockProviderFindUnique.mockResolvedValue({ id: providerId });
    mockGetDecryptedCredentials.mockResolvedValue({
      access_token: 'fake-token',
    });
    mockCheckRunCreate.mockResolvedValue({
      id: 'run_1',
      startedAt: new Date(),
    });
    mockCheckRunComplete.mockResolvedValue(undefined);
    mockCreateCheckContext.mockReturnValue({
      ctx: { warn },
      getResults: () => ({ logs: [] }),
    });
    mockProcessDevices.mockResolvedValue({
      success: true,
      totalFound: 1,
      imported: 1,
      updated: 0,
      skipped: 0,
      removed: 0,
      errors: 0,
      details: [],
    });

    const module: TestingModule = await Test.createTestingModule({
      controllers: [SyncController],
      providers: [
        {
          provide: ConnectionRepository,
          useValue: { findById: mockFindById, update: mockConnectionUpdate },
        },
        {
          provide: CredentialVaultService,
          useValue: {
            getDecryptedCredentials: mockGetDecryptedCredentials,
            refreshOAuthTokens: jest.fn(),
          },
        },
        {
          provide: OAuthCredentialsService,
          useValue: { getCredentials: jest.fn() },
        },
        {
          provide: IntegrationSyncLoggerService,
          useValue: { logSync: jest.fn() },
        },
        {
          provide: GenericEmployeeSyncService,
          useValue: { processEmployees: jest.fn() },
        },
        {
          provide: GenericDeviceSyncService,
          useValue: { processDevices: mockProcessDevices },
        },
        {
          provide: DynamicIntegrationRepository,
          useValue: { findBySlug: mockFindBySlug },
        },
        {
          provide: CheckRunRepository,
          useValue: {
            create: mockCheckRunCreate,
            complete: mockCheckRunComplete,
          },
        },
      ],
    })
      .overrideGuard(HybridAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<SyncController>(SyncController);
  });

  const run = () =>
    controller.syncDynamicProviderDevices(orgId, providerSlug, connectionId);

  describe('code-based manifests', () => {
    it('runs the manifest device sync and processes the devices it returns', async () => {
      const deviceSync = jest.fn().mockResolvedValue([device]);
      mockGetManifest.mockReturnValue({
        name: 'Mosyle',
        auth: { type: 'custom' },
        capabilities: ['checks', 'device_sync'],
        deviceSync,
      });
      // A code manifest needs no dynamic-integration row.
      mockFindBySlug.mockResolvedValue(null);

      const result = await run();

      expect(deviceSync).toHaveBeenCalledWith(
        expect.objectContaining({ warn }),
      );
      expect(mockInterpretDeclarativeDeviceSync).not.toHaveBeenCalled();
      expect(mockProcessDevices).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: orgId,
          connectionId,
          devices: [device],
          options: { providerName: 'Mosyle', isDirectorySource: false },
        }),
      );
      expect(result).toMatchObject({ imported: 1, syncRunId: 'run_1' });
      expect(mockConnectionUpdate).toHaveBeenCalledWith(connectionId, {
        lastSyncAt: expect.any(Date),
      });
    });

    it('drops devices that fail validation instead of writing malformed rows', async () => {
      mockGetManifest.mockReturnValue({
        name: 'Mosyle',
        auth: { type: 'custom' },
        capabilities: ['device_sync'],
        // Second entry has an unsupported platform — Mosyle also manages iPads.
        deviceSync: jest
          .fn()
          .mockResolvedValue([
            device,
            { ...device, platform: 'ipados', serialNumber: 'BAD' },
          ]),
      });
      mockFindBySlug.mockResolvedValue(null);

      await run();

      expect(mockProcessDevices).toHaveBeenCalledWith(
        expect.objectContaining({ devices: [device] }),
      );
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('Device at index 1'),
      );
    });

    it('takes precedence over a DSL definition stored for the same slug', async () => {
      const deviceSync = jest.fn().mockResolvedValue([device]);
      mockGetManifest.mockReturnValue({
        name: 'Mosyle',
        auth: { type: 'custom' },
        capabilities: ['device_sync'],
        deviceSync,
      });
      mockFindBySlug.mockResolvedValue({
        deviceSyncDefinition: { steps: [], devicesPath: 'devices' },
      });

      await run();

      expect(deviceSync).toHaveBeenCalled();
      expect(mockInterpretDeclarativeDeviceSync).not.toHaveBeenCalled();
    });

    it('honours isDirectorySource declared on the manifest', async () => {
      mockGetManifest.mockReturnValue({
        name: 'Mosyle',
        auth: { type: 'custom' },
        capabilities: ['device_sync'],
        isDirectorySource: true,
        deviceSync: jest.fn().mockResolvedValue([device]),
      });
      mockFindBySlug.mockResolvedValue(null);

      await run();

      expect(mockProcessDevices).toHaveBeenCalledWith(
        expect.objectContaining({
          options: expect.objectContaining({ isDirectorySource: true }),
        }),
      );
    });
  });

  describe('DSL-based dynamic integrations', () => {
    it('still runs the declarative definition when the manifest has no code runner', async () => {
      mockGetManifest.mockReturnValue({
        name: 'Some MDM',
        auth: { type: 'api_key' },
        capabilities: ['device_sync'],
      });
      mockFindBySlug.mockResolvedValue({
        deviceSyncDefinition: {
          steps: [],
          devicesPath: 'devices',
          isDirectorySource: true,
        },
      });
      mockInterpretDeclarativeDeviceSync.mockReturnValue({
        run: jest.fn().mockResolvedValue([device]),
      });

      await run();

      expect(mockInterpretDeclarativeDeviceSync).toHaveBeenCalled();
      expect(mockProcessDevices).toHaveBeenCalledWith(
        expect.objectContaining({
          devices: [device],
          options: { providerName: 'Some MDM', isDirectorySource: true },
        }),
      );
    });

    it('rejects a provider with neither a code runner nor a definition', async () => {
      mockGetManifest.mockReturnValue({
        name: 'Some MDM',
        auth: { type: 'api_key' },
        capabilities: ['device_sync'],
      });
      mockFindBySlug.mockResolvedValue(null);

      await expect(run()).rejects.toThrow('has no device sync definition');
    });
  });

  describe('guards', () => {
    it('rejects a provider that does not declare device_sync', async () => {
      mockGetManifest.mockReturnValue({
        name: 'Mosyle',
        auth: { type: 'custom' },
        capabilities: ['checks'],
        deviceSync: jest.fn(),
      });

      await expect(run()).rejects.toThrow('does not support device sync');
    });

    it('rejects a connection belonging to a different provider', async () => {
      mockGetManifest.mockReturnValue({
        name: 'Mosyle',
        auth: { type: 'custom' },
        capabilities: ['device_sync'],
        deviceSync: jest.fn(),
      });
      mockProviderFindUnique.mockResolvedValue({ id: 'prov_other' });

      await expect(run()).rejects.toThrow('does not belong to provider');
    });
  });
});
