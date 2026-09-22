import { describe, expect, it } from 'bun:test';
import type { CheckVariableValues } from '../../../../types';
import type {
  VercelCustomEnvironment,
  VercelProject,
  VercelProjectEnvVar,
  VercelProjectsResponse,
} from '../../types';
import { environmentSeparationCheck } from '../environment-separation';
import { findByResourceId, httpError, makeCheckContext } from './harness';

const TEAM_ID = 'team_1';

const makeProject = (
  id: string,
  name = id,
  overrides: Partial<VercelProject> = {},
): VercelProject =>
  ({
    id,
    name,
    accountId: 'acc_1',
    createdAt: 0,
    updatedAt: 0,
    // Explicitly off unless a test says otherwise, so the protection aspect is
    // the thing under test rather than the extra read for an absent field.
    ssoProtection: null,
    passwordProtection: null,
    trustedIps: null,
    ...overrides,
  }) satisfies VercelProject;

const secret = (key: string, target: string[], extra: Partial<VercelProjectEnvVar> = {}) =>
  ({ id: key, key, type: 'encrypted', target, ...extra }) satisfies VercelProjectEnvVar;

function run(options: {
  projects: VercelProject[];
  envVars?: (projectId: string) => unknown;
  customEnvironments?: (projectId: string) => unknown;
  project?: (projectId: string) => unknown;
  variables?: CheckVariableValues;
}) {
  const recorded = makeCheckContext({
    teamId: TEAM_ID,
    variables: options.variables,
    handle: (path) => {
      if (path.startsWith('/v9/projects?')) {
        return { projects: options.projects } satisfies VercelProjectsResponse;
      }
      const envMatch = path.match(/^\/v10\/projects\/([^/?]+)\/env/);
      if (envMatch) {
        const envs = options.envVars?.(envMatch[1]) ?? [];
        return Array.isArray(envs) ? { envs } : envs;
      }
      const customMatch = path.match(/^\/v9\/projects\/([^/?]+)\/custom-environments/);
      if (customMatch) {
        const environments = options.customEnvironments?.(customMatch[1]) ?? [];
        return Array.isArray(environments) ? { environments } : environments;
      }
      const projectMatch = path.match(/^\/v9\/projects\/([^/?]+)(\?|$)/);
      if (projectMatch) {
        // The check ALWAYS reads the detail, because `/v9/projects` can return a
        // trimmed projection missing `link` and the protection fields. Default
        // to echoing the listed project so tests exercise that real path.
        if (options.project) return options.project(projectMatch[1]);
        return options.projects.find((candidate) => candidate.id === projectMatch[1]);
      }
      throw new Error(`Unexpected fetch: ${path}`);
    },
  });
  return environmentSeparationCheck.run(recorded.ctx).then(() => recorded);
}

