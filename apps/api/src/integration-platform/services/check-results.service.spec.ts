jest.mock('@db', () => ({ db: {} }));

jest.mock('@trycompai/integration-platform', () => {
  const actual = jest.requireActual<
    typeof import('@trycompai/integration-platform')
  >('@trycompai/integration-platform');
  return {
    ...actual,
    registry: { getActiveManifests: jest.fn() },
  };
});

import { registry, TASK_TEMPLATES } from '@trycompai/integration-platform';
import { CheckResultsService } from './check-results.service';

const mockGetActiveManifests = (
  registry as unknown as { getActiveManifests: jest.Mock }
).getActiveManifests;

const mockCheckRunRepo = {
  findLatestResultsByConnectionAndCheck: jest.fn(),
  findLatestRunsByConnection: jest.fn(),
};
const mockConnRepo = {
  findBySlugAndOrg: jest.fn(),
  findActiveBySlugsAndOrg: jest.fn(),
};

function makeService() {
  return new CheckResultsService(
    mockCheckRunRepo as never,
    mockConnRepo as never,
  );
}

function boundManifest(id: string, name = id, category = 'Identity & Access') {
  return {
    id,
    name,
    logoUrl: null,
    category,
    checks: [
      { id: 'two-factor-auth', taskMapping: TASK_TEMPLATES.twoFactorAuth },
    ],
  };
}
function unboundManifest(id: string) {
  return {
    id,
    name: id,
    logoUrl: null,
    checks: [{ id: 'other', taskMapping: TASK_TEMPLATES.codeChanges }],
  };
}

const ORG = 'org_1';
const TWO_FA = TASK_TEMPLATES.twoFactorAuth;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('CheckResultsService.listSourcesBoundToTask', () => {
  it('returns only manifests bound to the task, with connection state + checkId', async () => {
    mockGetActiveManifests.mockReturnValue([
      boundManifest(
        'google-workspace',
        'Google Workspace',
        'Identity & Access',
      ),
      unboundManifest('slack'),
      boundManifest('github', 'GitHub', 'Development'),
    ]);
    mockConnRepo.findActiveBySlugsAndOrg.mockResolvedValue(
      new Map([
        ['google-workspace', { id: 'c1', lastSyncAt: null, nextSyncAt: null }],
      ]),
    );

    const sources = await makeService().listSourcesBoundToTask(ORG, TWO_FA);

    // One batched lookup for all bound slugs — not one query per manifest.
    expect(mockConnRepo.findActiveBySlugsAndOrg).toHaveBeenCalledWith(
      ['google-workspace', 'github'],
      ORG,
    );
    expect(sources.map((s) => s.slug)).toEqual(['google-workspace', 'github']);
    const gws = sources.find((s) => s.slug === 'google-workspace');
    expect(gws).toMatchObject({
      connected: true,
      connectionId: 'c1',
      checkId: 'two-factor-auth',
      // Category surfaces from the manifest so features can gate on it.
      category: 'Identity & Access',
    });
    expect(sources.find((s) => s.slug === 'github')?.connected).toBe(false);
    // Category flows through for every bound source.
    expect(sources.find((s) => s.slug === 'github')?.category).toBe(
      'Development',
    );
  });
});

describe('CheckResultsService.getLatestResultsByCheck', () => {
  it('maps repo rows into the generic envelope (evidence passed through untouched)', async () => {
    const collectedAt = new Date('2026-01-01T00:00:00Z');
    mockCheckRunRepo.findLatestResultsByConnectionAndCheck.mockResolvedValue({
      run: { id: 'run_1' },
      results: [
        {
          resourceId: 'a@x.com',
          resourceType: 'user',
          passed: true,
          title: 'Has 2FA',
          description: null,
          evidence: { isEnrolledIn2Sv: true },
          collectedAt,
        },
      ],
    });

    const rows = await makeService().getLatestResultsByCheck({
      organizationId: ORG,
      connectionId: 'conn_1',
      checkId: 'two-factor-auth',
      resourceType: 'user',
    });

    expect(rows).toEqual([
      {
        resourceId: 'a@x.com',
        resourceType: 'user',
        passed: true,
        title: 'Has 2FA',
        description: null,
        evidence: { isEnrolledIn2Sv: true },
        collectedAt,
        runId: 'run_1',
        connectionId: 'conn_1',
      },
    ]);
  });

  it('returns [] when there is no real run', async () => {
    mockCheckRunRepo.findLatestResultsByConnectionAndCheck.mockResolvedValue(
      null,
    );
    const rows = await makeService().getLatestResultsByCheck({
      organizationId: ORG,
      connectionId: 'conn_1',
      checkId: 'two-factor-auth',
    });
    expect(rows).toEqual([]);
  });
});

