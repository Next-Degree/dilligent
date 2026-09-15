/**
 * Dependabot Check
 * Verifies that Dependabot security updates are enabled on repositories
 * and reports the count of open/closed security alerts.
 */

import { TASK_TEMPLATES } from '../../../task-mappings';
import type { IntegrationCheck } from '../../../types';
import type { GitHubDependabotAlert } from '../types';
import { alertSeverityThresholdVariable, targetReposVariable } from '../variables';
import {
  fetchDependabotStatus,
  isDependabotActive,
  resolveTargetRepos,
  type DependabotStatus,
} from './dependabot-repos';
import {
  countAtOrAboveSeverity,
  highestPresentSeverity,
  resolveSeverityThreshold,
  thresholdLabel,
  type AlertCounts,
} from './dependabot-alert-severity';

export const dependabotCheck: IntegrationCheck = {
  id: 'dependabot_enabled',
  name: 'Dependabot Security Updates Enabled',
  description: 'Verify that Dependabot security updates are enabled on repositories',
  service: 'dependency-management',
  taskMapping: TASK_TEMPLATES.secureCode,
  defaultSeverity: 'medium',

  variables: [targetReposVariable, alertSeverityThresholdVariable],

  run: async (ctx) => {
    const severityThreshold = resolveSeverityThreshold(
      ctx.variables.alert_severity_threshold as string | undefined,
    );

    const repos = await resolveTargetRepos(ctx);

    ctx.log(`Checking ${repos.length} repositories for Dependabot`);

    /**
     * Fetch Dependabot alerts for a repository and calculate counts
     */
    const fetchAlertCounts = async (repoFullName: string): Promise<AlertCounts | null> => {
      try {
        // GitHub supports filtering by state: open, fixed, dismissed (no "all")
        const [openAlerts, fixedAlerts, dismissedAlerts] = await Promise.all([
          ctx.fetchWithLinkHeader<GitHubDependabotAlert>(
            `/repos/${repoFullName}/dependabot/alerts`,
            {
              params: { state: 'open', per_page: '100' },
            },
          ),
          ctx.fetchWithLinkHeader<GitHubDependabotAlert>(
            `/repos/${repoFullName}/dependabot/alerts`,
            {
              params: { state: 'fixed', per_page: '100' },
            },
          ),
          ctx.fetchWithLinkHeader<GitHubDependabotAlert>(
            `/repos/${repoFullName}/dependabot/alerts`,
            { params: { state: 'dismissed', per_page: '100' } },
          ),
        ]);

        const counts: AlertCounts = {
          open: openAlerts.length,
          dismissed: dismissedAlerts.length,
          fixed: fixedAlerts.length,
          total: openAlerts.length + fixedAlerts.length + dismissedAlerts.length,
          bySeverity: { critical: 0, high: 0, medium: 0, low: 0 },
        };

        for (const alert of openAlerts) {
          const severity = alert.security_vulnerability?.severity ?? 'low';
          counts.bySeverity[severity]++;
        }

        return counts;
      } catch (error) {
        const errorStr = String(error);
        // 403 usually means Dependabot alerts are not enabled or no permission
        if (errorStr.includes('403') || errorStr.includes('Forbidden')) {
          ctx.log(`Cannot access Dependabot alerts for ${repoFullName} (permission denied)`);
          return null;
        }
        // 400 can mean Dependabot alerts endpoint isn't available for the repo/app
        if (errorStr.includes('400') || errorStr.includes('Bad Request')) {
          ctx.log(
            `Dependabot alerts not available for ${repoFullName} (feature may not be enabled)`,
          );
          return null;
        }
        ctx.warn(`Failed to fetch Dependabot alerts for ${repoFullName}: ${errorStr}`);
        return null;
      }
    };

    /**
     * Format alert counts for display
     */
    const formatAlertSummary = (counts: AlertCounts): string => {
      const parts: string[] = [];

      if (counts.open > 0) {
        const severityBreakdown: string[] = [];
        if (counts.bySeverity.critical > 0)
          severityBreakdown.push(`${counts.bySeverity.critical} critical`);
        if (counts.bySeverity.high > 0) severityBreakdown.push(`${counts.bySeverity.high} high`);
        if (counts.bySeverity.medium > 0)
          severityBreakdown.push(`${counts.bySeverity.medium} medium`);
        if (counts.bySeverity.low > 0) severityBreakdown.push(`${counts.bySeverity.low} low`);

        parts.push(`${counts.open} open (${severityBreakdown.join(', ')})`);
      } else {
        parts.push('0 open');
      }

      parts.push(`${counts.fixed} fixed`);
      parts.push(`${counts.dismissed} dismissed`);

      return parts.join(', ');
    };

    for (const repo of repos) {
      const dependabotStatus: DependabotStatus = await fetchDependabotStatus(
        ctx,
        repo.full_name,
      );

      // Fetch alert counts regardless of Dependabot status
      const alertCounts = await fetchAlertCounts(repo.full_name);

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
        }),
        checked_at: new Date().toISOString(),
      };

      const alertSummary = alertCounts
        ? `\n\nAlert Summary: ${formatAlertSummary(alertCounts)}`
        : '';

      // Gate pass/fail on open alerts at/above the configured threshold. If we
      // couldn't fetch alerts (alertCounts == null), fall back to the original
      // "Dependabot on = pass" path — we have no alert signal to act on.
      const alertsAtOrAboveThreshold = alertCounts
        ? countAtOrAboveSeverity(alertCounts.bySeverity, severityThreshold)
        : 0;

      if (alertCounts && alertsAtOrAboveThreshold > 0 && isDependabotActive(dependabotStatus)) {
        const isSingular = alertsAtOrAboveThreshold === 1;
        const noun = isSingular ? 'alert' : 'alerts';
        const verb = isSingular ? 'is' : 'are';
        const pausedNote =
          dependabotStatus === 'paused'
            ? ' Paused Dependabot will not open fix PRs until it resumes.'
            : '';
        const titleSuffix = dependabotStatus === 'paused' ? ' (paused)' : '';

        ctx.fail({
          title: `${alertsAtOrAboveThreshold} unresolved Dependabot ${noun} on ${repo.name}${titleSuffix}`,
          description: `Dependabot is ${dependabotStatus} but ${alertsAtOrAboveThreshold} open ${thresholdLabel(severityThreshold)} ${noun} ${verb} still unresolved.${pausedNote}${alertSummary}`,
          resourceType: 'repository',
          resourceId: repo.full_name,
          severity: highestPresentSeverity(alertCounts.bySeverity),
          remediation: `1. Review open alerts at ${repo.html_url}/security/dependabot\n2. Merge the auto-generated fix PRs, or dismiss alerts with a documented justification\n3. Re-run this check once the alert count drops to zero`,
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
