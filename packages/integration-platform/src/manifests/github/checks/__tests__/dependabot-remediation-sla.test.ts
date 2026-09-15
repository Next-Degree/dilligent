import { describe, expect, it } from 'bun:test';
import type { CheckContext, CheckResult, CheckVariableValues } from '../../../../types';
import type { GitHubDependabotAlert, GitHubRepo } from '../../types';
import { dependabotRemediationSlaCheck } from '../dependabot-remediation-sla';
import type { SlaSeverity } from '../dependabot-sla';

const NOW = new Date('2026-09-15T00:00:00.000Z');
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** ISO timestamp for an alert opened `days` before NOW. */
const daysAgo = (days: number): string => new Date(NOW.getTime() - days * MS_PER_DAY).toISOString();

interface AlertFixture {
  severity: SlaSeverity | 'medium' | 'low';
  ageDays?: number;
  createdAt?: string | null;
}

interface RepoFixture {
  full_name: string;
  name: string;
  dependabotStatus: 'enabled' | 'paused' | 'disabled' | 'unknown';
  openAlerts: AlertFixture[];
  alertsFetchFails?: boolean;
}

interface RunResult {
  passed: Array<{ resourceId: string; title: string; description: string }>;
  failed: Array<{
    resourceId: string;
    title: string;
    description: string;
    severity: CheckResult['severity'];
    evidence?: Record<string, unknown>;
  }>;
}

const repo = (fullName: string, overrides: Partial<RepoFixture> = {}): RepoFixture => ({
  full_name: fullName,
  name: fullName.split('/')[1]!,
  dependabotStatus: 'enabled',
  openAlerts: [],
  ...overrides,
});

const makeRepo = (fixture: RepoFixture): GitHubRepo =>
  ({
    id: 1,
    name: fixture.name,
    full_name: fixture.full_name,
    private: true,
    html_url: `https://github.com/${fixture.full_name}`,
    default_branch: 'main',
    owner: { login: fixture.full_name.split('/')[0]!, type: 'Organization' },
  }) as GitHubRepo;

let alertCounter = 0;
const makeAlert = (fixture: AlertFixture): GitHubDependabotAlert => {
  alertCounter += 1;
  const createdAt =
    fixture.createdAt === null
      ? undefined
      : (fixture.createdAt ?? daysAgo(fixture.ageDays ?? 0));
  return {
    number: alertCounter,
    state: 'open',
    dependency: { package: { ecosystem: 'npm', name: `pkg-${alertCounter}` } },
    security_advisory: { ghsa_id: `GHSA-${alertCounter}`, severity: fixture.severity },
    security_vulnerability: { severity: fixture.severity },
    created_at: createdAt,
    html_url: `https://github.com/acme/api/security/dependabot/${alertCounter}`,
  } as unknown as GitHubDependabotAlert;
};

