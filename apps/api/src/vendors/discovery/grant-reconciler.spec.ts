import type { CheckResultRow } from '../../integration-platform/services/check-results.service';
import {
  FRESHNESS_WINDOW_MS,
  planReconciliation,
  type UntrustworthyReason,
} from './grant-reconciler';

const NOW = new Date('2026-08-20T08:00:00.000Z');

const row = (overrides: Partial<CheckResultRow>): CheckResultRow => ({
  resultId: 'res_1',
  resourceId: 'resource',
  resourceType: 'oauth_app',
  passed: true,
  title: 'title',
  description: null,
  evidence: {},
  collectedAt: NOW,
  runId: 'run_1',
  connectionId: 'icn_1',
  ...overrides,
});

const markerRow = (
  evidence: Record<string, unknown> = {},
  collectedAt: Date = NOW,
): CheckResultRow =>
  row({
    resourceId: 'google-workspace:oauth-inventory',
    resourceType: 'inventory',
    collectedAt,
    evidence: {
      schemaVersion: 1,
      complete: true,
      usersInspected: 10,
      appCount: 1,
      ...evidence,
    },
  });

const appRow = (
  overrides: {
    clientId?: string;
    resourceId?: string;
    grantees?: Array<{ email: string; userKey: string; scopeIndices: number[] }>;
    scopeCatalog?: string[];
    displayName?: string | null;
  } = {},
): CheckResultRow => {
  const clientId = overrides.clientId ?? 'slack.client';
  return row({
    resourceId: overrides.resourceId ?? clientId,
    resourceType: 'oauth_app',
    evidence: {
      schemaVersion: 1,
      clientId,
      displayName: overrides.displayName === undefined ? 'Slack' : overrides.displayName,
      nativeApp: false,
      anonymous: false,
      scopeCatalog: overrides.scopeCatalog ?? ['scope.read'],
      grantees: overrides.grantees ?? [
        { email: 'a@example.com', userKey: 'u1', scopeIndices: [0] },
      ],
    },
  });
};

describe('planReconciliation — the trust predicate', () => {
  // Withdrawal is written from *absence*. Absence only means "withdrawn" if the run that
  // produced it genuinely saw everything, so exactly one row of this table may withdraw.
  const cases: Array<{
    name: string;
    rows: CheckResultRow[];
    trustworthy: boolean;
    reason: UntrustworthyReason | null;
  }> = [
    {
      name: 'complete, fresh, users inspected, no consent failure',
      rows: [markerRow(), appRow()],
      trustworthy: true,
      reason: null,
    },
    {
      name: 'no results at all',
      rows: [],
      trustworthy: false,
      reason: 'no-results',
    },
    {
      name: 'app rows but no marker',
      rows: [appRow()],
      trustworthy: false,
      reason: 'no-marker',
    },
    {
      name: 'marker from a newer schema this code does not understand',
      rows: [markerRow({ schemaVersion: 2 }), appRow()],
      trustworthy: false,
      reason: 'unsupported-schema',
    },
    {
      name: 'marker reporting incomplete',
      rows: [markerRow({ complete: false }), appRow()],
      trustworthy: false,
      reason: 'incomplete',
    },
    {
      name: 'marker inspected nobody',
      rows: [markerRow({ usersInspected: 0 }), appRow()],
      trustworthy: false,
      reason: 'no-users-inspected',
    },
    {
      name: 'marker older than the freshness window',
      rows: [
        markerRow({}, new Date(NOW.getTime() - FRESHNESS_WINDOW_MS - 1000)),
        appRow(),
      ],
      trustworthy: false,
      reason: 'stale',
    },
    {
      name: 'a consent failure is present alongside a complete marker',
      rows: [
        markerRow(),
        row({ resourceId: 'google-workspace:scope-consent', resourceType: 'connection', passed: false }),
      ],
      trustworthy: false,
      reason: 'consent-failure',
    },
  ];

  it.each(cases)('$name', ({ rows, trustworthy, reason }) => {
    const plan = planReconciliation({ rows, now: NOW });

    expect(plan.trustworthy).toBe(trustworthy);
    expect(plan.untrustworthyReason).toBe(reason);
  });

  it('permits withdrawal in exactly one of the cases above', () => {
    const trusted = cases.filter(
      (testCase) => planReconciliation({ rows: testCase.rows, now: NOW }).trustworthy,
    );

    expect(trusted).toHaveLength(1);
    expect(trusted[0].name).toBe('complete, fresh, users inspected, no consent failure');
  });

  it('trusts a genuinely empty inventory, because nobody has authorized anything', () => {
    // The one case where zero app rows legitimately means "withdraw everything".
    const plan = planReconciliation({
      rows: [markerRow({ appCount: 0 })],
      now: NOW,
    });

    expect(plan.trustworthy).toBe(true);
    expect(plan.apps).toEqual([]);
  });

  it('still reports what it observed when the run is not trustworthy', () => {
    // Degraded runs must upsert what they saw — they simply may not withdraw.
    const plan = planReconciliation({
      rows: [markerRow({ complete: false }), appRow()],
      now: NOW,
    });

    expect(plan.trustworthy).toBe(false);
    expect(plan.apps).toHaveLength(1);
    expect(plan.apps[0].grantees).toHaveLength(1);
  });

  it('accepts a marker exactly at the freshness boundary', () => {
    const plan = planReconciliation({
      rows: [markerRow({}, new Date(NOW.getTime() - FRESHNESS_WINDOW_MS))],
      now: NOW,
    });

    expect(plan.trustworthy).toBe(true);
  });
});

