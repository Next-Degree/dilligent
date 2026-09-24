import { describe, expect, it } from 'bun:test';
import { appAvailabilityCheck, summarizeRuns } from '../checks/app-availability';
import { environmentSeparationCheck } from '../checks/environment-separation';
import {
  createMockContext,
  environment,
  ORG,
  project,
  runs,
  worker,
  type MockFixtures,
} from './mock-context';

const base = (overrides: Partial<MockFixtures> = {}): MockFixtures => ({
  organizations: [ORG],
  projects: [project('proj_api', 'API')],
  environments: {
    proj_api: [environment('PRODUCTION'), environment('STAGING'), environment('DEVELOPMENT')],
  },
  workers: { proj_api: worker() },
  runs: { proj_api: runs({ COMPLETED: 20 }) },
  ...overrides,
});

describe('environment separation', () => {
  it('passes a project with Production and Staging', async () => {
    const ctx = createMockContext(base());
    await environmentSeparationCheck.run(ctx);

    expect(ctx._fails).toHaveLength(0);
    expect(ctx._passes[0].evidence).toMatchObject({ hasProduction: true, hasStaging: true });
  });

  it('does not accept Development or Preview as a staging environment', async () => {
    const ctx = createMockContext(
      base({
        environments: {
          proj_api: [environment('PRODUCTION'), environment('DEVELOPMENT'), environment('PREVIEW')],
        },
      }),
    );
    await environmentSeparationCheck.run(ctx);

    expect(ctx._fails[0].title).toBe('No Staging environment: API');
    expect(ctx._fails[0].evidence).toMatchObject({ hasPreview: true });
  });

  it('ignores projects outside the selected organizations', async () => {
    const other = { id: 'org_other', title: 'Other', slug: 'other' };
    const ctx = createMockContext(
      base({
        organizations: [ORG, other],
        projects: [project('proj_api', 'API'), { ...project('proj_x'), organization: other }],
        variables: { target_organizations: 'acme' },
      }),
    );
    await environmentSeparationCheck.run(ctx);

    expect(ctx._passes.map((p) => p.resourceId)).toEqual(['proj_api']);
  });

  it('never reads environment variable values', async () => {
    const ctx = createMockContext(base());
    await environmentSeparationCheck.run(ctx);

    expect(ctx._requests.some((r) => r.path.includes('envvars'))).toBe(false);
  });

  it('reports a project-less scope instead of passing silently', async () => {
    const ctx = createMockContext(base({ projects: [] }));
    await environmentSeparationCheck.run(ctx);

    expect(ctx._fails[0].title).toBe('No Trigger.dev projects found');
  });
});

describe('app availability', () => {
  it('passes a live, unpaused deployment with healthy runs', async () => {
    const ctx = createMockContext(base({ runs: { proj_api: runs({ COMPLETED: 18, FAILED: 2 }) } }));
    await appAvailabilityCheck.run(ctx);

    expect(ctx._fails).toHaveLength(0);
    expect(ctx._passes[0].evidence).toMatchObject({
      deployed: { version: '20260920.1', taskCount: 2 },
      runs: { finished: 20, failed: 2, failureRatePercent: 10, lookbackDays: 7 },
    });
  });

  it('filters runs to the production environment and lookback window', async () => {
    const ctx = createMockContext(base({ variables: { run_lookback_days: 3 } }));
    await appAvailabilityCheck.run(ctx);

    const request = ctx._requests.find((r) => r.path.endsWith('/runs'));
    expect(request?.params).toMatchObject({
      'filter[env]': 'prod',
      'filter[createdAt][period]': '3d',
    });
  });

  it('fails a paused production environment', async () => {
    const ctx = createMockContext(
      base({
        environments: { proj_api: [environment('PRODUCTION', { paused: true })] },
      }),
    );
    await appAvailabilityCheck.run(ctx);

    expect(ctx._fails[0]).toMatchObject({ title: 'Production paused: API', severity: 'high' });
  });

  it('fails when nothing is deployed to production', async () => {
    const ctx = createMockContext(base({ workers: {} }));
    await appAvailabilityCheck.run(ctx);

    expect(ctx._fails[0].title).toBe('No live production deployment: API');
  });

  it('fails a project without a production environment', async () => {
    const ctx = createMockContext(base({ environments: { proj_api: [environment('STAGING')] } }));
    await appAvailabilityCheck.run(ctx);

    expect(ctx._fails[0].title).toBe('No production environment: API');
  });

  it('fails when the failure rate exceeds the limit', async () => {
    const ctx = createMockContext(
      base({ runs: { proj_api: runs({ COMPLETED: 5, CRASHED: 3, TIMED_OUT: 2, CANCELED: 10 }) } }),
    );
    await appAvailabilityCheck.run(ctx);

    expect(ctx._fails[0].title).toBe('Production runs failing: API');
    expect(String(ctx._fails[0].description)).toContain('5 of 10');
  });

  it('does not judge the failure rate below the minimum sample', async () => {
    const ctx = createMockContext(base({ runs: { proj_api: runs({ COMPLETED: 1, FAILED: 3 }) } }));
    await appAvailabilityCheck.run(ctx);

    expect(ctx._fails).toHaveLength(0);
    expect(ctx._passes).toHaveLength(1);
  });

  it('passes a live deployment that had no runs in the window', async () => {
    const ctx = createMockContext(base({ runs: { proj_api: [] } }));
    await appAvailabilityCheck.run(ctx);

    expect(String(ctx._passes[0].description)).toContain('No runs finished');
  });

  it('follows the runs cursor across pages', async () => {
    const ctx = createMockContext(
      base({ runs: { proj_api: runs({ COMPLETED: 150, FAILED: 100 }) } }),
    );
    await appAvailabilityCheck.run(ctx);

    expect(ctx._requests.filter((r) => r.path.endsWith('/runs'))).toHaveLength(3);
    expect(ctx._fails[0].evidence).toMatchObject({ runs: { finished: 250, failed: 100 } });
  });

  it('reports unreadable run history rather than passing', async () => {
    const ctx = createMockContext(base({ errors: { '/runs': 500 } }));
    await appAvailabilityCheck.run(ctx);

    expect(ctx._fails[0].title).toBe('Run health unknown: API');
  });
});

describe('summarizeRuns', () => {
  it('excludes canceled and in-flight runs from the rate', () => {
    const stats = summarizeRuns(runs({ COMPLETED: 3, EXPIRED: 1, CANCELED: 4, EXECUTING: 2 }));
    expect(stats).toMatchObject({ total: 10, finished: 4, failed: 1, failureRatePercent: 25 });
  });

  it('has no rate when nothing finished', () => {
    expect(summarizeRuns([]).failureRatePercent).toBeNull();
  });
});
