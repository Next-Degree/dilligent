import { TASK_TEMPLATES } from '../../../task-mappings';
import type { CheckContext, IntegrationCheck } from '../../../types';
import { remediationForReadFailure, toHttpReadFailure } from '../../http-read-failure';
import { API_VERIFIED } from '../attestation';
import { fetchNeonProject, projectPlan } from '../client';
import { limitProjects, projectEvidence, resolveNeonScope } from '../scope';
import type { NeonProject } from '../types';
import { projectScopeVariables } from '../variables';

/** Values Neon could use to mean "configured, but off". Anything else is a real level. */
const DISABLED_LEVELS: ReadonlySet<string> = new Set(['', 'off', 'none', 'disabled', 'disable']);

const BASE_REMEDIATION =
  'Turn on audit logging for the project in Neon Console > Project settings, or set `settings.audit_log_level` via PATCH /projects/{project_id}.';

/**
 * `GET /projects/{id}` returns `owner.subscription_type`, so a plan-gated
 * failure can name the plan instead of leaving the reader to guess whether
 * the setting is off or simply unavailable.
 */
const remediationForPlan = (plan: string | null): string =>
  plan
    ? `${BASE_REMEDIATION} This project is on the "${plan}" plan; audit logging requires the Scale plan or above.`
    : `${BASE_REMEDIATION} Audit logging requires the Scale plan or above.`;

function readAuditLogLevel(project: NeonProject): string | null {
  const level = project.settings?.audit_log_level;
  if (typeof level !== 'string') return null;
  const normalized = level.trim();
  return DISABLED_LEVELS.has(normalized.toLowerCase()) ? null : normalized;
}

/**
 * Neon Logs Enabled
 *
 * Reads each project's `settings.audit_log_level` from `GET /projects/{id}`.
 *
 * `GET /projects` does return a `settings` object, but `audit_log_level` is
 * absent from its documented shape, so "absent" there cannot be told apart
 * from "not set". This check reads the authoritative per-project record
 * instead and spends one request per project to do it. A project whose
 * settings cannot be read is reported as unknown, never assumed compliant.
 *
 * Note this is Neon's *audit* log level — the record of console and API
 * activity. Neon's separate Logs API (`/logs/query`) serves application
 * telemetry from functions and computes, which is a different control.
 *
 * Maps to: Monitoring & Alerting
 */
export const auditLogsEnabledCheck: IntegrationCheck = {
  id: 'audit-logs-enabled',
  name: 'Logs Enabled',
  description: 'Verify audit logging is enabled on each Neon project',
  service: 'logging',
  taskMapping: TASK_TEMPLATES.monitoringAlerting,
  defaultSeverity: 'medium',
  variables: projectScopeVariables,

  run: async (ctx: CheckContext) => {
    ctx.log('Starting Neon audit logging check');

    const scope = await resolveNeonScope(ctx);
    if (!scope) return;

    const projects = limitProjects(ctx, scope);
    let enabledCount = 0;

    for (const listed of projects) {
      const name = listed.name ?? listed.id;

      let project: NeonProject | null;
      try {
        project = await fetchNeonProject(ctx, listed.id);
      } catch (error) {
        const failure = toHttpReadFailure(error);
        ctx.fail({
          title: `Audit logging status unknown: ${name}`,
          description: `Could not read the project's settings: ${failure.error}`,
          resourceType: 'neon_project',
          resourceId: listed.id,
          severity: 'medium',
          remediation: remediationForReadFailure(
            failure,
            'Confirm the Neon API key still has access to this project, then re-run the check.',
          ),
          evidence: {
            ...projectEvidence(listed),
            error: failure.error,
            denied: failure.denied,
            checkedAt: scope.checkedAt,
          },
        });
        continue;
      }

      if (!project) {
        ctx.fail({
          title: `Audit logging status unknown: ${name}`,
          description: 'Neon returned no project record, so its audit log setting is unknown.',
          resourceType: 'neon_project',
          resourceId: listed.id,
          severity: 'medium',
          remediation: 'Re-run the check. If it persists, confirm the project still exists.',
          evidence: { ...projectEvidence(listed), checkedAt: scope.checkedAt },
        });
        continue;
      }

      const level = readAuditLogLevel(project);
      const evidence = {
        verification: API_VERIFIED,
        ...projectEvidence(project),
        auditLogLevel: project.settings?.audit_log_level ?? null,
        hipaaMode: project.settings?.hipaa ?? null,
        subscriptionType: projectPlan(project),
        ownerName: project.owner?.name ?? null,
        checkedAt: scope.checkedAt,
      };

      if (level) {
        enabledCount++;
        ctx.pass({
          title: `Audit logging enabled: ${name}`,
          description: `Neon records console and API activity for this project at audit log level "${level}".`,
          resourceType: 'neon_project',
          resourceId: project.id,
          evidence,
        });
        continue;
      }

      ctx.fail({
        title: `Audit logging disabled: ${name}`,
        description: `No audit log level is set on Neon project "${name}", so console and API activity is not being recorded for audit.`,
        resourceType: 'neon_project',
        resourceId: project.id,
        severity: 'medium',
        remediation: remediationForPlan(projectPlan(project)),
        evidence,
      });
    }

    ctx.log(
      `Neon audit logging check complete: ${enabledCount}/${projects.length} project(s) with audit logging enabled`,
    );
  },
};
