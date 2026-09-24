const dbMock = {
  findingRegression: { findMany: jest.fn() },
  findingResolution: { findMany: jest.fn() },
};

jest.mock('@db', () => ({ db: dbMock }));

import type { AuthContext } from '../../auth/types';
import { findingRegressionSource } from './finding-regression.source';

const ORG = 'org_1';
const AUTH: AuthContext = {
  organizationId: ORG,
  authType: 'session',
  isApiKey: false,
  isPlatformAdmin: false,
  userRoles: ['admin'],
};

const day = (n: number) => new Date(Date.UTC(2026, 8, n));

function regression(
  overrides: Partial<{
    id: string;
    connectionId: string;
    checkId: string;
    resourceId: string;
    regressedAt: Date;
    daysClean: number | null;
  }> = {},
) {
  return {
    id: 'freg_1',
    connectionId: 'icn_aws',
    checkId: 's3-bucket-public-access',
    resourceId: 'arn:aws:s3:::audit-logs',
    regressedAt: day(20),
    daysClean: 12,
    connection: { provider: { slug: 'aws', name: 'AWS' } },
    ...overrides,
  };
}

async function collect(limit = 50) {
  return findingRegressionSource.collect({
    organizationId: ORG,
    limit,
    auth: AUTH,
  });
}

describe('findingRegressionSource', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    dbMock.findingRegression.findMany.mockResolvedValue([]);
    dbMock.findingResolution.findMany.mockResolvedValue([]);
  });

  it('requires integration:read', () => {
    expect(findingRegressionSource.requires).toEqual([
      { resource: 'integration', action: 'read' },
    ]);
  });

  it('only considers regressions on active connections in the caller organization', async () => {
    await collect();

    expect(dbMock.findingRegression.findMany.mock.calls[0][0].where).toEqual({
      organizationId: ORG,
      connection: { status: 'active' },
    });
  });

  it('skips the resolution lookup when there are no regressions', async () => {
    const result = await collect();

    expect(result).toEqual({ items: [], total: 0 });
    expect(dbMock.findingResolution.findMany).not.toHaveBeenCalled();
  });

  it('maps a regression to a link to that provider on the cloud tests page', async () => {
    dbMock.findingRegression.findMany.mockResolvedValue([regression()]);

    const { items, total } = await collect();

    expect(total).toBe(1);
    expect(items).toEqual([
      {
        key: 'v1:finding-regression:freg_1',
        kind: 'finding-regression',
        severity: 'critical',
        title: 's3-bucket-public-access',
        detail:
          'AWS · arn:aws:s3:::audit-logs — failing again after 12 days clean',
        path: 'cloud-tests?provider=aws',
        occurredAt: day(20),
        assigneeMemberId: null,
      },
    ]);
  });

  it('describes a regression with no recorded clean period', async () => {
    dbMock.findingRegression.findMany.mockResolvedValue([
      regression({ daysClean: null }),
    ]);

    const { items } = await collect();

    expect(items[0].detail).toBe(
      'AWS · arn:aws:s3:::audit-logs — failing again after being resolved',
    );
  });

  it('keeps only the newest regression for the same finding', async () => {
    dbMock.findingRegression.findMany.mockResolvedValue([
      regression({ id: 'freg_new', regressedAt: day(20) }),
      regression({ id: 'freg_old', regressedAt: day(5) }),
    ]);

    const { items, total } = await collect();

    expect(total).toBe(1);
    expect(items.map((item) => item.key)).toEqual([
      'v1:finding-regression:freg_new',
    ]);
  });

  it('drops a regression that was resolved again afterwards', async () => {
    dbMock.findingRegression.findMany.mockResolvedValue([
      regression({
        id: 'freg_fixed',
        resourceId: 'bucket-a',
        regressedAt: day(10),
      }),
      regression({
        id: 'freg_open',
        resourceId: 'bucket-b',
        regressedAt: day(10),
      }),
    ]);
    dbMock.findingResolution.findMany.mockResolvedValue([
      {
        connectionId: 'icn_aws',
        checkId: 's3-bucket-public-access',
        resourceId: 'bucket-a',
        resolvedAt: day(15),
      },
    ]);

    const { items, total } = await collect();

    expect(total).toBe(1);
    expect(items.map((item) => item.key)).toEqual([
      'v1:finding-regression:freg_open',
    ]);
  });

  it('keeps a regression whose only resolution is not later than it', async () => {
    dbMock.findingRegression.findMany.mockResolvedValue([
      regression({ regressedAt: day(10) }),
    ]);
    dbMock.findingResolution.findMany.mockResolvedValue([
      {
        connectionId: 'icn_aws',
        checkId: 's3-bucket-public-access',
        resourceId: 'arn:aws:s3:::audit-logs',
        resolvedAt: day(10),
      },
    ]);

    const { total } = await collect();

    expect(total).toBe(1);
  });

  it('does not treat a resolution on another connection as a fix', async () => {
    dbMock.findingRegression.findMany.mockResolvedValue([regression()]);
    dbMock.findingResolution.findMany.mockResolvedValue([
      {
        connectionId: 'icn_other',
        checkId: 's3-bucket-public-access',
        resourceId: 'arn:aws:s3:::audit-logs',
        resolvedAt: day(25),
      },
    ]);

    const { total } = await collect();

    expect(total).toBe(1);
  });

  it('scopes the resolution lookup to the organization and the oldest candidate', async () => {
    dbMock.findingRegression.findMany.mockResolvedValue([
      regression({ id: 'a', resourceId: 'r1', regressedAt: day(20) }),
      regression({ id: 'b', resourceId: 'r2', regressedAt: day(3) }),
    ]);

    await collect();

    expect(dbMock.findingResolution.findMany.mock.calls[0][0].where).toEqual({
      organizationId: ORG,
      connectionId: { in: ['icn_aws'] },
      checkId: { in: ['s3-bucket-public-access'] },
      resolvedAt: { gt: day(3) },
    });
  });

  it('returns at most `limit` items but reports the full count', async () => {
    dbMock.findingRegression.findMany.mockResolvedValue(
      Array.from({ length: 4 }, (_, i) =>
        regression({ id: `freg_${i}`, resourceId: `bucket-${i}` }),
      ),
    );

    const { items, total } = await collect(2);

    expect(items).toHaveLength(2);
    expect(total).toBe(4);
  });

  it('encodes the provider slug in the link', async () => {
    dbMock.findingRegression.findMany.mockResolvedValue([
      { ...regression(), connection: { provider: { slug: 'a&b', name: 'X' } } },
    ]);

    const { items } = await collect();

    expect(items[0].path).toBe('cloud-tests?provider=a%26b');
  });
});
