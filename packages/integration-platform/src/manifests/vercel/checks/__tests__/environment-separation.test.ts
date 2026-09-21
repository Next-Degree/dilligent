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
        if (!options.project) throw new Error(`Unexpected project read: ${path}`);
        return options.project(projectMatch[1]);
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
    expect(finding?.evidence).toMatchObject({
      sharedSecretKeys: ['STRIPE_KEY'],
      customEnvironments: [{ slug: 'staging', type: 'preview' }],
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

  it('passes protection when password protection or trusted IPs are in force', async () => {
    const recorded = await run({
      projects: [
        makeProject('prj_a', 'alpha', {
          passwordProtection: { deploymentType: 'preview' },
          trustedIps: { deploymentType: 'preview', addresses: [{ value: '1.2.3.4' }] },
        }),
      ],
      envVars: () => [],
    });

    const result = findByResourceId(recorded.passes, 'prj_a:preview-protection');
    expect(result?.evidence).toMatchObject({
      previewDeploymentsProtected: true,
      protectionMethods: ['Password Protection', 'Trusted IPs'],
    });
  });

  it('re-reads the project when the list omits the protection fields', async () => {
    const listed = makeProject('prj_a', 'alpha');
    delete listed.ssoProtection;
    delete listed.passwordProtection;
    delete listed.trustedIps;

    const recorded = await run({
      projects: [listed],
      envVars: () => [],
      project: (id) => makeProject(id, 'alpha', { ssoProtection: { deploymentType: 'all' } }),
    });

    expect(recorded.requests.some((path) => path.startsWith('/v9/projects/prj_a?'))).toBe(true);
    expect(findByResourceId(recorded.passes, 'prj_a:preview-protection')?.evidence).toMatchObject({
      previewDeploymentsProtected: true,
      ssoDeploymentType: 'all',
    });
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