describe('planReconciliation — regrouping', () => {
  it('joins spill parts back into one app', () => {
    const plan = planReconciliation({
      rows: [
        markerRow(),
        appRow({
          resourceId: 'big.app',
          clientId: 'big.app',
          grantees: [{ email: 'a@example.com', userKey: 'u1', scopeIndices: [0] }],
        }),
        appRow({
          resourceId: 'big.app#2',
          clientId: 'big.app',
          grantees: [{ email: 'b@example.com', userKey: 'u2', scopeIndices: [0] }],
        }),
      ],
      now: NOW,
    });

    expect(plan.apps).toHaveLength(1);
    expect(plan.apps[0].externalAppId).toBe('big.app');
    expect(plan.apps[0].grantees.map((g) => g.userKey).sort()).toEqual(['u1', 'u2']);
  });

  it('expands scope indices back into scope strings', () => {
    const plan = planReconciliation({
      rows: [
        markerRow(),
        appRow({
          scopeCatalog: ['scope.read', 'scope.write'],
          grantees: [
            { email: 'a@example.com', userKey: 'u1', scopeIndices: [0, 1] },
            { email: 'b@example.com', userKey: 'u2', scopeIndices: [0] },
          ],
        }),
      ],
      now: NOW,
    });

    const [app] = plan.apps;
    expect(app.grantees.find((g) => g.userKey === 'u1')?.scopes).toEqual([
      'scope.read',
      'scope.write',
    ]);
    expect(app.grantees.find((g) => g.userKey === 'u2')?.scopes).toEqual(['scope.read']);
    // App-level scopes are the union across grantees.
    expect(app.scopes.sort()).toEqual(['scope.read', 'scope.write']);
  });

  it('does not duplicate a grantee that appears in more than one row', () => {
    const grantee = { email: 'a@example.com', userKey: 'u1', scopeIndices: [0] };
    const plan = planReconciliation({
      rows: [
        markerRow(),
        appRow({ resourceId: 'app', clientId: 'app', grantees: [grantee] }),
        appRow({ resourceId: 'app#2', clientId: 'app', grantees: [grantee] }),
      ],
      now: NOW,
    });

    expect(plan.apps[0].grantees).toHaveLength(1);
  });

  it('ignores out-of-range scope indices rather than emitting undefined scopes', () => {
    const plan = planReconciliation({
      rows: [
        markerRow(),
        appRow({
          scopeCatalog: ['scope.read'],
          grantees: [{ email: 'a@example.com', userKey: 'u1', scopeIndices: [0, 7] }],
        }),
      ],
      now: NOW,
    });

    expect(plan.apps[0].grantees[0].scopes).toEqual(['scope.read']);
  });

  it('skips rows whose evidence carries no client id', () => {
    const plan = planReconciliation({
      rows: [markerRow(), row({ resourceType: 'oauth_app', evidence: { displayName: 'Orphan' } })],
      now: NOW,
    });

    expect(plan.apps).toEqual([]);
  });

  it('takes a display name from a later part when the first lacks one', () => {
    const plan = planReconciliation({
      rows: [
        markerRow(),
        appRow({ resourceId: 'app', clientId: 'app', displayName: null }),
        appRow({ resourceId: 'app#2', clientId: 'app', displayName: 'Named' }),
      ],
      now: NOW,
    });

    expect(plan.apps[0].displayName).toBe('Named');
  });
});
