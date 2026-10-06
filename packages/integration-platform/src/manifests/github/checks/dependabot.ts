/**
 * Dependabot Check
 * Verifies that Dependabot security updates are enabled on repositories
 * and that open security alerts are remediated within their severity SLA.
 */

import { TASK_TEMPLATES } from '../../../task-mappings';
import type { IntegrationCheck } from '../../../types';
import type { GitHubOrg, GitHubRepo } from '../types';
import {
  alertSeverityThresholdVariable,
  dependabotSlaVariables,
  parseRepoBranch,
  targetReposVariable,
} from '../variables';
import {
  formatAlertSummary,
  highestSeverityOf,
  resolveSeverityThreshold,
  thresholdLabel,
} from './dependabot-alert-severity';
import {
  describeWithinSla,
  describeWorstBreach,
  evaluateAlertSla,
  EVIDENCE_ALERT_LIMIT,
  formatSlaPolicy,
  resolveSlaDays,
} from './dependabot-alert-sla';
import { fetchDependabotAlerts } from './dependabot-alerts-fetch';

export const dependabotCheck: IntegrationCheck = {
  id: 'dependabot_enabled',
  name: 'Dependabot Security Updates Enabled',
  description: 'Verify that Dependabot security updates are enabled on repositories',
  service: 'dependency-management',
  taskMapping: TASK_TEMPLATES.secureCode,
  defaultSeverity: 'medium',

  variables: [targetReposVariable, alertSeverityThresholdVariable, ...dependabotSlaVariables],

  run: async (ctx) => {
    const targetReposRaw = ctx.variables.target_repos as string[] | undefined;
    // Extract just the repo names (values may be in "owner/repo:branch" format)
    const targetRepos = (targetReposRaw || []).map((v) => parseRepoBranch(v).repo);

    const severityThreshold = resolveSeverityThreshold(
      ctx.variables.alert_severity_threshold as string | undefined,
    );
    const slaDays = resolveSlaDays(ctx.variables);
    const now = new Date();

    let repos: GitHubRepo[];

    if (targetRepos.length > 0) {
      repos = [];
      for (const repoName of targetRepos) {
        try {
          const repo = await ctx.fetch<GitHubRepo>(`/repos/${repoName}`);
          repos.push(repo);
        } catch {
          ctx.warn(`Could not fetch repo ${repoName}`);
          // Emit a fail result so the user knows this repo wasn't checked
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
    } else {
      const orgs = await ctx.fetch<GitHubOrg[]>('/user/orgs');
      repos = [];
      for (const org of orgs) {
        try {
          const orgRepos = await ctx.fetchAllPages<GitHubRepo>(`/orgs/${org.login}/repos`);
          repos.push(...orgRepos);
        } catch (error) {
          const errorStr = String(error);
          // Skip orgs with SAML SSO that haven't been authorized, or permission errors
          if (
            errorStr.includes('403') ||
            errorStr.includes('SAML') ||
            errorStr.includes('Forbidden')
          ) {
            ctx.log(`Skipping organization ${org.login} (SAML SSO or permission denied)`);
            continue;
          }
          throw error;
        }
      }
    }

    ctx.log(`Checking ${repos.length} repositories for Dependabot`);

    for (const repo of repos) {
      // Use the dedicated endpoint to check Dependabot security updates status.
      // The security_and_analysis field on the repo object does not include
      // dependabot_security_updates — the correct endpoint is /automated-security-fixes.
      // status: 'enabled' | 'paused' | 'disabled' | 'unknown'
      let dependabotStatus: 'enabled' | 'paused' | 'disabled' | 'unknown' = 'unknown';
      try {
        const securityFixes = await ctx.fetch<{ enabled: boolean; paused: boolean }>(
          `/repos/${repo.full_name}/automated-security-fixes`,
        );
        if (securityFixes.enabled && securityFixes.paused) {
          dependabotStatus = 'paused';
        } else if (securityFixes.enabled) {
          dependabotStatus = 'enabled';
        } else {
          dependabotStatus = 'disabled';
        }
      } catch (error) {
        const errorStr = String(error);
        if (errorStr.includes('404')) {
          // 404 means Dependabot security updates are not enabled for this repo
          dependabotStatus = 'disabled';
        } else {
          // 403 or other errors mean we couldn't determine the status
          ctx.log(
            `Could not check Dependabot status for ${repo.full_name} (may lack admin access)`,
          );
        }
      }

      // Fetch alerts regardless of Dependabot status
      const alerts = await fetchDependabotAlerts({ ctx, repoFullName: repo.full_name });
      const alertCounts = alerts?.counts ?? null;
      const slaTimings = alerts
        ? evaluateAlertSla({
            openAlerts: alerts.openAlerts,
            threshold: severityThreshold,
            slaDays,
            now,
          })
        : [];
      const breaches = slaTimings.filter((timing) => timing.breached);
      const withinSla = slaTimings.filter((timing) => !timing.breached);

      // Build hierarchical evidence: { "owner/repo": { data } }
      const repoEvidence: Record<string, unknown> = {
        dependabot_security_updates: { status: dependabotStatus },
        ...(alertCounts && {
          alerts: {
            open: alertCounts.open,
            fixed: alertCounts.fixed,
            dismissed: alertCounts.dismissed,
            total: alertCounts.total,
            open_by_severity: alertCounts.bySeverity,
          },
          remediation_sla: {
            threshold: severityThreshold,
            sla_days: slaDays,
            past_sla: breaches.length,
            within_sla: withinSla.length,
            // Worst first; counts above cover the full set.
            worst_alerts: slaTimings.slice(0, EVIDENCE_ALERT_LIMIT),
            truncated: slaTimings.length > EVIDENCE_ALERT_LIMIT,
          },
        }),
        checked_at: new Date().toISOString(),
      };

      const withinSlaNote = withinSla.length > 0 ? `\n\n${describeWithinSla(withinSla)}` : '';
      const alertSummary = alertCounts
        ? `\n\nAlert Summary: ${formatAlertSummary(alertCounts)}${withinSlaNote}`
        : '';

      // Gate pass/fail on open alerts at/above the configured threshold that
      // are older than their severity SLA. If we couldn't fetch alerts, fall
      // back to the original "Dependabot on = pass" path — we have no alert
      // signal to act on.
      const isDependabotActive = dependabotStatus === 'enabled' || dependabotStatus === 'paused';

      if (breaches.length > 0 && isDependabotActive) {
        const isSingular = breaches.length === 1;
        const noun = isSingular ? 'alert' : 'alerts';
        const verb = isSingular ? 'is' : 'are';
        const pausedNote =
          dependabotStatus === 'paused'
            ? ' Paused Dependabot will not open fix PRs until it resumes.'
            : '';
        const titleSuffix = dependabotStatus === 'paused' ? ' (paused)' : '';

        ctx.fail({
          title: `${breaches.length} Dependabot ${noun} past remediation SLA on ${repo.name}${titleSuffix}`,
          description: `Dependabot is ${dependabotStatus} but ${breaches.length} open ${thresholdLabel(severityThreshold)} ${noun} ${verb} past the remediation SLA (${formatSlaPolicy(slaDays)}). ${describeWorstBreach(breaches)}${pausedNote}${alertSummary}`,
          resourceType: 'repository',
          resourceId: repo.full_name,
          severity: highestSeverityOf(breaches.map((timing) => timing.severity)),
          remediation: `1. Review open alerts at ${repo.html_url}/security/dependabot\n2. Merge the auto-generated fix PRs, or dismiss alerts with a documented justification\n3. Re-run this check once no alerts are past their SLA`,
          evidence: {
            [repo.full_name]: repoEvidence,
          },
        });
      } else if (dependabotStatus === 'enabled') {
        ctx.pass({
          title: `Dependabot enabled on ${repo.name}`,
          description: `Dependabot security updates are enabled and will automatically create pull requests to fix vulnerable dependencies.${alertSummary}`,
          resourceType: 'repository',
          resourceId: repo.full_name,
          evidence: {
            [repo.full_name]: repoEvidence,
          },
        });
      } else if (dependabotStatus === 'paused') {
        ctx.pass({
          title: `Dependabot enabled on ${repo.name} (paused)`,
          description: `Dependabot security updates are enabled but currently paused due to inactivity. Dependabot will resume automatically when new alerts are detected.${alertSummary}`,
          resourceType: 'repository',
          resourceId: repo.full_name,
          evidence: {
            [repo.full_name]: repoEvidence,
          },
        });
      } else if (dependabotStatus === 'disabled') {
        ctx.fail({
          title: `Dependabot not enabled on ${repo.name}`,
          description: `Dependabot security updates are not enabled, leaving the repository vulnerable to known dependency exploits.${alertSummary}`,
          resourceType: 'repository',
          resourceId: repo.full_name,
          severity: 'medium',
          remediation: `1. Go to ${repo.html_url}/settings/security_analysis\n2. Enable "Dependabot security updates"\n3. Optionally enable "Dependabot version updates" for proactive updates`,
          evidence: {
            [repo.full_name]: repoEvidence,
          },
        });
      } else {
        // Could not determine status (e.g., insufficient permissions)
        ctx.fail({
          title: `Unable to check Dependabot status on ${repo.name}`,
          description: `Could not determine whether Dependabot security updates are enabled. The GitHub integration may lack admin access to this repository.${alertSummary}`,
          resourceType: 'repository',
          resourceId: repo.full_name,
          severity: 'medium',
          remediation: `1. Ensure the GitHub integration has admin access to ${repo.full_name}\n2. Or manually verify at ${repo.html_url}/settings/security_analysis`,
          evidence: {
            [repo.full_name]: repoEvidence,
          },
        });
      }
    }
  },
};
