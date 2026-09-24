/**
 * Repository Visibility Check
 *
 * Verifies that monitored repositories are not publicly visible. Source code in
 * a public repository is readable by anyone on the internet, including its
 * history — so a repo that was ever public must be treated as disclosed, not
 * merely re-secured by flipping it back.
 *
 * `internal` repositories (GitHub Enterprise) count as private: they are
 * visible only to enterprise members, which is why GitHub reports `private:
 * true` for them.
 *
 * Some repositories are public on purpose (open-source libraries, docs sites,
 * status pages). Those are declared through the approved-public-repositories
 * variable and pass with that approval recorded as evidence, rather than
 * failing forever.
 */

import { TASK_TEMPLATES } from '../../../task-mappings';
import type { IntegrationCheck } from '../../../types';
import type { GitHubRepo } from '../types';
import {
  approvedPublicReposVariable,
  parseApprovedPublicRepos,
  parseRepoBranch,
  targetReposVariable,
} from '../variables';
import { mapWithConcurrency, REPO_CHECK_CONCURRENCY } from './concurrency';

export const repositoryVisibilityCheck: IntegrationCheck = {
  id: 'repository_visibility_private',
  name: 'Repository Visibility Set to Private',
  description:
    'Verifies that monitored repositories are private (or enterprise-internal) rather than publicly visible, with an allowlist for repositories that are public by design.',
  service: 'code-security',
  taskMapping: TASK_TEMPLATES.secureCode,
  defaultSeverity: 'high',

  variables: [targetReposVariable, approvedPublicReposVariable],

  run: async (ctx) => {
    const targetReposRaw = (ctx.variables.target_repos as string[] | undefined) ?? [];
    const targetRepos = [...new Set(targetReposRaw.map((v) => parseRepoBranch(v).repo))];
    const approvedPublic = parseApprovedPublicRepos(
      ctx.variables.approved_public_repos as string | undefined,
    );

    if (targetRepos.length === 0) {
      ctx.fail({
        title: 'No repositories selected',
        description:
          'Select at least one repository to monitor in the integration settings so we can verify repository visibility.',
        resourceType: 'integration',
        resourceId: 'github',
        severity: 'low',
        remediation: 'Open the integration settings and choose repositories to monitor.',
      });
      return;
    }

    ctx.log(
      `Checking visibility for ${targetRepos.length} repositories (${approvedPublic.size} approved public)`,
    );

    await mapWithConcurrency(targetRepos, REPO_CHECK_CONCURRENCY, async (repoName) => {
      const checkedAt = new Date().toISOString();

      let repo: GitHubRepo;
      try {
        repo = await ctx.fetch<GitHubRepo>(`/repos/${repoName}`);
      } catch (error) {
        ctx.warn(`Could not fetch repo ${repoName}: ${String(error)}`);
        ctx.fail({
          title: `Repository not found: ${repoName}`,
          description: `Could not access repository "${repoName}", so its visibility could not be verified.`,
          resourceType: 'repository',
          resourceId: repoName,
          severity: 'medium',
          remediation:
            'Verify the repository name is correct (format: owner/repo) and that the GitHub integration has access to it.',
          evidence: {
            [repoName]: { error: 'Repository not accessible', checked_at: checkedAt },
          },
        });
        return;
      }

      // GitHub reports `private: true` for both private and internal repos, so
      // it — not `visibility` — is the authoritative "not on the public
      // internet" signal. `visibility` is recorded for auditors.
      const visibility = repo.visibility ?? (repo.private ? 'private' : 'public');
      const evidence = {
        [repo.full_name]: {
          visibility: {
            visibility,
            private: repo.private,
            archived: repo.archived ?? false,
            approved_public: approvedPublic.has(repo.full_name.toLowerCase()),
            checked_at: checkedAt,
          },
        },
      };

      if (repo.private) {
        ctx.pass({
          title: `${repo.name} is not publicly visible`,
          description: `Repository visibility is "${visibility}", so its source code is not readable by anonymous users.`,
          resourceType: 'repository',
          resourceId: repo.full_name,
          evidence,
        });
        return;
      }

      if (approvedPublic.has(repo.full_name.toLowerCase())) {
        ctx.pass({
          title: `${repo.name} is public by approval`,
          description: `Repository visibility is "${visibility}". This repository is listed as an approved public repository in the integration settings, so public visibility is an accepted, documented exception.`,
          resourceType: 'repository',
          resourceId: repo.full_name,
          evidence,
        });
        return;
      }

      ctx.fail({
        title: `${repo.name} is publicly visible`,
        description: `Repository visibility is "${visibility}", so its source code and full commit history are readable by anyone on the internet.`,
        resourceType: 'repository',
        resourceId: repo.full_name,
        severity: 'high',
        remediation: `1. Go to https://github.com/${repo.full_name}/settings\n2. Under "Danger Zone", choose "Change repository visibility" and set it to Private\n3. Treat anything already committed — especially credentials — as disclosed and rotate it\n4. If this repository is public intentionally, add "${repo.full_name}" to "Approved public repositories" in the integration settings`,
        evidence,
      });
    });
  },
};
