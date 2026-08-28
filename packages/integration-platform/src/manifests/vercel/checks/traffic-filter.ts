import { TASK_TEMPLATES } from '../../../task-mappings';
import type { CheckContext, IntegrationCheck } from '../../../types';
import { remediationForReadFailure, toHttpReadFailure } from '../../http-read-failure';
import {
  FIREWALL_DENIED_REMEDIATION,
  type FirewallSummary,
  fetchActiveFirewallConfig,
  summarizeFirewallConfig,
} from '../firewall-config';
import { resolveVercelProjectScope } from '../project-scope';
import { withTeamId } from '../team';
import type { VercelFirewallConfig } from '../types';
import { filteredProjectsVariable, projectFilterModeVariable } from '../variables';

/** One firewall read per project — bound the run and say so. */
const MAX_PROJECTS_PER_RUN = 50;

/**
 * Ways a project can be filtering unwanted traffic. The firewall being on is a
 * precondition, not a filter: an enabled firewall with nothing active inspects
 * requests and forwards all of them.
 */
function activeFilters(summary: FirewallSummary): string[] {
  const filters: string[] = [];
  if (summary.activeManagedRules.length > 0) {
    filters.push(`managed rulesets (${summary.activeManagedRules.join(', ')})`);
  }
  if (summary.botIdEnabled) filters.push('bot filtering');
  if (summary.activeCustomRuleCount > 0) {
    filters.push(`${summary.activeCustomRuleCount} custom rule(s)`);
  }
  if (summary.denyingIpRuleCount > 0) {
    filters.push(`${summary.denyingIpRuleCount} IP deny/challenge rule(s)`);
  }
  return filters;
}

/**
 * Vercel unwanted traffic filter
 *
 * Requires each project to actually drop unwanted traffic, not merely to have
 * the Web Application Firewall switched on. A project passes when the firewall
 * is enabled and at least one filtering mechanism is active: a managed OWASP
 * ruleset, bot filtering, a custom rule, or an IP deny/challenge rule.
 *
 * Complements the Firewall Enabled check, which gates only on the switch.
 *
 * Maps to: Production Firewall & No-Public-Access Controls
 */
export const trafficFilterCheck: IntegrationCheck = {
  id: 'unwanted-traffic-filter',
  name: 'Vercel unwanted traffic filter',
  description:
    'Verify each Vercel project has an active rule filtering unwanted traffic, not just the firewall switched on',
  service: 'security',
  taskMapping: TASK_TEMPLATES.productionFirewallNopublicaccessControls,
  defaultSeverity: 'medium',
  variables: [projectFilterModeVariable, filteredProjectsVariable],

  run: async (ctx: CheckContext) => {
    ctx.log('Starting Vercel unwanted traffic filter check');

    const scope = await resolveVercelProjectScope(ctx, {
      maxProjects: MAX_PROJECTS_PER_RUN,
      coverageResourceId: 'traffic-filter-coverage',
      unknownAspect: 'traffic filtering',
    });
    if (!scope) return;

    const { teamId, teamName, allProjects, scopedProjects, projectsToCheck, filter, checkedAt } =
      scope;

    ctx.log(
      `Checking traffic filtering for ${projectsToCheck.length} of ${allProjects.length} project(s) (filter mode=${filter.mode})`,
    );

    let filteringCount = 0;
    for (const project of projectsToCheck) {
      const params = withTeamId(new URLSearchParams({ projectId: project.id }), teamId);

      let config: VercelFirewallConfig | null;
      try {
        config = await fetchActiveFirewallConfig(ctx, params);
      } catch (error) {
        const failure = toHttpReadFailure(error);
        ctx.fail({
          title: `Traffic filtering unknown: ${project.name}`,
          resourceType: 'project',
          resourceId: project.id,
          severity: 'medium',
          description: `Could not read the firewall configuration, so which traffic this project filters is unknown: ${failure.error}`,
          remediation: remediationForReadFailure(failure, FIREWALL_DENIED_REMEDIATION),
          evidence: {
            project: project.name,
            error: failure.error,
            denied: failure.denied,
            checkedAt,
          },
        });
        continue;
      }

      if (!config) {
        ctx.fail({
          title: `Traffic filtering unknown: ${project.name}`,
          resourceType: 'project',
          resourceId: project.id,
          severity: 'medium',
          description:
            'Vercel returned a firewall configuration without a firewall status for this project, so its traffic filtering could not be read.',
          remediation: FIREWALL_DENIED_REMEDIATION,
          evidence: { project: project.name, checkedAt },
        });
        continue;
      }

      const summary = summarizeFirewallConfig(config);
      const filters = activeFilters(summary);
      const evidence = {
        project: project.name,
        projectId: project.id,
        ...summary,
        activeFilters: filters,
        checkedAt,
      };

      if (config.firewallEnabled !== true) {
        ctx.fail({
          title: `No traffic filtering: ${project.name}`,
          resourceType: 'project',
          resourceId: project.id,
          severity: 'high',
          description: `The Vercel firewall is not enabled for ${project.name}, so no rule is filtering unwanted traffic and every request reaches the application.`,
          remediation: `Enable the firewall in Vercel Dashboard > ${project.name} > Firewall, then turn on the managed rulesets your plan provides.`,
          evidence,
        });
        continue;
      }

      if (filters.length === 0) {
        ctx.fail({
          title: `Firewall enabled but nothing is filtered: ${project.name}`,
          resourceType: 'project',
          resourceId: project.id,
          severity: 'medium',
          description: `The firewall is enabled for ${project.name} but no managed ruleset, bot filter, custom rule or IP deny rule is active, so every request is inspected and then forwarded.`,
          remediation: `Open Vercel Dashboard > ${project.name} > Firewall and turn on the managed OWASP rulesets, or add rules for the traffic you want blocked.`,
          evidence,
        });
        continue;
      }

      filteringCount++;
      ctx.pass({
        title: `Unwanted traffic filtered: ${project.name}`,
        resourceType: 'project',
        resourceId: project.id,
        description: `${project.name} filters unwanted traffic with ${filters.join(', ')}.`,
        evidence,
      });
    }

    ctx.pass({
      title: 'Vercel Unwanted Traffic Filtering',
      resourceType: 'vercel',
      resourceId: 'traffic-filter',
      description: `${filteringCount} of ${projectsToCheck.length} checked project(s) have at least one active traffic filter.`,
      evidence: {
        teamId,
        teamName: teamName ?? null,
        totalProjects: allProjects.length,
        scopedProjects: scopedProjects.length,
        checkedProjects: projectsToCheck.length,
        filteringProjectCount: filteringCount,
        filterMode: filter.mode,
        checkedAt,
      },
    });

    ctx.log(
      `Vercel traffic filter check complete: ${filteringCount}/${projectsToCheck.length} projects filtering unwanted traffic`,
    );
  },
};
