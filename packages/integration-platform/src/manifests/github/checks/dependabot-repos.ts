/**
 * Shared repository plumbing for the Dependabot checks.
 *
 * Both `dependabot_enabled` and `dependabot_remediation_sla` need the same two
 * things: the set of repositories in scope, and whether Dependabot security
 * updates are switched on for each one. Keeping them here means the two checks
 * can never drift on what "Dependabot is on" means.
 */

import type { CheckContext } from '../../../types';
import type { GitHubOrg, GitHubRepo } from '../types';
import { parseRepoBranch } from '../variables';

/**
 * Whether Dependabot security updates are switched on for a repository.
 *
 * - `enabled`  — on, and opening fix PRs.
 * - `paused`   — on, but dormant after a period of repository inactivity.
 *                GitHub resumes it automatically on the next alert.
 * - `disabled` — off. Alerts may exist but nothing is fixing them.
 * - `unknown`  — we lack the admin access needed to read the setting.
 */
export type DependabotStatus = 'enabled' | 'paused' | 'disabled' | 'unknown';

/** `paused` still counts as switched on — GitHub resumes it on the next alert. */
export const isDependabotActive = (status: DependabotStatus): boolean =>
  status === 'enabled' || status === 'paused';

/**
 * Resolve the repositories a check should run against.
 *
 * When `target_repos` is set we fetch exactly those, emitting a finding for any
 * that cannot be read so an unreachable repository is never silently skipped.
 * With no selection we fall back to every repository across the user's orgs.
 */
export const resolveTargetRepos = async (ctx: CheckContext): Promise<GitHubRepo[]> => {
  const targetReposRaw = ctx.variables.target_repos as string[] | undefined;
  // Values may arrive as "owner/repo:branch" — branch is irrelevant here.
  const targetRepos = (targetReposRaw || []).map((value) => parseRepoBranch(value).repo);

  if (targetRepos.length > 0) {
    const repos: GitHubRepo[] = [];
    for (const repoName of targetRepos) {
      try {
        repos.push(await ctx.fetch<GitHubRepo>(`/repos/${repoName}`));
      } catch {
        ctx.warn(`Could not fetch repo ${repoName}`);
        ctx.fail({
          title: `Repository not found: ${repoName}`,
          description: `Could not access repository "${repoName}". It may not exist or the integration lacks permission.`,
          resourceType: 'repository',
          resourceId: repoName,
          severity: 'medium',
          remediation: `Verify the repository name is correct (format: owner/repo) and that the GitHub integration has access to it.`,
          evidence: {
            [repoName]: {
              error: 'Repository not accessible',
              checked_at: new Date().toISOString(),
            },
          },
        });
      }
    }
    return repos;
  }

  const orgs = await ctx.fetch<GitHubOrg[]>('/user/orgs');
  const repos: GitHubRepo[] = [];
  for (const org of orgs) {
    try {
      repos.push(...(await ctx.fetchAllPages<GitHubRepo>(`/orgs/${org.login}/repos`)));
    } catch (error) {
      const errorStr = String(error);
      // Orgs with unauthorized SAML SSO are skipped rather than failing the run.
      if (errorStr.includes('403') || errorStr.includes('SAML') || errorStr.includes('Forbidden')) {
        ctx.log(`Skipping organization ${org.login} (SAML SSO or permission denied)`);
        continue;
      }
      throw error;
    }
  }
  return repos;
};

/**
 * Read whether Dependabot security updates are enabled for a repository.
 *
 * The `security_and_analysis` field on the repo object does not carry
 * `dependabot_security_updates`; `/automated-security-fixes` is the only
 * endpoint that reports it.
 */
export const fetchDependabotStatus = async (
  ctx: CheckContext,
  repoFullName: string,
): Promise<DependabotStatus> => {
  try {
    const securityFixes = await ctx.fetch<{ enabled: boolean; paused: boolean }>(
      `/repos/${repoFullName}/automated-security-fixes`,
    );
    if (securityFixes.enabled && securityFixes.paused) return 'paused';
    if (securityFixes.enabled) return 'enabled';
    return 'disabled';
  } catch (error) {
    // 404 is how GitHub reports "not enabled for this repository".
    if (String(error).includes('404')) return 'disabled';
    ctx.log(`Could not check Dependabot status for ${repoFullName} (may lack admin access)`);
    return 'unknown';
  }
};
