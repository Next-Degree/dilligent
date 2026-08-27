jest.mock('@db', () => ({ db: {} }));

const mockTrigger = jest.fn();
jest.mock('@trigger.dev/sdk', () => ({
  tasks: { trigger: (...args: unknown[]) => mockTrigger(...args) },
}));

jest.mock('@trycompai/integration-platform', () => ({
  getManifest: () => ({
    id: 'google-workspace',
    checks: [{ id: 'two-factor-auth' }],
    variables: [],
  }),
}));

import { AutoCheckRunnerService } from './auto-check-runner.service';

const CONNECTION = {
  id: 'icn_1',
  providerId: 'prv_1',
  organizationId: 'org_1',
  variables: {},
};

function makeService(providerSlug: string) {
  const connectionRepository = { findById: jest.fn().mockResolvedValue(CONNECTION) };
  const providerRepository = {
    findById: jest.fn().mockResolvedValue({ id: 'prv_1', slug: providerSlug }),
  };
  return new AutoCheckRunnerService(
    connectionRepository as never,
    providerRepository as never,
  );
}

const triggeredTaskIds = () => mockTrigger.mock.calls.map((call) => call[0]);

describe('AutoCheckRunnerService — vendor discovery on connect', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockTrigger.mockResolvedValue({ id: 'run_1' });
  });

  it('dispatches discovery alongside the standard checks for Google Workspace', async () => {
    // Separate dispatch on purpose: the standard path persists under checkId 'all', which
    // the results reader cannot see.
    const service = makeService('google-workspace');

    await service.tryAutoRunChecks('icn_1');

    expect(triggeredTaskIds()).toEqual(['run-connection-checks', 'run-vendor-discovery']);
    expect(mockTrigger).toHaveBeenLastCalledWith('run-vendor-discovery', {
      connectionId: 'icn_1',
      organizationId: 'org_1',
    });
  });

  it('does not dispatch discovery for other providers', async () => {
    const service = makeService('github');

    await service.tryAutoRunChecks('icn_1');

    expect(triggeredTaskIds()).toEqual(['run-connection-checks']);
  });

  it('still reports success when discovery dispatch fails', async () => {
    // Discovery is additive and the daily schedule retries; failing here must not make the
    // connection itself look broken.
    const service = makeService('google-workspace');
    mockTrigger
      .mockResolvedValueOnce({ id: 'run_1' })
      .mockRejectedValueOnce(new Error('trigger unavailable'));

    await expect(service.tryAutoRunChecks('icn_1')).resolves.toBe(true);
  });
});
