const mockConnectionFindFirst = jest.fn();
const mockConnectionUpdate = jest.fn();
const mockCheckRunCreate = jest.fn();
const mockCheckRunUpdate = jest.fn();
const mockCheckResultCreateMany = jest.fn();

jest.mock('@db', () => ({
  db: {
    integrationConnection: {
      findFirst: mockConnectionFindFirst,
      update: mockConnectionUpdate,
    },
    integrationCheckRun: {
      create: mockCheckRunCreate,
      update: mockCheckRunUpdate,
    },
    integrationCheckResult: {
      createMany: mockCheckResultCreateMany,
    },
  },
}));

const mockGetManifest = jest.fn();
const mockRunCheck = jest.fn();
jest.mock('@trycompai/integration-platform', () => ({
  getManifest: mockGetManifest,
  runCheck: mockRunCheck,
}));

jest.mock('@trigger.dev/sdk', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
  schemaTask: (config: unknown) => config,
}));

const mockRequestValidCredentials = jest.fn();
jest.mock('../integration-platform/ensure-valid-credentials', () => ({
  getAccessToken: jest.fn(() => 'access-token'),
  requestValidCredentials: mockRequestValidCredentials,
}));

import { runVendorDiscoveryTask } from './run-vendor-discovery';

type RunVendorDiscovery = (payload: {
  connectionId: string;
  organizationId: string;
}) => Promise<unknown>;

function isTaskConfig(value: unknown): value is { run: RunVendorDiscovery } {
  if (!value || typeof value !== 'object') return false;
  return typeof Reflect.get(value, 'run') === 'function';
}

describe('runVendorDiscoveryTask', () => {
  const originalServiceToken = process.env.SERVICE_TOKEN_TRIGGER;
  let fetchSpy: jest.SpiedFunction<typeof fetch>;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.SERVICE_TOKEN_TRIGGER = 'service-token';

    mockConnectionFindFirst.mockResolvedValue({
      id: 'connection_1',
      metadata: {},
      provider: { slug: 'google-workspace' },
      variables: {},
    });
    mockGetManifest.mockReturnValue({
      checks: [{ id: 'oauth-app-access', name: 'Third-Party App Access' }],
    });
    mockRequestValidCredentials.mockResolvedValue({
      success: true,
      credentials: { access_token: 'access-token' },
    });
    mockCheckRunCreate.mockResolvedValue({ id: 'check_run_1' });
    mockRunCheck.mockResolvedValue({
      durationMs: 10,
      result: { findings: [], passingResults: [] },
    });
    mockCheckRunUpdate.mockResolvedValue({});
    fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ created: 1 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    if (originalServiceToken === undefined) {
      delete process.env.SERVICE_TOKEN_TRIGGER;
      return;
    }

    process.env.SERVICE_TOKEN_TRIGGER = originalServiceToken;
  });

  it('authenticates the materialisation request for the discovery organization', async () => {
    const taskConfig: unknown = runVendorDiscoveryTask;
    if (!isTaskConfig(taskConfig)) {
      throw new Error('Expected schemaTask to expose its run function');
    }

    await taskConfig.run({
      connectionId: 'connection_1',
      organizationId: 'organization_1',
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/v1/internal/vendor-discovery/materialize'),
      expect.objectContaining({
        headers: expect.objectContaining({
          'x-service-token': 'service-token',
          'x-organization-id': 'organization_1',
        }),
      }),
    );
  });
});