async function runCheck(
  fixtures: RepoFixture[],
  variables: CheckVariableValues,
): Promise<RunResult> {
  const passed: RunResult['passed'] = [];
  const failed: RunResult['failed'] = [];
  const byFullName = new Map(fixtures.map((f) => [f.full_name, f]));

  const ctx: CheckContext = {
    accessToken: 'tok',
    credentials: {},
    variables,
    connectionId: 'conn_1',
    organizationId: 'org_1',
    metadata: {},
    log: () => {},
    warn: () => {},
    pass: (result) => {
      passed.push({
        resourceId: result.resourceId ?? '',
        title: result.title,
        description: result.description,
      });
    },
    fail: (result) => {
      failed.push({
        resourceId: result.resourceId ?? '',
        title: result.title,
        description: result.description,
        severity: result.severity,
        evidence: result.evidence,
      });
    },
    fetch: (async <T,>(path: string): Promise<T> => {
      const repoMatch = path.match(/^\/repos\/([^/]+\/[^/]+)$/);
      if (repoMatch) {
        const fixture = byFullName.get(repoMatch[1]!);
        if (!fixture) throw new Error(`404 ${path}`);
        return makeRepo(fixture) as unknown as T;
      }
      const statusMatch = path.match(/^\/repos\/([^/]+\/[^/]+)\/automated-security-fixes$/);
      if (statusMatch) {
        const fixture = byFullName.get(statusMatch[1]!);
        if (!fixture) throw new Error(`404 ${path}`);
        if (fixture.dependabotStatus === 'unknown') throw new Error('403 Forbidden');
        if (fixture.dependabotStatus === 'disabled') throw new Error('404 Not Found');
        return {
          enabled: true,
          paused: fixture.dependabotStatus === 'paused',
        } as unknown as T;
      }
      throw new Error(`Unexpected fetch: ${path}`);
    }) as CheckContext['fetch'],
    fetchAllPages: (async () => []) as CheckContext['fetchAllPages'],
    fetchWithLinkHeader: (async <T,>(path: string): Promise<T[]> => {
      const match = path.match(/^\/repos\/([^/]+\/[^/]+)\/dependabot\/alerts$/);
      if (!match) throw new Error(`Unexpected fetchWithLinkHeader: ${path}`);
      const fixture = byFullName.get(match[1]!);
      if (!fixture) throw new Error(`404 ${path}`);
      if (fixture.alertsFetchFails) throw new Error('403 Forbidden');
      return fixture.openAlerts.map(makeAlert) as unknown as T[];
    }) as CheckContext['fetchWithLinkHeader'],
    fetchWithCursor: (async () => []) as CheckContext['fetchWithCursor'],
    graphql: (async () => ({})) as CheckContext['graphql'],
    getState: (async () => null) as CheckContext['getState'],
    setState: (async () => {}) as CheckContext['setState'],
  } as CheckContext;

  await dependabotRemediationSlaCheck.run(ctx);
  return { passed, failed };
}

describe('dependabotRemediationSlaCheck — Dependabot enablement', () => {
  it('fails when Dependabot is disabled, even with zero alerts', async () => {
    const result = await runCheck([repo('acme/api', { dependabotStatus: 'disabled' })], {
      target_repos: ['acme/api'],
    });
    expect(result.passed).toEqual([]);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]!.title).toBe('Dependency scanning not enabled on api');
    expect(result.failed[0]!.severity).toBe('high');
  });

  it('fails at medium severity when the Dependabot setting cannot be read', async () => {
    const result = await runCheck([repo('acme/api', { dependabotStatus: 'unknown' })], {
      target_repos: ['acme/api'],
    });
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]!.title).toBe('Unable to confirm dependency scanning on api');
    expect(result.failed[0]!.severity).toBe('medium');
  });

  it('treats paused Dependabot as enabled', async () => {
    const result = await runCheck([repo('acme/api', { dependabotStatus: 'paused' })], {
      target_repos: ['acme/api'],
    });
    expect(result.failed).toEqual([]);
    expect(result.passed).toHaveLength(1);
    expect(result.passed[0]!.description).toContain('paused');
  });

  it('fails rather than passes when the alert list cannot be read', async () => {
    const result = await runCheck([repo('acme/api', { alertsFetchFails: true })], {
      target_repos: ['acme/api'],
    });
    expect(result.passed).toEqual([]);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]!.title).toBe('Unable to read dependency alerts on api');
  });
});

