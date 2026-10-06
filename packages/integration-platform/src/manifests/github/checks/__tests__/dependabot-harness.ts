/**
 * Shared fake GitHub context for Dependabot check tests.
 */

import type { CheckContext, CheckResult, CheckVariableValues } from '../../../../types';
import type { GitHubDependabotAlert, GitHubRepo } from '../../types';
import { dependabotCheck } from '../dependabot';

export type AlertSeverity = 'critical' | 'high' | 'medium' | 'low';

interface RepoFixture {
  full_name: string;
  name: string;
  html_url: string;
  dependabotStatus: 'enabled' | 'paused' | 'disabled' | 'unknown';
  openAlertSeverities: AlertSeverity[];
  /** Explicit open alerts; overrides openAlertSeverities when set. */
  openAlerts?: GitHubDependabotAlert[];
  fixedCount?: number;
  dismissedCount?: number;
  alertsFetchFails?: boolean;
}

interface RunResult {
  passed: Array<{ resourceId: string; title: string; description: string }>;
  failed: Array<{
    resourceId: string;
    title: string;
    description: string;
    severity: CheckResult['severity'];
  }>;
  evidence: Record<string, unknown>[];
}

const makeRepo = (fixture: RepoFixture): GitHubRepo =>
  ({
    id: 1,
    name: fixture.name,
    full_name: fixture.full_name,
    private: false,
    html_url: fixture.html_url,
    default_branch: 'main',
    owner: { login: fixture.full_name.split('/')[0]!, type: 'Organization' },
  }) as GitHubRepo;

const YEAR_AGO = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();

// Alerts default to a year old so they are past every default SLA.
export const makeAlert = (
  severity: AlertSeverity,
  overrides: { number?: number; createdAt?: string | null } = {},
): GitHubDependabotAlert =>
  ({
    number: overrides.number ?? Math.floor(Math.random() * 10000),
    state: 'open',
    security_vulnerability: { severity },
    created_at: overrides.createdAt === undefined ? YEAR_AGO : overrides.createdAt,
  }) as unknown as GitHubDependabotAlert;

export const daysAgo = (days: number): string =>
  new Date(Date.now() - days * 24 * 60 * 60 * 1000 - 60 * 1000).toISOString();

export async function runCheck(
  fixtures: RepoFixture[],
  variables: CheckVariableValues,
): Promise<RunResult> {
  const passed: RunResult['passed'] = [];
  const failed: RunResult['failed'] = [];
  const evidence: RunResult['evidence'] = [];

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
      evidence.push(result.evidence ?? {});
      passed.push({
        resourceId: result.resourceId ?? '',
        title: result.title,
        description: result.description,
      });
    },
    fail: (result) => {
      evidence.push(result.evidence ?? {});
      failed.push({
        resourceId: result.resourceId ?? '',
        title: result.title,
        description: result.description,
        severity: result.severity,
      });
    },
    fetch: (async <T>(path: string): Promise<T> => {
      // /repos/<owner>/<repo>
      const repoMatch = path.match(/^\/repos\/([^/]+\/[^/]+)$/);
      if (repoMatch) {
        const fixture = byFullName.get(repoMatch[1]!);
        if (!fixture) throw new Error(`404 ${path}`);
        return makeRepo(fixture) as unknown as T;
      }
      // /repos/<owner>/<repo>/automated-security-fixes
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
    fetchWithLinkHeader: (async <T>(
      path: string,
      options?: { params?: Record<string, string> },
    ): Promise<T[]> => {
      const alertsMatch = path.match(/^\/repos\/([^/]+\/[^/]+)\/dependabot\/alerts$/);
      if (!alertsMatch) throw new Error(`Unexpected fetchWithLinkHeader: ${path}`);
      const fixture = byFullName.get(alertsMatch[1]!);
      if (!fixture) throw new Error(`404 ${path}`);
      if (fixture.alertsFetchFails) throw new Error('403 Forbidden');
      const state = options?.params?.state;
      if (state === 'open') {
        const open = fixture.openAlerts ?? fixture.openAlertSeverities.map((s) => makeAlert(s));
        return open as unknown as T[];
      }
      if (state === 'fixed') {
        return Array(fixture.fixedCount ?? 0).fill(makeAlert('low')) as unknown as T[];
      }
      if (state === 'dismissed') {
        return Array(fixture.dismissedCount ?? 0).fill(makeAlert('low')) as unknown as T[];
      }
      return [] as unknown as T[];
    }) as CheckContext['fetchWithLinkHeader'],
    fetchWithCursor: (async () => []) as CheckContext['fetchWithCursor'],
    graphql: (async () => ({})) as CheckContext['graphql'],
    getState: (async () => null) as CheckContext['getState'],
    setState: (async () => {}) as CheckContext['setState'],
  } as CheckContext;

  await dependabotCheck.run(ctx);
  return { passed, failed, evidence };
}

export const repo = (fullName: string, overrides: Partial<RepoFixture> = {}): RepoFixture => ({
  full_name: fullName,
  name: fullName.split('/')[1]!,
  html_url: `https://github.com/${fullName}`,
  dependabotStatus: 'enabled',
  openAlertSeverities: [],
  ...overrides,
});
