import { describe, expect, it } from 'bun:test';
import type { GitHubPullRequest, GitHubPullRequestReview } from '../../types';
import { prAuthorNotReviewerCheck } from '../pr-author-not-reviewer';
import { runGithubCheck } from './harness';

interface PrFixture {
  number: number;
  author: string;
  mergedDaysAgo: number | null;
  approvals: string[];
}

const daysAgo = (days: number): string =>
  new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

const makePr = (fixture: PrFixture): GitHubPullRequest =>
  ({
    id: fixture.number,
    number: fixture.number,
    title: `PR ${fixture.number}`,
    state: 'closed',
    html_url: `https://github.com/acme/api/pull/${fixture.number}`,
    created_at: daysAgo(fixture.mergedDaysAgo ?? 1),
    updated_at: daysAgo(fixture.mergedDaysAgo ?? 1),
    closed_at: fixture.mergedDaysAgo === null ? null : daysAgo(fixture.mergedDaysAgo),
    merged_at: fixture.mergedDaysAgo === null ? null : daysAgo(fixture.mergedDaysAgo),
    user: { login: fixture.author },
    base: { ref: 'main' },
    head: { ref: 'feature' },
  }) as GitHubPullRequest;

const makeReviews = (approvals: string[]): GitHubPullRequestReview[] =>
  approvals.map((login, index) => ({
    id: index + 1,
    user: { login },
    state: 'APPROVED' as const,
    submitted_at: daysAgo(1),
    html_url: 'https://github.com/acme/api/pull/1#review',
  }));

async function run(prs: PrFixture[], variables: Record<string, unknown> = {}) {
  const byNumber = new Map(prs.map((pr) => [pr.number, pr]));
  return runGithubCheck(prAuthorNotReviewerCheck, {
    variables: { target_repos: ['acme/api:main'], ...variables },
    fetchAllPages: async (path: string) => {
      if (path.startsWith('/repos/acme/api/pulls?')) {
        return prs.map(makePr);
      }
      const reviewMatch = path.match(/^\/repos\/acme\/api\/pulls\/(\d+)\/reviews$/);
      if (reviewMatch) {
        const fixture = byNumber.get(Number(reviewMatch[1]));
        return makeReviews(fixture?.approvals ?? []);
      }
      throw new Error(`Unexpected path: ${path}`);
    },
  });
}

describe('prAuthorNotReviewerCheck', () => {
  it('passes when every merged PR was approved by someone other than the author', async () => {
    const { passed, failed } = await run([
      { number: 1, author: 'alice', mergedDaysAgo: 3, approvals: ['bob'] },
      { number: 2, author: 'bob', mergedDaysAgo: 5, approvals: ['alice', 'carol'] },
    ]);

    expect(failed).toEqual([]);
    expect(passed).toHaveLength(1);
    expect(passed[0]?.title).toBe('All merged pull requests independently reviewed on acme/api');
    expect(passed[0]?.resourceId).toBe('acme/api:main');
  });

  it('fails when a merged PR has no approving review at all', async () => {
    const { passed, failed } = await run([
      { number: 1, author: 'alice', mergedDaysAgo: 2, approvals: [] },
    ]);

    expect(passed).toEqual([]);
    expect(failed).toHaveLength(1);
    expect(failed[0]?.severity).toBe('high');
    expect(failed[0]?.description).toContain('#1 (by alice)');
  });

  it('treats an approval from the author as no independent review', async () => {
    const { failed } = await run([
      { number: 7, author: 'alice', mergedDaysAgo: 2, approvals: ['alice'] },
    ]);

    expect(failed).toHaveLength(1);
    expect(failed[0]?.description).toContain('#7 (by alice)');
    expect(failed[0]?.description).toContain(
      '1 of these carried an approval from the author themselves',
    );
  });

  it('ignores pull requests that were closed without merging', async () => {
    const { passed, failed } = await run([
      { number: 3, author: 'alice', mergedDaysAgo: null, approvals: [] },
    ]);

    expect(failed).toEqual([]);
    expect(passed[0]?.title).toBe('No pull requests merged into main on acme/api');
  });

  it('ignores merges older than the configured window', async () => {
    const { passed, failed } = await run(
      [{ number: 4, author: 'alice', mergedDaysAgo: 200, approvals: [] }],
      { recent_pr_days: 30 },
    );

    expect(failed).toEqual([]);
    expect(passed[0]?.description).toContain('last 30 days');
  });

  it('checks every branch listed for a repository', async () => {
    const { passed } = await runGithubCheck(prAuthorNotReviewerCheck, {
      variables: { target_repos: ['acme/api:main,develop'] },
      fetchAllPages: async (path: string) => {
        if (path.startsWith('/repos/acme/api/pulls?')) return [];
        throw new Error(`Unexpected path: ${path}`);
      },
    });

    expect(passed.map((p) => p.resourceId).sort()).toEqual(['acme/api:develop', 'acme/api:main']);
  });

  it('fails with a configuration finding when no repositories are selected', async () => {
    const { failed } = await runGithubCheck(prAuthorNotReviewerCheck, {
      variables: { target_repos: [] },
    });

    expect(failed).toHaveLength(1);
    expect(failed[0]?.title).toBe('No repositories configured');
    expect(failed[0]?.severity).toBe('low');
  });
});
