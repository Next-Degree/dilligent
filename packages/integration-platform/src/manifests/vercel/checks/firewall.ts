import { TASK_TEMPLATES } from '../../../task-mappings';
import type { CheckContext, IntegrationCheck } from '../../../types';
import { remediationForReadFailure, toHttpReadFailure } from '../../http-read-failure';
import {
  FIREWALL_DENIED_REMEDIATION,
  fetchActiveFirewallConfig,
  summarizeFirewallConfig,
} from '../firewall-config';
import { resolveVercelProjectScope } from '../project-scope';
import { withTeamId } from '../team';
import type { VercelFirewallConfig } from '../types';
import { filteredProjectsVariable, projectFilterModeVariable } from '../variables';

/** Firewall reads are one request per project — bound the run and say so. */
const MAX_PROJECTS_PER_RUN = 50;

/**
 * Vercel Firewall Enabled
 *
 * Reads each project's active Web Application Firewall configuration and
 * requires the firewall to be on. Rule composition is recorded as evidence —
 * the pass/fail gate is whether the firewall is enabled at all.
 *
 * Maps to: Production Firewall & No-Public-Access Controls
 */
export const firewallCheck: IntegrationCheck = {
  id: 'firewall-enabled',
  name: 'Firewall Enabled',
  description: 'Verify the Vercel Web Application Firewall is enabled on each project',
  service: 'security',
  taskMapping: TASK_TEMPLATES.productionFirewallNopublicaccessControls,
  defaultSeverity: 'high',
  variables: [projectFilterModeVariable, filteredProjectsVariable],

  run: async (ctx: CheckContext) => {
    ctx.log('Starting Vercel firewall check');

    const scope = await resolveVercelProjectScope(ctx, {
      maxProjects: MAX_PROJECTS_PER_RUN,
      coverageResourceId: 'firewall-coverage',
      unknownAspect: 'firewall status',
    });
    if (!scope) return;

    const { teamId, teamName, allProjects, scopedProjects, projectsToCheck, filter, checkedAt } =
      scope;

    ctx.log(
      `Checking firewall for ${projectsToCheck.length} of ${allProjects.length} project(s) (filter mode=${filter.mode})`,
    );

    let enabledCount = 0;
    for (const project of projectsToCheck) {
      const params = withTeamId(new URLSearchParams({ projectId: project.id }), teamId);

      let config: VercelFirewallConfig | null;
      try {
        config = await fetchActiveFirewallConfig(ctx, params);
      } catch (error) {
        const failure = toHttpReadFailure(error);
        ctx.fail({
          title: `Firewall status unknown: ${project.name}`,
          resourceType: 'project',
          resourceId: project.id,
          severity: 'medium',
          description: `Could not read the firewall configuration: ${failure.error}`,
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
          title: `Firewall status unknown: ${project.name}`,
          resourceType: 'project',
          resourceId: project.id,
          severity: 'medium',
          description:
            'Vercel returned a firewall configuration without a firewall status for this project.',
          remediation: FIREWALL_DENIED_REMEDIATION,
          evidence: { project: project.name, checkedAt },
        });
        continue;
      }

      const summary = summarizeFirewallConfig(config);
      const evidence = { project: project.name, projectId: project.id, ...summary, checkedAt };

      if (config.firewallEnabled === true) {
        enabledCount++;
        ctx.pass({
          title: `Firewall enabled: ${project.name}`,
          resourceType: 'project',
          resourceId: project.id,
          description: `The Vercel Web Application Firewall is enabled with ${summary.activeCustomRuleCount} active custom rule(s) and ${summary.activeManagedRules.length} managed ruleset(s).`,
          evidence,
        });
        continue;
      }

      ctx.fail({
        title: `Firewall disabled: ${project.name}`,
        resourceType: 'project',
        resourceId: project.id,
        severity: 'high',
        description: `The Vercel Web Application Firewall is not enabled for ${project.name}, so requests reach the application without WAF inspection.`,
        remediation: `Enable the firewall in Vercel Dashboard > ${project.name} > Firewall, and turn on the managed rulesets your plan provides.`,
        evidence,
      });
    }

    ctx.pass({
      title: 'Vercel Firewall Configuration',
      resourceType: 'vercel',
      resourceId: 'firewall',
      description: `${enabledCount} of ${projectsToCheck.length} checked project(s) have the firewall enabled.`,
      evidence: {
        teamId,
        teamName: teamName ?? null,
        totalProjects: allProjects.length,
        scopedProjects: scopedProjects.length,
        checkedProjects: projectsToCheck.length,
        firewallEnabledCount: enabledCount,
        filterMode: filter.mode,
        checkedAt,
      },
    });

    ctx.log(
      `Vercel firewall check complete: ${enabledCount}/${projectsToCheck.length} projects with the firewall enabled`,
    );
  },
};