describe('CheckResultsService.getLatestResultsForTask', () => {
  it('resolves task->check and slug->connection, then fetches results', async () => {
    mockGetActiveManifests.mockReturnValue([boundManifest('google-workspace')]);
    mockConnRepo.findBySlugAndOrg.mockResolvedValue({
      id: 'conn_1',
      status: 'active',
    });
    mockCheckRunRepo.findLatestResultsByConnectionAndCheck.mockResolvedValue({
      run: { id: 'run_1' },
      results: [],
    });

    await makeService().getLatestResultsForTask({
      organizationId: ORG,
      taskTemplateId: TWO_FA,
      sourceSlug: 'google-workspace',
      resourceType: 'user',
    });

    expect(
      mockCheckRunRepo.findLatestResultsByConnectionAndCheck,
    ).toHaveBeenCalledWith({
      connectionId: 'conn_1',
      checkId: 'two-factor-auth',
      organizationId: ORG,
      resourceType: 'user',
    });
  });

  it('returns [] when the source is not bound to the task', async () => {
    mockGetActiveManifests.mockReturnValue([]);
    const rows = await makeService().getLatestResultsForTask({
      organizationId: ORG,
      taskTemplateId: TWO_FA,
      sourceSlug: 'google-workspace',
    });
    expect(rows).toEqual([]);
    expect(mockConnRepo.findBySlugAndOrg).not.toHaveBeenCalled();
  });

  it('returns [] when the source has no connection', async () => {
    mockGetActiveManifests.mockReturnValue([boundManifest('google-workspace')]);
    mockConnRepo.findBySlugAndOrg.mockResolvedValue(null);
    const rows = await makeService().getLatestResultsForTask({
      organizationId: ORG,
      taskTemplateId: TWO_FA,
      sourceSlug: 'google-workspace',
    });
    expect(rows).toEqual([]);
    expect(
      mockCheckRunRepo.findLatestResultsByConnectionAndCheck,
    ).not.toHaveBeenCalled();
  });
});

describe('CheckResultsService.listSourcesBySlugs', () => {
  it('returns connection state for the requested slugs only', async () => {
    mockGetActiveManifests.mockReturnValue([
      boundManifest('google-workspace', 'Google Workspace'),
      boundManifest('okta', 'Okta'),
    ]);
    mockConnRepo.findActiveBySlugsAndOrg.mockResolvedValue(
      new Map([
        ['okta', { id: 'conn_okta', lastSyncAt: null, nextSyncAt: null }],
      ]),
    );

    const sources = await makeService().listSourcesBySlugs(ORG, ['okta']);

    expect(mockConnRepo.findActiveBySlugsAndOrg).toHaveBeenCalledWith(
      ['okta'],
      ORG,
    );
    expect(sources).toEqual([
      expect.objectContaining({
        slug: 'okta',
        connected: true,
        connectionId: 'conn_okta',
      }),
    ]);
  });

  it('reports an unconnected integration rather than dropping it', async () => {
    mockGetActiveManifests.mockReturnValue([boundManifest('okta', 'Okta')]);
    mockConnRepo.findActiveBySlugsAndOrg.mockResolvedValue(new Map());

    const [source] = await makeService().listSourcesBySlugs(ORG, ['okta']);
    expect(source).toMatchObject({
      slug: 'okta',
      connected: false,
      connectionId: null,
    });
  });

  it('skips slugs that are not in the catalog', async () => {
    mockGetActiveManifests.mockReturnValue([boundManifest('okta', 'Okta')]);
    expect(await makeService().listSourcesBySlugs(ORG, ['nope'])).toEqual([]);
    expect(mockConnRepo.findActiveBySlugsAndOrg).not.toHaveBeenCalled();
  });
});

describe('CheckResultsService.getLatestRunSummariesByConnection', () => {
  it("maps every check's latest run to a summary", async () => {
    mockCheckRunRepo.findLatestRunsByConnection.mockResolvedValue([
      {
        id: 'run_1',
        checkId: 'check_a',
        checkName: 'Check A',
        status: 'success',
        startedAt: new Date('2026-01-01T00:00:00.000Z'),
        completedAt: new Date('2026-01-01T00:00:10.000Z'),
        totalChecked: 3,
        passedCount: 2,
        failedCount: 1,
        errorMessage: null,
      },
    ]);

    const summaries = await makeService().getLatestRunSummariesByConnection({
      organizationId: ORG,
      connectionId: 'conn_1',
    });

    expect(summaries).toEqual([
      {
        checkId: 'check_a',
        checkName: 'Check A',
        runId: 'run_1',
        status: 'success',
        startedAt: new Date('2026-01-01T00:00:00.000Z'),
        completedAt: new Date('2026-01-01T00:00:10.000Z'),
        totalChecked: 3,
        passedCount: 2,
        failedCount: 1,
        errorMessage: null,
      },
    ]);
  });

  it('returns [] when no check has really run yet', async () => {
    mockCheckRunRepo.findLatestRunsByConnection.mockResolvedValue([]);
    expect(
      await makeService().getLatestRunSummariesByConnection({
        organizationId: ORG,
        connectionId: 'conn_1',
      }),
    ).toEqual([]);
  });
});
