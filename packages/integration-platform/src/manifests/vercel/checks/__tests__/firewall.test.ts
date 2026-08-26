import { describe, expect, it } from 'bun:test';
import type { CheckVariableValues } from '../../../../types';
import type { VercelFirewallConfig, VercelProject, VercelProjectsResponse } from '../../types';
import { firewallCheck } from '../firewall';
import { findByResourceId, httpError, makeCheckContext } from './harness';

const TEAM_ID = 'team_1';

const makeProject = (id: string, name = id): VercelProject => ({
  id,
  name,
  accountId: 'acc_1',
  createdAt: 0,
  updatedAt: 0,
});

const enabledConfig: VercelFirewallConfig = {
  version: 7,
  updatedAt: '2026-01-01T00:00:00.000Z',
  firewallEnabled: true,
  botIdEnabled: true,
  rules: [
    { id: 'r1', name: 'block-bad', active: true },
    { id: 'r2', active: false },
  ],
  ips: [{ id: 'ip1', ip: '1.2.3.4', action: 'deny' }],
  managedRules: { owasp: { active: true }, ai_bots: { active: false } },
};

function run(options: {
  projects: VercelProject[];
  firewall: (projectId: string) => unknown;
  variables?: CheckVariableValues;
  projectPages?: Record<string, VercelProjectsResponse>;
}) {
  const recorded = makeCheckContext({
    teamId: TEAM_ID,
    variables: options.variables,
    handle: (path) => {
      if (path.startsWith('/v9/projects')) {
        const until = new URL(path, 'https://api.vercel.com').searchParams.get('until');
        const page = options.projectPages?.[until ?? 'first'];
        if (page) return page;
        return { projects: options.projects } satisfies VercelProjectsResponse;
      }
      if (path.startsWith('/v1/security/firewall/config/active')) {
        const projectId =
          new URL(path, 'https://api.vercel.com').searchParams.get('projectId') ?? '';
        return options.firewall(projectId);
      }
      throw new Error(`Unexpected fetch: ${path}`);
    },
  });
  return firewallCheck.run(recorded.ctx).then(() => recorded);
}

describe('firewallCheck', () => {
  it('passes projects with the firewall on and records the rule composition', async () => {
    const recorded = await run({
      projects: [makeProject('prj_a', 'alpha')],
      firewall: () => enabledConfig,
    });

    const result = findByResourceId(recorded.passes, 'prj_a');
    expect(result?.title).toBe('Firewall enabled: alpha');
    expect(result?.evidence).toMatchObject({
      firewallEnabled: true,
      activeManagedRules: ['owasp'],
      customRuleCount: 2,
      activeCustomRuleCount: 1,
      ipRuleCount: 1,
      botIdEnabled: true,
    });
    expect(recorded.fails).toHaveLength(0);
  });

  it('fails projects with the firewall off', async () => {
    const recorded = await run({
      projects: [makeProject('prj_a', 'alpha')],
      firewall: () => ({ ...enabledConfig, firewallEnabled: false }),
    });

    const finding = findByResourceId(recorded.fails, 'prj_a');
    expect(finding?.severity).toBe('high');
    expect(finding?.remediation).toContain('alpha > Firewall');
    expect(findByResourceId(recorded.passes, 'firewall')?.evidence).toMatchObject({
      firewallEnabledCount: 0,
      checkedProjects: 1,
    });
  });

  it('reads the wrapped { active } response shape', async () => {
    const recorded = await run({
      projects: [makeProject('prj_a')],
      firewall: () => ({ active: enabledConfig, draft: {}, versions: [] }),
    });

    expect(findByResourceId(recorded.passes, 'prj_a')?.title).toContain('Firewall enabled');
  });

  it('reports unknown status rather than a pass when the read is denied', async () => {
    const recorded = await run({
      projects: [makeProject('prj_a', 'alpha')],
      firewall: () => {
        throw httpError(403);
      },
    });

    const finding = findByResourceId(recorded.fails, 'prj_a');
    expect(finding?.title).toBe('Firewall status unknown: alpha');
    expect(finding?.severity).toBe('medium');
    expect(finding?.remediation).toContain('Web Application Firewall');
  });

  it('reports unknown status when the response carries no firewall flag', async () => {
    const recorded = await run({
      projects: [makeProject('prj_a')],
      firewall: () => ({ unrelated: true }),
    });

    expect(findByResourceId(recorded.fails, 'prj_a')?.title).toContain('status unknown');
  });

  it('honours the project filter', async () => {
    const recorded = await run({
      projects: [makeProject('prj_a'), makeProject('prj_b'), makeProject('prj_c')],
      firewall: () => enabledConfig,
      variables: { project_filter_mode: 'include', filtered_projects: ['prj_b'] },
    });

    expect(
      recorded.passes.filter((r) => r.resourceType === 'project').map((r) => r.resourceId),
    ).toEqual(['prj_b']);
  });

  it('follows the projects cursor', async () => {
    const recorded = await run({
      projects: [],
      projectPages: {
        first: {
          projects: [makeProject('prj_a')],
          pagination: { count: 1, next: 500, prev: null },
        },
        '500': {
          projects: [makeProject('prj_b')],
          pagination: { count: 1, next: null, prev: null },
        },
      },
      firewall: () => enabledConfig,
    });

    expect(
      recorded.passes
        .filter((r) => r.resourceType === 'project')
        .map((r) => r.resourceId)
        .sort(),
    ).toEqual(['prj_a', 'prj_b']);
  });

  it('surfaces a finding instead of silently truncating a large project set', async () => {
    const projects = Array.from({ length: 55 }, (_, index) => makeProject(`prj_${index}`));
    const recorded = await run({ projects, firewall: () => enabledConfig });

    const truncation = findByResourceId(recorded.fails, 'firewall-coverage');
    expect(truncation?.severity).toBe('low');
    expect(truncation?.evidence).toMatchObject({
      checkedProjectCount: 50,
      scopedProjectCount: 55,
    });
    expect(recorded.passes.filter((r) => r.resourceType === 'project')).toHaveLength(50);
  });
});

describe('firewallCheck endpoint fallback', () => {
  it('retries the bare config path when the versioned path 404s', async () => {
    const recorded = makeCheckContext({
      teamId: TEAM_ID,
      handle: (path) => {
        if (path.startsWith('/v9/projects')) {
          return { projects: [makeProject('prj_a')] } satisfies VercelProjectsResponse;
        }
        if (path.startsWith('/v1/security/firewall/config/active')) {
          throw httpError(404, 'Not Found');
        }
        if (path.startsWith('/v1/security/firewall/config?')) {
          return { active: enabledConfig };
        }
        throw new Error(`Unexpected fetch: ${path}`);
      },
    });

    await firewallCheck.run(recorded.ctx);

    expect(findByResourceId(recorded.passes, 'prj_a')?.title).toContain('Firewall enabled');
    expect(recorded.fails).toHaveLength(0);
  });

  it('does not retry on a permission error', async () => {
    const recorded = makeCheckContext({
      teamId: TEAM_ID,
      handle: (path) => {
        if (path.startsWith('/v9/projects')) {
          return { projects: [makeProject('prj_a')] } satisfies VercelProjectsResponse;
        }
        throw httpError(403);
      },
    });

    await firewallCheck.run(recorded.ctx);

    expect(recorded.requests.filter((path) => path.includes('firewall'))).toHaveLength(1);
    expect(findByResourceId(recorded.fails, 'prj_a')?.title).toContain('status unknown');
  });
});
