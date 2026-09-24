/**
 * Author Is Not the Reviewer Check
 *
 * Separation of duties on code changes: every pull request merged into a
 * protected branch must carry an approving review from somebody OTHER than its
 * author.
 *
 * This is deliberately evidence-based rather than configuration-based. A branch
 * can require "1 approving review" and still let an author approve their own
 * work through a bypass, a stale-review dismissal, or an admin merge — so we
 * read what actually happened on the merged pull requests instead of trusting
 * the setting.
 */

import { TASK_TEMPLATES } from '../../../task-mappings';
import type { IntegrationCheck } from '../../../types';
import type { GitHubPullRequest, GitHubPullRequestReview } from '../types';
import {
  parseRepoBranches,
  recentPullRequestDaysVariable,
  targetReposVariable,
} from '../variables';
import { mapWithConcurrency, REPO_CHECK_CONCURRENCY } from './concurrency';

/** Merged PRs to inspect per repo/branch. Newest first. */
const MAX_PRS_INSPECTED = 50;
const DEFAULT_RECENT_WINDOW_DAYS = 180;
/** Offending PRs named in the finding description; the rest stay in evidence. */
const MAX_LISTED_IN_DESCRIPTION = 10;

interface ReviewedPullRequest {
  number: number;
  url: string;
  title: string;
  author: string | null;
  merged_at: string | null;
  independent_approvers: string[];
  self_approved: boolean;
}

const toPositiveNumber = (value: unknown, fallback: number): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return value;
};

