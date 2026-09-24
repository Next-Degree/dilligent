/**
 * Branch Protection Enforced for Administrators Check
 *
 * Branch protection that administrators can bypass is not a control — an owner
 * can push straight to the protected branch and nothing records it as an
 * exception. This check verifies the rules apply to EVERYONE.
 *
 * Two protection systems have to be inspected, because a repository may use
 * either:
 *   - Rulesets: enforced for all unless a `bypass_actors` entry exempts someone.
 *     The list endpoint omits `bypass_actors`, so each applicable ruleset is
 *     re-fetched individually.
 *   - Legacy branch protection: enforced for admins only when `enforce_admins`
 *     is on.
 */

import { TASK_TEMPLATES } from '../../../task-mappings';
import type { IntegrationCheck } from '../../../types';
import type {
  GitHubBranchProtection,
  GitHubRepo,
  GitHubRuleset,
  GitHubRulesetBypassActor,
} from '../types';
import { parseRepoBranches, targetReposVariable } from '../variables';
import { mapWithConcurrency, REPO_CHECK_CONCURRENCY } from './concurrency';

interface BypassSummary {
  ruleset_name: string;
  ruleset_id: number;
  actors: GitHubRulesetBypassActor[];
}

/** Does this ruleset's ref_name condition cover the branch? */
const rulesetCoversBranch = ({
  ruleset,
  branch,
  defaultBranch,
}: {
  ruleset: GitHubRuleset;
  branch: string;
  defaultBranch: string | null;
}): boolean => {
  const refName = ruleset.conditions?.ref_name;
  if (!refName) return true;

  const matches = (pattern: string): boolean =>
    pattern === `refs/heads/${branch}` ||
    pattern === '~ALL' ||
    (pattern === '~DEFAULT_BRANCH' && branch === defaultBranch);

  if ((refName.exclude ?? []).some(matches)) return false;

  const include = refName.include ?? [];
  if (include.length === 0) return true;
  return include.some(matches);
};

const describeActor = (actor: GitHubRulesetBypassActor): string => {
  const type = actor.actor_type ?? 'unknown actor';
  const mode = actor.bypass_mode ? ` (${actor.bypass_mode})` : '';
  return `${type}${mode}`;
};

