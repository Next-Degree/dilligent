/**
 * Dependabot Remediation SLA Check
 *
 * Evidence for the "Vulnerability Scanning & Remediation" task: dependency
 * scanning is switched on, and critical/high findings are being closed inside
 * the windows the Vulnerability & Patch Management policy commits to.
 *
 * This is deliberately distinct from `dependabot_enabled`, which fails on the
 * mere existence of an open high-severity alert. A policy gives teams a
 * remediation window, so an alert opened yesterday is compliant and the same
 * alert left open past its deadline is not.
 */

import { TASK_TEMPLATES } from '../../../task-mappings';
import type { IntegrationCheck } from '../../../types';
import type { GitHubDependabotAlert } from '../types';
import {
  criticalRemediationSlaDaysVariable,
  highRemediationSlaDaysVariable,
  targetReposVariable,
} from '../variables';
import { fetchDependabotStatus, isDependabotActive, resolveTargetRepos } from './dependabot-repos';
import {
  breachSeverity,
  classifyAlertsBySla,
  describeSla,
  resolveSlaConfig,
  type SlaClassification,
  type TrackedAlert,
} from './dependabot-sla';

/** Compact, auditor-readable record of a single alert. */
const alertEvidence = (alert: TrackedAlert) => ({
  alert_number: alert.number,
  severity: alert.severity,
  package: alert.packageName,
  advisory: alert.advisory,
  opened_at: alert.createdAt,
  age_days: alert.ageDays,
  sla_days: alert.slaDays,
  overdue_days: alert.overdueDays > 0 ? alert.overdueDays : 0,
  url: alert.htmlUrl,
});

/** "3 critical, 1 high" — severity mix of a set of alerts. */
const describeMix = (alerts: TrackedAlert[]): string => {
  const critical = alerts.filter((alert) => alert.severity === 'critical').length;
  const high = alerts.length - critical;
  const parts: string[] = [];
  if (critical > 0) parts.push(`${critical} critical`);
  if (high > 0) parts.push(`${high} high`);
  return parts.join(', ');
};

const buildEvidence = ({
  status,
  sla,
  classification,
}: {
  status: string;
  sla: ReturnType<typeof resolveSlaConfig>;
  classification: SlaClassification;
}) => ({
  dependabot_security_updates: { status },
  remediation_sla_days: { critical: sla.critical, high: sla.high },
  open_critical_high_alerts: {
    breaching_sla: classification.breaching.length,
    within_sla: classification.withinSla.length,
    undated: classification.undated,
  },
  // Sampling the worst offenders keeps the evidence blob bounded while still
  // showing an auditor the specific findings behind the verdict.
  breaching_alerts: classification.breaching.slice(0, 20).map(alertEvidence),
  within_sla_alerts: classification.withinSla.slice(0, 20).map(alertEvidence),
  checked_at: new Date().toISOString(),
});