describe('dependabotRemediationSlaCheck — SLA windows', () => {
  it('passes when a critical alert is open but still inside the default 15-day window', async () => {
    const result = await runCheck(
      [repo('acme/api', { openAlerts: [{ severity: 'critical', ageDays: 10 }] })],
      { target_repos: ['acme/api'] },
    );
    expect(result.failed).toEqual([]);
    expect(result.passed).toHaveLength(1);
    expect(result.passed[0]!.title).toBe('Dependency alerts within remediation SLA on api');
    expect(result.passed[0]!.description).toContain('1 open alert is still inside the window');
  });

  it('fails when a critical alert has passed the default 15-day window', async () => {
    const result = await runCheck(
      [repo('acme/api', { openAlerts: [{ severity: 'critical', ageDays: 20 }] })],
      { target_repos: ['acme/api'] },
    );
    expect(result.passed).toEqual([]);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]!.title).toBe('1 dependency alert past remediation SLA on api');
    expect(result.failed[0]!.severity).toBe('critical');
    expect(result.failed[0]!.description).toContain('5 past its 15-day deadline');
  });

  it('applies the high window separately from the critical one', async () => {
    // 20 days: past the 15-day critical window, inside the 30-day high window.
    const result = await runCheck(
      [repo('acme/api', { openAlerts: [{ severity: 'high', ageDays: 20 }] })],
      { target_repos: ['acme/api'] },
    );
    expect(result.failed).toEqual([]);
    expect(result.passed).toHaveLength(1);
  });

  it('honours configured windows over the defaults', async () => {
    const result = await runCheck(
      [repo('acme/api', { openAlerts: [{ severity: 'high', ageDays: 10 }] })],
      { target_repos: ['acme/api'], critical_remediation_sla_days: 3, high_remediation_sla_days: 7 },
    );
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]!.severity).toBe('high');
    expect(result.failed[0]!.description).toContain('critical 3 days, high 7 days');
  });

  it('reports critical severity when the breaching set mixes critical and high', async () => {
    const result = await runCheck(
      [
        repo('acme/api', {
          openAlerts: [
            { severity: 'high', ageDays: 40 },
            { severity: 'critical', ageDays: 18 },
          ],
        }),
      ],
      { target_repos: ['acme/api'] },
    );
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]!.severity).toBe('critical');
    expect(result.failed[0]!.title).toBe('2 dependency alerts past remediation SLA on api');
    // Worst overdue first: the high alert is 10 days over, the critical only 3.
    expect(result.failed[0]!.description).toContain('has been open 40 days');
  });

  it('ignores medium and low alerts entirely', async () => {
    const result = await runCheck(
      [
        repo('acme/api', {
          openAlerts: [
            { severity: 'medium', ageDays: 400 },
            { severity: 'low', ageDays: 900 },
          ],
        }),
      ],
      { target_repos: ['acme/api'] },
    );
    expect(result.failed).toEqual([]);
    expect(result.passed[0]!.description).toContain('no open critical or high alerts');
  });

  it('records SLA windows and per-alert ages in the evidence', async () => {
    const result = await runCheck(
      [repo('acme/api', { openAlerts: [{ severity: 'critical', ageDays: 20 }] })],
      { target_repos: ['acme/api'] },
    );
    const evidence = result.failed[0]!.evidence?.['acme/api'] as Record<string, unknown>;
    expect(evidence.remediation_sla_days).toEqual({ critical: 15, high: 30 });
    expect(evidence.open_critical_high_alerts).toEqual({
      breaching_sla: 1,
      within_sla: 0,
      undated: 0,
    });
    const breaching = evidence.breaching_alerts as Array<Record<string, unknown>>;
    expect(breaching[0]!.age_days).toBe(20);
    expect(breaching[0]!.sla_days).toBe(15);
    expect(breaching[0]!.overdue_days).toBe(5);
  });

  it('fails an alert opened today when the window is set to zero days', async () => {
    const result = await runCheck(
      [repo('acme/api', { openAlerts: [{ severity: 'critical', ageDays: 1 }] })],
      { target_repos: ['acme/api'], critical_remediation_sla_days: 0 },
    );
    expect(result.failed).toHaveLength(1);
  });

  it('emits a finding for a repository it cannot read', async () => {
    const result = await runCheck([repo('acme/api')], {
      target_repos: ['acme/api', 'acme/ghost'],
    });
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]!.title).toBe('Repository not found: acme/ghost');
    expect(result.passed).toHaveLength(1);
  });
});