export const adminEnforcementCheck: IntegrationCheck = {
  id: 'branch_protection_admin_enforcement',
  name: 'Branch Protection Enforced for Administrators',
  description:
    'Verifies that branch protection rules apply to administrators too — no ruleset bypass actors, and legacy protection with "Do not allow bypassing the above settings" enabled.',
  service: 'code-security',
  taskMapping: TASK_TEMPLATES.codeChanges,
  defaultSeverity: 'high',

  variables: [targetReposVariable],

  run: async (ctx) => {
    const targetRepos = (ctx.variables.target_repos as string[] | undefined) ?? [];

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
          'No repositories are configured, so administrator enforcement of branch protection could not be verified.',
        resourceType: 'integration',
        resourceId: 'github',
        severity: 'low',
        remediation: 'Open the integration settings and select repositories to monitor.',
      });
      return;
    }

    ctx.log(`Checking admin enforcement on ${repoBranchPairs.length} repo/branch pairs`);

    /**
     * Rulesets applying to the branch, each re-fetched so `bypass_actors` is
     * present. Returns null when the rulesets API is unreadable, which is
     * different from "there are no rulesets".
     */
    const loadBypassSummaries = async ({
      repoFullName,
      branch,
      defaultBranch,
    }: {
      repoFullName: string;
      branch: string;
      defaultBranch: string | null;
    }): Promise<{ summaries: BypassSummary[]; applicable: number } | null> => {
      let rulesets: GitHubRuleset[];
      try {
        rulesets = await ctx.fetch<GitHubRuleset[]>(`/repos/${repoFullName}/rulesets`);
      } catch (error) {
        ctx.warn(`Could not list rulesets for ${repoFullName}: ${String(error)}`);
        return null;
      }

      const applicable = rulesets.filter(
        (ruleset) =>
          ruleset.enforcement === 'active' &&
          ruleset.target === 'branch' &&
          rulesetCoversBranch({ ruleset, branch, defaultBranch }),
      );

      const detailed = await mapWithConcurrency(applicable, 5, async (ruleset) => {
        try {
          const full = await ctx.fetch<GitHubRuleset>(
            `/repos/${repoFullName}/rulesets/${ruleset.id}`,
          );
          return { ...ruleset, bypass_actors: full.bypass_actors ?? [] };
        } catch (error) {
          ctx.warn(`Could not read ruleset ${ruleset.id} on ${repoFullName}: ${String(error)}`);
          // Unreadable detail — assume no bypass rather than invent one.
          return { ...ruleset, bypass_actors: [] };
        }
      });

      const summaries = detailed
        .filter((ruleset) => (ruleset.bypass_actors ?? []).length > 0)
        .map((ruleset) => ({
          ruleset_name: ruleset.name,
          ruleset_id: ruleset.id,
          actors: ruleset.bypass_actors ?? [],
        }));

      return { summaries, applicable: applicable.length };
    };

    /** Evaluate one branch and emit exactly one pass or fail for it. */
    const checkBranch = async ({
      repoFullName,
      branch,
      defaultBranch,
    }: {
      repoFullName: string;
      branch: string;
      defaultBranch: string | null;
    }): Promise<void> => {
      const resourceId = `${repoFullName}:${branch}`;
      const checkedAt = new Date().toISOString();

      const rulesetResult = await loadBypassSummaries({
        repoFullName,
        branch,
        defaultBranch,
      });

      let legacyEnforceAdmins: boolean | null = null;
      try {
        const protection = await ctx.fetch<GitHubBranchProtection>(
          `/repos/${repoFullName}/branches/${branch}/protection`,
        );
        legacyEnforceAdmins = protection.enforce_admins?.enabled ?? false;
      } catch (error) {
        // 404 simply means the branch uses rulesets (or has no protection).
        ctx.log(`No legacy branch protection on ${resourceId}: ${String(error)}`);
      }

      const bypassSummaries = rulesetResult?.summaries ?? [];
      const applicableRulesets = rulesetResult?.applicable ?? 0;
      const hasProtection = applicableRulesets > 0 || legacyEnforceAdmins !== null;

      const evidence = {
        [resourceId]: {
          branch,
          applicable_rulesets: applicableRulesets,
          rulesets_with_bypass: bypassSummaries,
          legacy_enforce_admins: legacyEnforceAdmins,
          checked_at: checkedAt,
        },
      };

      // No protection at all: there is nothing to enforce for administrators.
      // Reported here too, because a reader of THIS check must not read silence
      // as "admins are covered".
      if (!hasProtection) {
        ctx.fail({
          title: `No branch protection to enforce on ${repoFullName}`,
          description: `Branch "${branch}" has no active rulesets and no legacy protection, so no rules are enforced for administrators or anyone else.`,
          resourceType: 'repository',
          resourceId,
          severity: 'high',
          remediation: `1. Go to https://github.com/${repoFullName}/settings/rules\n2. Create a ruleset targeting "${branch}" that requires a pull request before merging\n3. Leave the bypass list empty so the rules apply to administrators too`,
          evidence,
        });
        return;
      }

      const bypassActorCount = bypassSummaries.reduce(
        (total, summary) => total + summary.actors.length,
        0,
      );
      const legacyGap = legacyEnforceAdmins === false;

      if (bypassActorCount === 0 && !legacyGap) {
        ctx.pass({
          title: `Branch protection enforced for administrators on ${repoFullName}`,
          description: `Branch "${branch}" is protected with no bypass actors${
            legacyEnforceAdmins ? ' and legacy protection includes administrators' : ''
          }, so the rules apply to every user.`,
          resourceType: 'repository',
          resourceId,
          evidence,
        });
        return;
      }

      const reasons: string[] = [];
      if (bypassActorCount > 0) {
        const detail = bypassSummaries
          .map(
            (summary) =>
              `"${summary.ruleset_name}" (${summary.actors.map(describeActor).join(', ')})`,
          )
          .join('; ');
        reasons.push(`${bypassActorCount} bypass actor(s) can skip the rules on ${detail}`);
      }
      if (legacyGap) {
        reasons.push('legacy branch protection does not apply to administrators');
      }

      ctx.fail({
        title: `Administrators can bypass branch protection on ${repoFullName}`,
        description: `Branch "${branch}" is protected, but ${reasons.join(' and ')}. Protected-branch rules that privileged users can skip do not enforce review or approval.`,
        resourceType: 'repository',
        resourceId,
        severity: 'high',
        remediation: `1. Go to https://github.com/${repoFullName}/settings/rules\n2. Open each ruleset targeting "${branch}" and remove every entry from "Bypass list"\n3. If the branch uses classic protection instead, enable "Do not allow bypassing the above settings" at https://github.com/${repoFullName}/settings/branches`,
        evidence,
      });
    };

    // Group by repo so the repository is fetched once per repo rather than once
    // per branch. Its `default_branch` is required to resolve rulesets whose
    // condition is the `~DEFAULT_BRANCH` alias rather than an explicit ref.
    const repoGroups = new Map<string, string[]>();
    for (const pair of repoBranchPairs) {
      repoGroups.set(pair.repo, [...(repoGroups.get(pair.repo) ?? []), pair.branch]);
    }

    await mapWithConcurrency(
      Array.from(repoGroups),
      REPO_CHECK_CONCURRENCY,
      async ([repoFullName, branches]) => {
        let defaultBranch: string | null = null;
        try {
          const repo = await ctx.fetch<GitHubRepo>(`/repos/${repoFullName}`);
          defaultBranch = repo.default_branch;
        } catch (error) {
          ctx.warn(`Could not fetch repo ${repoFullName}: ${String(error)}`);
          ctx.fail({
            title: `Repository not found: ${repoFullName}`,
            description: `Could not access repository "${repoFullName}", so administrator enforcement could not be verified.`,
            resourceType: 'repository',
            resourceId: repoFullName,
            severity: 'medium',
            remediation:
              'Verify the repository name is correct (format: owner/repo) and that the GitHub integration has access to it.',
          });
          return;
        }

        for (const branch of branches) {
          await checkBranch({ repoFullName, branch, defaultBranch });
        }
      },
    );
  },
};