export const dependabotRemediationSlaCheck: IntegrationCheck = {
  id: 'dependabot_remediation_sla',
  name: 'Dependency Vulnerabilities Remediated Within SLA',
  description:
    'Verify Dependabot is enabled and that open critical and high dependency alerts are remediated within the configured SLA windows',
  service: 'dependency-management',
  taskMapping: TASK_TEMPLATES.vulnerabilityScanningRemediation,
  defaultSeverity: 'high',

  variables: [
    targetReposVariable,
    criticalRemediationSlaDaysVariable,
    highRemediationSlaDaysVariable,
  ],

  run: async (ctx) => {
    const sla = resolveSlaConfig(ctx.variables);
    const now = new Date();
    const repos = await resolveTargetRepos(ctx);

    ctx.log(
      `Checking ${repos.length} repositories against remediation SLA (${describeSla(sla)})`,
    );

    for (const repo of repos) {
      const status = await fetchDependabotStatus(ctx, repo.full_name);

      // Scanning switched off means there is no remediation record to evidence.
      // Reporting this as a pass would let a repository with no scanning at all
      // satisfy the vulnerability-management task.
      if (!isDependabotActive(status)) {
        const isUnknown = status === 'unknown';
        ctx.fail({
          title: isUnknown
            ? `Unable to confirm dependency scanning on ${repo.name}`
            : `Dependency scanning not enabled on ${repo.name}`,
          description: isUnknown
            ? `Could not determine whether Dependabot security updates are enabled, so remediation against the ${describeSla(sla)} SLA cannot be evidenced. The GitHub integration may lack admin access to this repository.`
            : `Dependabot security updates are not enabled, so vulnerable dependencies are neither detected nor remediated against the ${describeSla(sla)} SLA.`,
          resourceType: 'repository',
          resourceId: repo.full_name,
          severity: isUnknown ? 'medium' : 'high',
          remediation: isUnknown
            ? `1. Ensure the GitHub integration has admin access to ${repo.full_name}\n2. Or manually verify at ${repo.html_url}/settings/security_analysis`
            : `1. Go to ${repo.html_url}/settings/security_analysis\n2. Enable "Dependabot alerts" and "Dependabot security updates"\n3. Re-run this check once scanning is active`,
          evidence: {
            [repo.full_name]: {
              dependabot_security_updates: { status },
              remediation_sla_days: { critical: sla.critical, high: sla.high },
              checked_at: now.toISOString(),
            },
          },
        });
        continue;
      }

      let openAlerts: GitHubDependabotAlert[];
      try {
        openAlerts = await ctx.fetchWithLinkHeader<GitHubDependabotAlert>(
          `/repos/${repo.full_name}/dependabot/alerts`,
          { params: { state: 'open', per_page: '100' } },
        );
      } catch (error) {
        // Without the alert list we have no SLA signal. Report it rather than
        // passing, so a permission gap never reads as a clean bill of health.
        ctx.warn(`Failed to fetch Dependabot alerts for ${repo.full_name}: ${String(error)}`);
        ctx.fail({
          title: `Unable to read dependency alerts on ${repo.name}`,
          description: `Dependabot is ${status}, but its alerts could not be read, so remediation against the ${describeSla(sla)} SLA cannot be evidenced.`,
          resourceType: 'repository',
          resourceId: repo.full_name,
          severity: 'medium',
          remediation: `1. Ensure the GitHub integration has "security_events" access to ${repo.full_name}\n2. Confirm Dependabot alerts are enabled at ${repo.html_url}/settings/security_analysis`,
          evidence: {
            [repo.full_name]: {
              dependabot_security_updates: { status },
              remediation_sla_days: { critical: sla.critical, high: sla.high },
              error: 'Dependabot alerts not accessible',
              checked_at: now.toISOString(),
            },
          },
        });
        continue;
      }

      const classification = classifyAlertsBySla({ alerts: openAlerts, sla, now });
      const evidence = { [repo.full_name]: buildEvidence({ status, sla, classification }) };
      const pausedNote =
        status === 'paused'
          ? ' Dependabot is currently paused and will resume on the next alert.'
          : '';

      if (classification.breaching.length > 0) {
        const count = classification.breaching.length;
        const noun = count === 1 ? 'alert' : 'alerts';
        const worst = classification.breaching[0]!;

        ctx.fail({
          title: `${count} dependency ${noun} past remediation SLA on ${repo.name}`,
          description: `${describeMix(classification.breaching)} ${count === 1 ? 'alert is' : 'alerts are'} open beyond the ${describeSla(sla)} remediation SLA. The oldest (${worst.packageName}, ${worst.severity}) has been open ${worst.ageDays} days, ${worst.overdueDays} past its ${worst.slaDays}-day deadline.${pausedNote}`,
          resourceType: 'repository',
          resourceId: repo.full_name,
          severity: breachSeverity(classification.breaching),
          remediation: `1. Review overdue alerts at ${repo.html_url}/security/dependabot\n2. Merge the Dependabot fix PRs, or dismiss with a documented risk acceptance\n3. If the deadlines are unachievable, revise the SLA in the Vulnerability & Patch Management policy and update this check's settings to match`,
          evidence,
        });
        continue;
      }

      const withinCount = classification.withinSla.length;
      const openNote =
        withinCount > 0
          ? ` ${withinCount} open ${withinCount === 1 ? 'alert is' : 'alerts are'} still inside the window (${describeMix(classification.withinSla)}).`
          : ' There are no open critical or high alerts.';
      const undatedNote =
        classification.undated > 0
          ? ` ${classification.undated} alert(s) had no usable open date and were not aged.`
          : '';

      ctx.pass({
        title: `Dependency alerts within remediation SLA on ${repo.name}`,
        description: `Dependabot security updates are ${status} and no critical or high alert has exceeded the ${describeSla(sla)} remediation SLA.${openNote}${undatedNote}${pausedNote}`,
        resourceType: 'repository',
        resourceId: repo.full_name,
        evidence,
      });
    }
  },
};
