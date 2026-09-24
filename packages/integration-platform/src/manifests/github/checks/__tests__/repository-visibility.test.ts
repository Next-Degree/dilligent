import { describe, expect, it } from 'bun:test';
import type { GitHubRepo } from '../../types';
import { repositoryVisibilityCheck } from '../repository-visibility';
import { runGithubCheck } from './harness';

interface RepoFixture {
  fullName: string;
  private: boolean;
  visibility?: GitHubRepo['visibility'];
}

const makeRepo = (fixture: RepoFixture): GitHubRepo =>
  ({
    id: 1,
    name: fixture.fullName.split('/')[1],
    full_name: fixture.fullName,
    private: fixture.private,
    visibility: fixture.visibility,
    html_url: `https://github.com/${fixture.fullName}`,
    default_branch: 'main',
    owner: { login: fixture.fullName.split('/')[0], type: 'Organization' },
  }) as GitHubRepo;

async function run(repos: RepoFixture[], variables: Record<string, unknown> = {}) {
  const byName = new Map(repos.map((repo) => [repo.fullName, repo]));
  return runGithubCheck(repositoryVisibilityCheck, {
    variables: {
      target_repos: repos.map((repo) => `${repo.fullName}:main`),
      ...variables,
    },
    fetch: async (path: string) => {
      const match = path.match(/^\/repos\/(.+)$/);
      const fixture = match ? byName.get(match[1] ?? '') : undefined;
      if (!fixture) throw new Error('404 Not Found');
      return makeRepo(fixture);
    },
  });
}

describe('repositoryVisibilityCheck', () => {
  it('passes a private repository', async () => {
    const { passed, failed } = await run([
      { fullName: 'acme/api', private: true, visibility: 'private' },
    ]);

    expect(failed).toEqual([]);
    expect(passed).toHaveLength(1);
    expect(passed[0]?.title).toBe('api is not publicly visible');
  });

  it('passes an enterprise-internal repository', async () => {
    const { passed, failed } = await run([
      { fullName: 'acme/internal', private: true, visibility: 'internal' },
    ]);

    expect(failed).toEqual([]);
    expect(passed[0]?.description).toContain('"internal"');
  });

  it('fails a public repository', async () => {
    const { passed, failed } = await run([
      { fullName: 'acme/leaky', private: false, visibility: 'public' },
    ]);

    expect(passed).toEqual([]);
    expect(failed).toHaveLength(1);
    expect(failed[0]?.severity).toBe('high');
    expect(failed[0]?.title).toBe('leaky is publicly visible');
  });

  it('passes a public repository that is on the approved list', async () => {
    const { passed, failed } = await run(
      [{ fullName: 'acme/docs', private: false, visibility: 'public' }],
      { approved_public_repos: 'acme/docs, acme/sdk' },
    );

    expect(failed).toEqual([]);
    expect(passed[0]?.title).toBe('docs is public by approval');
  });

  it('matches the approved list case-insensitively', async () => {
    const { failed } = await run(
      [{ fullName: 'Acme/Docs', private: false, visibility: 'public' }],
      { approved_public_repos: 'acme/docs' },
    );

    expect(failed).toEqual([]);
  });

  it('does not let an approved entry excuse a different repository', async () => {
    const { failed } = await run(
      [{ fullName: 'acme/secret', private: false, visibility: 'public' }],
      { approved_public_repos: 'acme/docs' },
    );

    expect(failed).toHaveLength(1);
    expect(failed[0]?.title).toBe('secret is publicly visible');
  });

  it('infers visibility when GitHub omits the field', async () => {
    const { failed } = await run([{ fullName: 'acme/old', private: false }]);

    expect(failed[0]?.description).toContain('"public"');
  });

  it('reports an inaccessible repository instead of throwing', async () => {
    const { failed } = await runGithubCheck(repositoryVisibilityCheck, {
      variables: { target_repos: ['acme/missing:main'] },
      fetch: async () => {
        throw new Error('404 Not Found');
      },
    });

    expect(failed).toHaveLength(1);
    expect(failed[0]?.title).toBe('Repository not found: acme/missing');
    expect(failed[0]?.severity).toBe('medium');
  });

  it('deduplicates repositories listed under several branches', async () => {
    const { passed } = await runGithubCheck(repositoryVisibilityCheck, {
      variables: { target_repos: ['acme/api:main', 'acme/api:develop'] },
      fetch: async () => makeRepo({ fullName: 'acme/api', private: true }),
    });

    expect(passed).toHaveLength(1);
  });

  it('fails with a configuration finding when no repositories are selected', async () => {
    const { failed } = await runGithubCheck(repositoryVisibilityCheck, {
      variables: { target_repos: [] },
    });

    expect(failed[0]?.title).toBe('No repositories selected');
    expect(failed[0]?.severity).toBe('low');
  });
});
