import { describe, expect, it } from 'bun:test';
import type { VercelFirewallConfig, VercelProject, VercelProjectsResponse } from '../../types';
import { trafficFilterCheck } from '../traffic-filter';
import { findByResourceId, httpError, makeCheckContext } from './harness';

const TEAM_ID = 'team_1';

const makeProject = (id: string, name = id): VercelProject => ({
  id,
  name,
  accountId: 'acc_1',
  createdAt: 0,
  updatedAt: 0,
});

const bareEnabledConfig: VercelFirewallConfig = {
  version: 3,
  firewallEnabled: true,
  botIdEnabled: false,
  rules: [],
  ips: [],
  managedRules: { owasp: { active: false } },
};

function run(options: { projects: VercelProject[]; firewall: (projectId: string) => unknown }) {
  const recorded = makeCheckContext({
    teamId: TEAM_ID,
    handle: (path) => {
      if (path.startsWith('/v9/projects')) {
        return { projects: options.projects } satisfies VercelProjectsResponse;
      }
      if (path.startsWith('/v1/security/firewall/config')) {
        const projectId =
          new URL(path, 'https://api.vercel.com').searchParams.get('projectId') ?? '';
        return options.firewall(projectId);
      }
      throw new Error(`Unexpected fetch: ${path}`);
    },
  });
  return trafficFilterCheck.run(recorded.ctx).then(() => recorded);
}

describe('trafficFilterCheck', () => {
  it('passes a project with a managed ruleset active', async () => {
    const recorded = await run({
      projects: [makeProject('prj_a', 'alpha')],
      firewall: () => ({ ...bareEnabledConfig, managedRules: { owasp: { active: true } } }),
    });

    const pass = findByResourceId(recorded.passes, 'prj_a');
    expect(pass?.title).toBe('Unwanted traffic filtered: alpha');
    expect(pass?.description).toContain('managed rulesets (owasp)');
    expect(recorded.fails).toHaveLength(0);
  });

  it('counts bot filtering, custom rules and IP deny rules as filters', async () => {
    const recorded = await run({
      projects: [makeProject('prj_bot'), makeProject('prj_rule'), makeProject('prj_ip')],
      firewall: (projectId) => {
        if (projectId === 'prj_bot') return { ...bareEnabledConfig, botIdEnabled: true };
        if (projectId === 'prj_rule') {
          return { ...bareEnabledConfig, rules: [{ id: 'r1', active: true }] };
        }
        return { ...bareEnabledConfig, ips: [{ id: 'ip1', ip: '1.2.3.4', action: 'deny' }] };
      },
    });

    expect(
      recorded.passes
        .filter((result) => result.resourceType === 'project')
        .map((r) => r.resourceId),
    ).toEqual(['prj_bot', 'prj_rule', 'prj_ip']);
  });

  it('fails a project whose firewall is on but filters nothing', async () => {
    const recorded = await run({
      projects: [makeProject('prj_a', 'alpha')],
      firewall: () => bareEnabledConfig,
    });

    const finding = findByResourceId(recorded.fails, 'prj_a');
    expect(finding?.title).toBe('Firewall enabled but nothing is filtered: alpha');
    expect(finding?.severity).toBe('medium');
    expect(finding?.evidence).toMatchObject({ activeFilters: [] });
  });

  it('does not count an allow-only IP rule as a filter', async () => {
    const recorded = await run({
      projects: [makeProject('prj_a')],
      firewall: () => ({
        ...bareEnabledConfig,
        ips: [{ id: 'ip1', ip: '1.2.3.4', action: 'bypass' }],
      }),
    });

    expect(findByResourceId(recorded.fails, 'prj_a')?.title).toContain('nothing is filtered');
  });

  it('fails hard when the firewall is off', async () => {
    const recorded = await run({
      projects: [makeProject('prj_a', 'alpha')],
      firewall: () => ({ ...bareEnabledConfig, firewallEnabled: false }),
    });

    const finding = findByResourceId(recorded.fails, 'prj_a');
    expect(finding?.title).toBe('No traffic filtering: alpha');
    expect(finding?.severity).toBe('high');
  });

  it('reports unknown rather than a pass when the firewall read is denied', async () => {
    const recorded = await run({
      projects: [makeProject('prj_a', 'alpha')],
      firewall: () => {
        throw httpError(403);
      },
    });

    const finding = findByResourceId(recorded.fails, 'prj_a');
    expect(finding?.title).toBe('Traffic filtering unknown: alpha');
    expect(finding?.severity).toBe('medium');
  });

  it('reports unknown when the response carries no firewall flag', async () => {
    const recorded = await run({
      projects: [makeProject('prj_a')],
      firewall: () => ({ unrelated: true }),
    });

    expect(findByResourceId(recorded.fails, 'prj_a')?.title).toContain('unknown');
  });

  it('surfaces a finding instead of silently truncating a large project set', async () => {
    const projects = Array.from({ length: 55 }, (_, index) => makeProject(`prj_${index}`));
    const recorded = await run({
      projects,
      firewall: () => ({ ...bareEnabledConfig, botIdEnabled: true }),
    });

    const truncation = findByResourceId(recorded.fails, 'traffic-filter-coverage');
    expect(truncation?.severity).toBe('low');
    expect(truncation?.description).toContain('traffic filtering');
    expect(truncation?.evidence).toMatchObject({ checkedProjectCount: 50, scopedProjectCount: 55 });
  });

  it('summarises how many projects filter traffic', async () => {
    const recorded = await run({
      projects: [makeProject('prj_a'), makeProject('prj_b')],
      firewall: (projectId) =>
        projectId === 'prj_a' ? { ...bareEnabledConfig, botIdEnabled: true } : bareEnabledConfig,
    });

    expect(findByResourceId(recorded.passes, 'traffic-filter')?.evidence).toMatchObject({
      checkedProjects: 2,
      filteringProjectCount: 1,
    });
  });
});