describe('environmentSeparationCheck', () => {
  it('passes a project whose secrets are scoped to one side of the boundary', async () => {
    const recorded = await run({
      projects: [makeProject('prj_a', 'alpha', { ssoProtection: { deploymentType: 'preview' } })],
      envVars: () => [
        secret('DATABASE_URL', ['production']),
        secret('DATABASE_URL_PREVIEW', ['preview', 'development']),
        { id: 'sys', key: 'VERCEL_URL', type: 'system', target: ['production', 'preview'] },
      ],
    });

    const result = findByResourceId(recorded.passes, 'prj_a');
    expect(result?.title).toBe('Environments separated: alpha');
    expect(result?.evidence).toMatchObject({
      productionOnlySecretCount: 1,
      nonProductionOnlySecretCount: 1,
      sharedSecretCount: 0,
      variableCount: 2,
    });
    expect(recorded.fails).toHaveLength(0);
  });

  it('fails a project that shares a production secret with preview', async () => {
    const recorded = await run({
      projects: [makeProject('prj_a', 'alpha', { ssoProtection: { deploymentType: 'preview' } })],
      envVars: () => [secret('DATABASE_URL', ['production', 'preview', 'development'])],
    });

    const finding = findByResourceId(recorded.fails, 'prj_a');
    expect(finding?.title).toBe('Production secrets reach non-production: alpha');
    expect(finding?.severity).toBe('high');
    expect(finding?.description).toContain('DATABASE_URL');
    expect(finding?.evidence).toMatchObject({
      sharedSecretCount: 1,
      sharedSecretKeys: ['DATABASE_URL'],
    });
  });

  it('ignores plain configuration shared across the boundary', async () => {
    const recorded = await run({
      projects: [makeProject('prj_a', 'alpha', { ssoProtection: { deploymentType: 'preview' } })],
      envVars: () => [
        { id: 'v1', key: 'NEXT_PUBLIC_APP_NAME', type: 'plain', target: ['production', 'preview'] },
      ],
    });

    expect(findByResourceId(recorded.passes, 'prj_a')?.evidence).toMatchObject({
      sharedSecretCount: 0,
      sharedPlainVariableCount: 1,
    });
    expect(recorded.fails).toHaveLength(0);
  });

  it('treats a secret shared with a custom environment as crossing the boundary', async () => {
    const customEnvironments: VercelCustomEnvironment[] = [
      { id: 'env_staging', slug: 'staging', type: 'preview' },
    ];
    const recorded = await run({
      projects: [makeProject('prj_a', 'alpha', { ssoProtection: { deploymentType: 'all' } })],
      customEnvironments: () => customEnvironments,
      envVars: () => [
        secret('STRIPE_KEY', ['production'], { customEnvironmentIds: ['env_staging'] }),
      ],
    });

    const finding = findByResourceId(recorded.fails, 'prj_a');
    expect(finding?.severity).toBe('high');
    expect(finding?.evidence).toMatchObject({ sharedSecretKeys: ['STRIPE_KEY'] });
    expect(
      (finding?.evidence as { environments: Array<{ environment: string }> }).environments,
    ).toContainEqual({
      environment: 'staging',
      type: 'preview',
      deploysFrom: 'branches assigned in Vercel',
    });
  });

  it('does not treat a production-typed custom environment as non-production', async () => {
    const recorded = await run({
      projects: [makeProject('prj_a', 'alpha', { ssoProtection: { deploymentType: 'all' } })],
      customEnvironments: () => [{ id: 'env_prod_eu', slug: 'prod-eu', type: 'production' }],
      envVars: () => [
        secret('DATABASE_URL', ['production'], { customEnvironmentIds: ['env_prod_eu'] }),
      ],
    });

    expect(findByResourceId(recorded.passes, 'prj_a')?.evidence).toMatchObject({
      sharedSecretCount: 0,
      productionOnlySecretCount: 1,
    });
  });

  it('fails when non-production deployments have no protection', async () => {
    const recorded = await run({
      projects: [makeProject('prj_a', 'alpha')],
      envVars: () => [secret('DATABASE_URL', ['production'])],
    });

    const finding = findByResourceId(recorded.fails, 'prj_a:preview-protection');
    expect(finding?.title).toBe('Non-production deployments are unrestricted: alpha');
    expect(finding?.severity).toBe('medium');
    expect(finding?.evidence).toMatchObject({
      previewDeploymentsProtected: false,
      protectionMethods: [],
    });
  });

  it('records protection on the project result without spending a second row', async () => {
    const recorded = await run({
      projects: [
        makeProject('prj_a', 'alpha', {
          passwordProtection: { enabled: true, deploymentType: 'preview' },
          trustedIps: {
            enabled: true,
            deploymentType: 'preview',
            addresses: [{ value: '1.2.3.4' }],
          },
        }),
      ],
      envVars: () => [],
    });

    expect(findByResourceId(recorded.passes, 'prj_a')?.evidence).toMatchObject({
      previewDeploymentsProtected: true,
      protectionMethods: ['Password Protection', 'Trusted IPs'],
    });
    // A passing access test adds no row: exceptions apply only to failures, so
    // one clean project is one row.
    expect(findByResourceId(recorded.passes, 'prj_a:preview-protection')).toBeUndefined();
    expect(recorded.fails).toHaveLength(0);
  });

  it('treats a disabled protection object as off, not as protection in force', async () => {
    // Vercel returns a configured-then-disabled method as an OBJECT carrying
    // `enabled: false`, so a truthiness check would report restricted access on
    // a project anyone with the preview URL can reach.
    const recorded = await run({
      projects: [
        makeProject('prj_a', 'alpha', {
          passwordProtection: { enabled: false, deploymentType: null },
          trustedIps: { enabled: false, deploymentType: null, addresses: [] },
          ssoProtection: { enabled: false, deploymentType: null },
        }),
      ],
      envVars: () => [],
    });

    const finding = findByResourceId(recorded.fails, 'prj_a:preview-protection');
    expect(finding?.title).toBe('Non-production deployments are unrestricted: alpha');
    expect(finding?.evidence).toMatchObject({
      previewDeploymentsProtected: false,
      protectionMethods: [],
      passwordDeploymentType: null,
      trustedIpsDeploymentType: null,
    });
  });

  it('reports the production branch and each environment’s branch rule', async () => {
    const recorded = await run({
      projects: [
        makeProject('prj_a', 'alpha', {
          ssoProtection: { enabled: true, deploymentType: 'all' },
          link: { type: 'github', org: 'next-degree', repo: 'alpha', productionBranch: 'main' },
        }),
      ],
      customEnvironments: () => [
        {
          id: 'env_staging',
          slug: 'staging',
          type: 'preview',
          branchMatcher: { type: 'startsWith', pattern: 'release/' },
        },
      ],
      envVars: () => [],
    });

    expect(findByResourceId(recorded.passes, 'prj_a')?.evidence).toMatchObject({
      productionBranch: 'main',
      repository: 'next-degree/alpha',
      environments: [
        { environment: 'production', type: 'production', deploysFrom: 'branch main' },
        {
          environment: 'staging',
          type: 'preview',
          deploysFrom: 'branches starting with release/',
        },
        { environment: 'preview', type: 'preview', deploysFrom: 'every other branch' },
        {
          environment: 'development',
          type: 'development',
          deploysFrom: 'local development only',
        },
      ],
    });
  });

  it('records the production branch as unknown rather than guessing it', async () => {
    const recorded = await run({
      projects: [makeProject('prj_a', 'alpha', { ssoProtection: { enabled: true } })],
      envVars: () => [],
    });

    const evidence = findByResourceId(recorded.passes, 'prj_a')?.evidence as {
      productionBranch: string | null;
      repository: string | null;
    };
    expect(evidence.productionBranch).toBeNull();
    expect(evidence.repository).toBeNull();
  });

  it('carries a one-row-per-project topology table on the summary', async () => {
    const recorded = await run({
      projects: [
        makeProject('prj_a', 'alpha', {
          ssoProtection: { enabled: true, deploymentType: 'all' },
          link: { type: 'github', org: 'next-degree', repo: 'alpha', productionBranch: 'main' },
        }),
      ],
      customEnvironments: () => [
        {
          id: 'env_staging',
          slug: 'staging',
          type: 'preview',
          branchMatcher: { type: 'startsWith', pattern: 'release/' },
        },
      ],
      envVars: () => [],
    });

    expect(findByResourceId(recorded.passes, 'environment-separation')?.evidence).toMatchObject({
      environmentTopology: [
        {
          project: 'alpha',
          repository: 'next-degree/alpha',
          productionBranch: 'main',
          nonProductionEnvironments: [
            'staging (branches starting with release/)',
            'preview (every other branch)',
            'development (local development only)',
          ],
          nonProductionAccess: 'Vercel Authentication',
          sharedSecretCount: 0,
        },
      ],
    });
  });

  it('reads the project detail for fields the listing omits', async () => {
    // `/v9/projects` can return a trimmed projection with neither `link` nor
    // the protection fields, so the detail read is what supplies both.
    const listed = makeProject('prj_a', 'alpha');
    delete listed.ssoProtection;
    delete listed.passwordProtection;
    delete listed.trustedIps;

    const recorded = await run({
      projects: [listed],
      envVars: () => [],
      project: (id) =>
        makeProject(id, 'alpha', {
          ssoProtection: { enabled: true, deploymentType: 'all' },
          link: { type: 'github', org: 'next-degree', repo: 'alpha', productionBranch: 'main' },
        }),
    });

    expect(recorded.requests.some((path) => path.startsWith('/v9/projects/prj_a?'))).toBe(true);
    expect(findByResourceId(recorded.passes, 'prj_a')?.evidence).toMatchObject({
      previewDeploymentsProtected: true,
      ssoDeploymentType: 'all',
      productionBranch: 'main',
    });
    expect(recorded.fails).toHaveLength(0);
  });

  it('reports unknown access rather than unrestricted when the detail read fails', async () => {
    const listed = makeProject('prj_a', 'alpha');
    delete listed.ssoProtection;
    delete listed.passwordProtection;
    delete listed.trustedIps;

    const recorded = await run({
      projects: [listed],
      envVars: () => [],
      project: () => {
        throw httpError(403, 'Forbidden');
      },
    });

    const finding = findByResourceId(recorded.fails, 'prj_a:preview-protection');
    expect(finding?.title).toBe('Non-production access unknown: alpha');
    expect(finding?.severity).toBe('medium');
    // Never asserted as unprotected — that would send someone to fix a setting
    // that may already be in place.
    expect(finding?.description).not.toContain('anyone with a preview URL');
    expect(
      (
        findByResourceId(recorded.passes, 'prj_a')?.evidence as {
          previewDeploymentsProtected: boolean | null;
        }
      ).previewDeploymentsProtected,
    ).toBeNull();
  });

  it('falls back to the listed protection when only the detail read fails', async () => {
    const recorded = await run({
      projects: [makeProject('prj_a', 'alpha', { ssoProtection: { enabled: true } })],
      envVars: () => [],
      project: () => {
        throw httpError(500, 'Server Error');
      },
    });

    expect(findByResourceId(recorded.passes, 'prj_a')?.evidence).toMatchObject({
      previewDeploymentsProtected: true,
    });
    expect(recorded.fails).toHaveLength(0);
  });

  it('reports an unreadable environment variable list rather than passing it', async () => {
    const recorded = await run({
      projects: [makeProject('prj_a', 'alpha')],
      envVars: () => {
        throw httpError(403, 'Forbidden');
      },
    });

    const finding = findByResourceId(recorded.fails, 'prj_a');
    expect(finding?.title).toBe('Environment separation unknown: alpha');
    expect(finding?.severity).toBe('medium');
    expect(finding?.evidence).toMatchObject({ denied: true });
    expect(findByResourceId(recorded.passes, 'prj_a')).toBeUndefined();
  });

  it('still evaluates a project whose custom environments cannot be read', async () => {
    const recorded = await run({
      projects: [makeProject('prj_a', 'alpha', { ssoProtection: { deploymentType: 'all' } })],
      customEnvironments: () => {
        throw httpError(404, 'Not Found');
      },
      envVars: () => [secret('DATABASE_URL', ['production'])],
    });

    const result = findByResourceId(recorded.passes, 'prj_a');
    expect(result?.title).toBe('Environments separated: alpha');
    expect(result?.evidence).toMatchObject({ productionOnlySecretCount: 1 });
    expect(
      String((result?.evidence as { customEnvironmentsError?: string }).customEnvironmentsError),
    ).toContain('404');
  });

  it('summarizes the run across projects', async () => {
    const recorded = await run({
      projects: [
        makeProject('prj_a', 'alpha', { ssoProtection: { deploymentType: 'all' } }),
        makeProject('prj_b', 'beta'),
      ],
      envVars: (projectId) =>
        projectId === 'prj_b'
          ? [secret('DATABASE_URL', ['production', 'preview'])]
          : [secret('DATABASE_URL', ['production'])],
    });

    expect(findByResourceId(recorded.passes, 'environment-separation')?.evidence).toMatchObject({
      checkedProjects: 2,
      separatedProjectCount: 1,
      protectedNonProductionCount: 1,
      teamId: TEAM_ID,
    });
  });

  it('honors the project filter', async () => {
    const recorded = await run({
      projects: [makeProject('prj_a', 'alpha'), makeProject('prj_b', 'beta')],
      envVars: () => [],
      variables: { project_filter_mode: 'include', filtered_projects: ['prj_a'] },
    });

    expect(findByResourceId(recorded.passes, 'environment-separation')?.evidence).toMatchObject({
      checkedProjects: 1,
      scopedProjects: 1,
      totalProjects: 2,
    });
    expect(findByResourceId(recorded.passes, 'prj_b')).toBeUndefined();
  });
});
