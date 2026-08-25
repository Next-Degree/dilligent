import { describe, expect, it } from 'bun:test';
import type { GitHubRepo, GitHubRuleset, GitHubRulesetBypassActor } from '../../types';
import { adminEnforcementCheck } from '../admin-enforcement';
import { runGithubCheck } from './harness';

interface RulesetFixture {
  id: number;
  name: string;
  enforcement?: GitHubRuleset['enforcement'];
  include?: string[];
  bypassActors?: GitHubRulesetBypassActor[];
}

interface RepoFixture {
  rulesets?: RulesetFixture[];
  /** undefined = endpoint 404s (no classic protection) */
  legacyEnforceAdmins?: boolean;
  defaultBranch?: string;
}

const makeRepo = (defaultBranch: string): GitHubRepo =>
  ({
    id: 1,
    name: 'api',
    full_name: 'acme/api',
    private: true,
    html_url: 'https://github.com/acme/api',
    default_branch: defaultBranch,
    owner: { login: 'acme', type: 'Organization' },
  }) as GitHubRepo;

const toRuleset = (fixture: RulesetFixture): GitHubRuleset => ({
  id: fixture.id,
  name: fixture.name,
  target: 'branch',
  source_type: 'Repository',
  source: 'acme/api',
  enforcement: fixture.enforcement ?? 'active',
  conditions: fixture.include ? { ref_name: { include: fixture.include } } : undefined,
  rules: [{ type: 'pull_request' }],
});

async function run(fixture: RepoFixture, variables: Record<string, unknown> = {}) {
  const rulesets = fixture.rulesets ?? [];
  return runGithubCheck(adminEnforcementCheck, {
    variables: { target_repos: ['acme/api:main'], ...variables },
    fetch: async (path: string) => {
      if (path === '/repos/acme/api') return makeRepo(fixture.defaultBranch ?? 'main');
      if (path === '/repos/acme/api/rulesets') return rulesets.map(toRuleset);

      const singleMatch = path.match(/^\/repos\/acme\/api\/rulesets\/(\d+)$/);
      if (singleMatch) {
        const found = rulesets.find((r) => r.id === Number(singleMatch[1]));
        if (!found) throw new Error('404 Not Found');
        return { ...toRuleset(found), bypass_actors: found.bypassActors ?? [] };
      }

      if (path.startsWith('/repos/acme/api/branches/')) {
        if (fixture.legacyEnforceAdmins === undefined) throw new Error('404 Not Found');
        return { enforce_admins: { enabled: fixture.legacyEnforceAdmins } };
      }
      throw new Error(`Unexpected path: ${path}`);
    },
  });
}

describe('adminEnforcementCheck', () => {
  it('passes when an active ruleset covers the branch with an empty bypass list', async () => {
    const { passed, failed } = await run({
      rulesets: [{ id: 1, name: 'main protection', include: ['refs/heads/main'] }],
    });

    expect(failed).toEqual([]);
    expect(passed).toHaveLength(1);
    expect(passed[0]?.resourceId).toBe('acme/api:main');
  });

  it('fails when a ruleset grants organization admins a bypass', async () => {
    const { passed, failed } = await run({
      rulesets: [
        {
          id: 1,
          name: 'main protection',
          include: ['refs/heads/main'],
          bypassActors: [{ actor_type: 'OrganizationAdmin', bypass_mode: 'always' }],
        },
      ],
    });

    expect(passed).toEqual([]);
    expect(failed).toHaveLength(1);
    expect(failed[0]?.severity).toBe('high');
    expect(failed[0]?.description).toContain('OrganizationAdmin (always)');
  });

  it('treats a pull_request-mode bypass as a gap too', async () => {
    const { failed } = await run({
      rulesets: [
        {
          id: 1,
          name: 'main protection',
          include: ['refs/heads/main'],
          bypassActors: [{ actor_type: 'RepositoryRole', bypass_mode: 'pull_request' }],
        },
      ],
    });

    expect(failed).toHaveLength(1);
    expect(failed[0]?.description).toContain('RepositoryRole (pull_request)');
  });

  it('resolves rulesets that target the ~DEFAULT_BRANCH alias', async () => {
    const { failed } = await run({
      defaultBranch: 'main',
      rulesets: [
        {
          id: 1,
          name: 'default branch',
          include: ['~DEFAULT_BRANCH'],
          bypassActors: [{ actor_type: 'OrganizationAdmin', bypass_mode: 'always' }],
        },
      ],
    });

    expect(failed).toHaveLength(1);
    expect(failed[0]?.description).toContain('"default branch"');
  });

  it('ignores rulesets that do not cover the branch', async () => {
    const { passed, failed } = await run({
      legacyEnforceAdmins: true,
      rulesets: [
        {
          id: 1,
          name: 'release only',
          include: ['refs/heads/release'],
          bypassActors: [{ actor_type: 'OrganizationAdmin', bypass_mode: 'always' }],
        },
      ],
    });

    expect(failed).toEqual([]);
    expect(passed).toHaveLength(1);
  });

  it('ignores rulesets that are not actively enforced', async () => {
    const { passed, failed } = await run({
      legacyEnforceAdmins: true,
      rulesets: [
        {
          id: 1,
          name: 'evaluate only',
          enforcement: 'evaluate',
          include: ['refs/heads/main'],
          bypassActors: [{ actor_type: 'OrganizationAdmin' }],
        },
      ],
    });

    expect(failed).toEqual([]);
    expect(passed).toHaveLength(1);
  });

  it('fails when legacy protection does not apply to administrators', async () => {
    const { failed } = await run({ legacyEnforceAdmins: false });

    expect(failed).toHaveLength(1);
    expect(failed[0]?.description).toContain(
      'legacy branch protection does not apply to administrators',
    );
  });

  it('passes on legacy protection with enforce_admins enabled', async () => {
    const { passed, failed } = await run({ legacyEnforceAdmins: true });

    expect(failed).toEqual([]);
    expect(passed[0]?.description).toContain('legacy protection includes administrators');
  });

  it('fails when the branch has no protection to enforce at all', async () => {
    const { failed } = await run({});

    expect(failed).toHaveLength(1);
    expect(failed[0]?.title).toBe('No branch protection to enforce on acme/api');
    expect(failed[0]?.severity).toBe('high');
  });

  it('reports an inaccessible repository instead of throwing', async () => {
    const { failed } = await runGithubCheck(adminEnforcementCheck, {
      variables: { target_repos: ['acme/missing:main'] },
      fetch: async () => {
        throw new Error('404 Not Found');
      },
    });

    expect(failed).toHaveLength(1);
    expect(failed[0]?.title).toBe('Repository not found: acme/missing');
  });

  it('fails with a configuration finding when no repositories are selected', async () => {
    const { failed } = await runGithubCheck(adminEnforcementCheck, {
      variables: { target_repos: [] },
    });

    expect(failed[0]?.title).toBe('No repositories configured');
    expect(failed[0]?.severity).toBe('low');
  });
});