export const prAuthorNotReviewerCheck: IntegrationCheck = {
  id: 'pr_author_not_reviewer',
  name: 'Author Is Not the Reviewer of Pull Requests',
  description:
    'Verifies that pull requests merged into monitored branches were approved by someone other than their author, enforcing separation of duties on code changes.',
  service: 'code-security',
  taskMapping: TASK_TEMPLATES.codeChanges,
  defaultSeverity: 'high',

  variables: [targetReposVariable, recentPullRequestDaysVariable],

  run: async (ctx) => {
    const targetRepos = (ctx.variables.target_repos as string[] | undefined) ?? [];
    const windowDays = toPositiveNumber(ctx.variables.recent_pr_days, DEFAULT_RECENT_WINDOW_DAYS);
    const cutoff = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

    const repoBranchPairs: Array<{ repo: string; branch: string }> = [];
    for (const value of targetRepos) {
      const parsed = parseRepoBranches(value);
      for (const branch of parsed.branches) {
        repoBranchPairs.push({ repo: parsed.repo, branch });
      }
    }

    if (repoBranchPairs.length === 0) {
      ctx.fail({
        title: 'No repositories configured',
        description:
          'No repositories are configured, so pull request review separation could not be verified.',
        resourceType: 'integration',
        resourceId: 'github',
        severity: 'low',
        remediation: 'Open the integration settings and select repositories to monitor.',
      });
      return;
    }

    ctx.log(
      `Checking review separation on ${repoBranchPairs.length} repo/branch pairs, window=${windowDays}d`,
    );

    /**
     * Approvals that count: state APPROVED, submitted by a login that is not
     * the author. GitHub itself blocks self-approval in the UI, but reviews
     * submitted before an author change — or by an author using a second
     * account — still show up, so we filter explicitly rather than assume.
     */
    const inspectPullRequest = async ({
      repoFullName,
      pr,
    }: {
      repoFullName: string;
      pr: GitHubPullRequest;
    }): Promise<ReviewedPullRequest | null> => {
      const author = pr.user?.login ?? null;
      try {
        const reviews = await ctx.fetchAllPages<GitHubPullRequestReview>(
          `/repos/${repoFullName}/pulls/${pr.number}/reviews`,
          { maxPages: 3 },
        );
        const approvals = reviews.filter((review) => review.state === 'APPROVED');
        const independentApprovers = [
          ...new Set(
            approvals
              .map((review) => review.user?.login)
              .filter((login): login is string => Boolean(login) && login !== author),
          ),
        ];
        const selfApproved = approvals.some(
          (review) => Boolean(author) && review.user?.login === author,
        );

        return {
          number: pr.number,
          url: pr.html_url,
          title: pr.title,
          author,
          merged_at: pr.merged_at,
          independent_approvers: independentApprovers,
          self_approved: selfApproved,
        };
      } catch (error) {
        ctx.warn(`Could not read reviews for ${repoFullName}#${pr.number}: ${String(error)}`);
        return null;
      }
    };

    await mapWithConcurrency(repoBranchPairs, REPO_CHECK_CONCURRENCY, async (pair) => {
      const { repo: repoFullName, branch } = pair;
      const resourceId = `${repoFullName}:${branch}`;
      const checkedAt = new Date().toISOString();

      let mergedPullRequests: GitHubPullRequest[];
      try {
        const pulls = await ctx.fetchAllPages<GitHubPullRequest>(
          `/repos/${repoFullName}/pulls?state=closed&base=${encodeURIComponent(branch)}&sort=updated&direction=desc`,
          { maxPages: 5 },
        );
        mergedPullRequests = pulls
          .filter((pr) => Boolean(pr.merged_at))
          .filter((pr) => new Date(pr.merged_at ?? 0).getTime() >= cutoff.getTime())
          .slice(0, MAX_PRS_INSPECTED);
      } catch (error) {
        ctx.warn(`Could not list pull requests for ${resourceId}: ${String(error)}`);
        ctx.fail({
          title: `Cannot verify review separation on ${repoFullName}`,
          description: `Could not list pull requests for branch "${branch}". The integration may lack access to this repository.`,
          resourceType: 'repository',
          resourceId,
          severity: 'medium',
          remediation: `Confirm the GitHub integration has read access to ${repoFullName} and that the branch "${branch}" exists.`,
          evidence: {
            [resourceId]: { error: 'Could not list pull requests', checked_at: checkedAt },
          },
        });
        return;
      }

      // Nothing merged in the window is not a violation — there is simply no
      // code change to review. Recorded as a pass so the run always carries
      // evidence for the branch.
      if (mergedPullRequests.length === 0) {
        ctx.pass({
          title: `No pull requests merged into ${branch} on ${repoFullName}`,
          description: `No pull requests were merged into "${branch}" in the last ${windowDays} days, so there is nothing to review.`,
          resourceType: 'repository',
          resourceId,
          evidence: {
            [resourceId]: {
              branch,
              merged_pull_requests: 0,
              window_days: windowDays,
              checked_at: checkedAt,
            },
          },
        });
        return;
      }

      const inspected = await mapWithConcurrency(mergedPullRequests, 5, (pr) =>
        inspectPullRequest({ repoFullName, pr }),
      );
      const reviewed = inspected.filter((pr): pr is ReviewedPullRequest => pr !== null);
      const violations = reviewed.filter((pr) => pr.independent_approvers.length === 0);

      const evidence = {
        [resourceId]: {
          branch,
          window_days: windowDays,
          merged_pull_requests: reviewed.length,
          unreviewed_pull_requests: violations.length,
          pull_requests: reviewed,
          checked_at: checkedAt,
        },
      };

      if (violations.length === 0) {
        ctx.pass({
          title: `All merged pull requests independently reviewed on ${repoFullName}`,
          description: `All ${reviewed.length} pull request(s) merged into "${branch}" in the last ${windowDays} days were approved by a reviewer other than the author.`,
          resourceType: 'repository',
          resourceId,
          evidence,
        });
        return;
      }

      const listed = violations
        .slice(0, MAX_LISTED_IN_DESCRIPTION)
        .map((pr) => `#${pr.number} (by ${pr.author ?? 'unknown'})`)
        .join(', ');
      const overflow =
        violations.length > MAX_LISTED_IN_DESCRIPTION
          ? ` and ${violations.length - MAX_LISTED_IN_DESCRIPTION} more`
          : '';
      const selfApprovedCount = violations.filter((pr) => pr.self_approved).length;
      const selfApprovedNote = selfApprovedCount
        ? ` ${selfApprovedCount} of these carried an approval from the author themselves.`
        : '';

      ctx.fail({
        title: `${violations.length} pull request(s) merged without independent review on ${repoFullName}`,
        description: `${violations.length} of ${reviewed.length} pull request(s) merged into "${branch}" in the last ${windowDays} days had no approving review from anyone other than the author: ${listed}${overflow}.${selfApprovedNote}`,
        resourceType: 'repository',
        resourceId,
        severity: 'high',
        remediation: `1. Go to https://github.com/${repoFullName}/settings/rules\n2. On the ruleset protecting "${branch}", enable "Require a pull request before merging" with at least 1 required approval\n3. Enable "Dismiss stale pull request approvals when new commits are pushed" and remove bypass permissions so authors cannot merge their own unreviewed changes`,
        evidence,
      });
    });
  },
};
