import { TASK_TEMPLATES } from '../../../task-mappings';
import type { CheckContext, IntegrationCheck } from '../../../types';
import { remediationForReadFailure, toHttpReadFailure } from '../../http-read-failure';
import { fetchAllVercelProjects } from '../projects';
import { getVercelTeamContext, withTeamId } from '../team';
import type { VercelFirewallConfig, VercelFirewallConfigResponse, VercelProject } from '../types';
import {
  applyVercelProjectFilter,
  filteredProjectsVariable,
  parseVercelProjectFilter,
  projectFilterModeVariable,
} from '../variables';

/** Firewall reads are one request per project — bound the run and say so. */
const MAX_PROJECTS_PER_RUN = 50;

const DENIED_REMEDIATION =
  'Reconnect the Vercel integration with an account that can read the project firewall (Owner or Security role), and confirm your Vercel plan includes the Web Application Firewall.';

/** The endpoint returns the config directly on some versions, wrapped on others. */
function unwrapFirewallConfig(raw: unknown): VercelFirewallConfig | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const wrapped = (raw as VercelFirewallConfigResponse).active;
  if (wrapped && typeof wrapped === 'object') return wrapped;
  return 'firewallEnabled' in raw ? (raw as VercelFirewallConfig) : null;
}

interface FirewallSummary {
  firewallEnabled: boolean | null;
  configVersion: number | null;
  updatedAt: string | null;
  botIdEnabled: boolean;
  activeManagedRules: string[];
  customRuleCount: number;
  activeCustomRuleCount: number;
  ipRuleCount: number;
}

/**
 * Read a project's active firewall config. Vercel serves it under two path
 * variants depending on the account's API version — the versioned form with
 * the literal `active`, and the bare form that wraps it in `{ active }` — so a
 * 404/400 on the first is retried against the second before giving up.
 */
async function fetchActiveFirewallConfig(
  ctx: CheckContext,
  params: URLSearchParams,
): Promise<VercelFirewallConfig | null> {
  try {
    return unwrapFirewallConfig(
      await ctx.fetch<unknown>(`/v1/security/firewall/config/active?${params.toString()}`),
    );
  } catch (error) {
    const status = (error as { status?: number } | null)?.status;
    if (status !== 404 && status !== 400) {
      throw error;
    }
    return unwrapFirewallConfig(
      await ctx.fetch<unknown>(`/v1/security/firewall/config?${params.toString()}`),
    );
  }
}

function summarizeConfig(config: VercelFirewallConfig): FirewallSummary {
  const managedRules = config.managedRules ?? {};
  return {
    firewallEnabled: config.firewallEnabled ?? null,
    configVersion: config.version ?? null,
    updatedAt: config.updatedAt ?? null,
    botIdEnabled: config.botIdEnabled ?? false,
    activeManagedRules: Object.entries(managedRules)
      .filter(([, rule]) => rule?.active)
      .map(([name]) => name),
    customRuleCount: config.rules?.length ?? 0,
    activeCustomRuleCount: config.rules?.filter((rule) => rule.active !== false).length ?? 0,
    ipRuleCount: config.ips?.length ?? 0,
  };
}

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

    const { teamId, teamName } = getVercelTeamContext(ctx);
    const checkedAt = new Date().toISOString();

    let projects: VercelProject[];
    try {
      projects = await fetchAllVercelProjects(ctx, teamId);
    } catch (error) {
      const failure = toHttpReadFailure(error);
      ctx.fail({
        title: 'Failed to fetch Vercel projects',
        resourceType: 'vercel',
        resourceId: 'projects',
        severity: 'high',
        description: `Could not fetch projects: ${failure.error}`,
        remediation: remediationForReadFailure(
          failure,
          'Ensure the Vercel connection has access to your projects, then re-run the check.',
        ),
        evidence: { teamId: teamId ?? null, error: failure.error, denied: failure.denied },
      });
      return;
    }

    const filter = parseVercelProjectFilter(ctx.variables);
    const scopedProjects = applyVercelProjectFilter(projects, filter);

    if (filter.mode !== 'all' && scopedProjects.length === 0) {
      ctx.fail({
        title: 'Project filter matched no projects',
        resourceType: 'vercel',
        resourceId: 'project-filter',
        severity: 'medium',
        description: `Filter mode "${filter.mode}" with ${filter.selectedIds.size} selected project(s) resolved to zero projects in scope. This may indicate deleted or renamed projects.`,
        remediation:
          'Open the Configure sheet for this automation and review the selected projects.',
        evidence: {
          filterMode: filter.mode,
          selectedProjectIds: Array.from(filter.selectedIds),
          availableProjectIds: projects.map((project) => project.id),
        },
      });
      return;
    }

    const projectsToCheck = scopedProjects.slice(0, MAX_PROJECTS_PER_RUN);
    const skipped = scopedProjects.slice(MAX_PROJECTS_PER_RUN);

    if (skipped.length > 0) {
      // Never let a coverage cap read as "everything passed".
      ctx.fail({
        title: `${skipped.length} project(s) not checked`,
        resourceType: 'vercel',
        resourceId: 'firewall-coverage',
        severity: 'low',
        description: `This run covered ${projectsToCheck.length} of ${scopedProjects.length} projects in scope; the firewall status of the rest is unknown.`,
        remediation:
          'Narrow the project filter in the Configure sheet so every project you need evidence for is covered by a run.',
        evidence: {
          checkedProjectCount: projectsToCheck.length,
          scopedProjectCount: scopedProjects.length,
          skippedProjectIds: skipped.map((project) => project.id),
          maxProjectsPerRun: MAX_PROJECTS_PER_RUN,
          checkedAt,
        },
      });
    }

    ctx.log(
      `Checking firewall for ${projectsToCheck.length} of ${projects.length} project(s) (filter mode=${filter.mode})`,
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
          remediation: remediationForReadFailure(failure, DENIED_REMEDIATION),
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
          remediation: DENIED_REMEDIATION,
          evidence: { project: project.name, checkedAt },
        });
        continue;
      }

      const summary = summarizeConfig(config);
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
        teamId: teamId ?? null,
        teamName: teamName ?? null,
        totalProjects: projects.length,
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
