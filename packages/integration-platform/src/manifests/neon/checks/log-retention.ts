import { TASK_TEMPLATES } from '../../../task-mappings';
import type { CheckContext, IntegrationCheck } from '../../../types';
import { toHttpReadFailure } from '../../http-read-failure';
import { API_VERIFIED } from '../attestation';
import { fetchNeonBackupSchedule, listNeonBranches, pickDefaultBranch } from '../client';
import { limitProjects, projectEvidence, resolveNeonScope } from '../scope';
import type { NeonProject } from '../types';
import {
  MAX_HISTORY_RETENTION_DAYS,
  minimumRetentionDaysVariable,
  parseRetentionDays,
  projectScopeVariables,
} from '../variables';

const SECONDS_PER_DAY = 86_400;

const toDays = (seconds: number | null | undefined): number | null =>
  typeof seconds === 'number' && Number.isFinite(seconds)
    ? Math.round((seconds / SECONDS_PER_DAY) * 10) / 10
    : null;

interface RetentionReading {
  historySeconds: number | null;
  snapshotSeconds: number | null;
  /** Why the snapshot side is missing, when it is — a plan gate reads differently from an outage. */
  snapshotError: string | null;
}

/**
 * The longest window Neon is holding recoverable history for. Either source
 * satisfies "retained for at least N days": the restore history is a
 * continuous change log, and scheduled snapshots are point copies retained on
 * their own clock. Recording both, and naming which one carried the result,
 * keeps the number auditable rather than a bare boolean.
 */
function effectiveRetention(reading: RetentionReading): {
  seconds: number | null;
  source: 'restore-history' | 'snapshot-schedule' | null;
} {
  const history = reading.historySeconds ?? -1;
  const snapshot = reading.snapshotSeconds ?? -1;
  if (history < 0 && snapshot < 0) return { seconds: null, source: null };
  return history >= snapshot
    ? { seconds: history, source: 'restore-history' }
    : { seconds: snapshot, source: 'snapshot-schedule' };
}

async function readRetention(ctx: CheckContext, project: NeonProject): Promise<RetentionReading> {
  const historySeconds =
    typeof project.history_retention_seconds === 'number'
      ? project.history_retention_seconds
      : null;

  try {
    const branches = await listNeonBranches(ctx, project.id);
    const branch = pickDefaultBranch(branches);
    if (!branch) return { historySeconds, snapshotSeconds: null, snapshotError: 'no branches' };

    const { schedule } = await fetchNeonBackupSchedule(ctx, project.id, branch.id);
    const retentions = (schedule ?? [])
      .map((entry) => entry.retention_seconds)
      .filter((value): value is number => typeof value === 'number');

    return {
      historySeconds,
      snapshotSeconds: retentions.length > 0 ? Math.max(...retentions) : null,
      snapshotError: null,
    };
  } catch (error) {
    // Snapshots are plan-gated, so a denial here is a missing signal rather
    // than a broken run — the restore history still answers the question.
    return { historySeconds, snapshotSeconds: null, snapshotError: toHttpReadFailure(error).error };
  }
}

/**
 * Logs Retained for at Least 28 Days (Neon)
 *
 * Neon's audit-log retention is set contractually (in the BAA) and is not
 * readable through the API, so this check measures the retention Neon does
 * expose per project: the point-in-time restore history window, and the
 * retention on the branch's scheduled snapshots. Both are recorded; the longer
 * one decides the result.
 *
 * Maps to: Backup logs
 */
export const logRetentionCheck: IntegrationCheck = {
  id: 'log-retention',
  name: 'Logs Retained for at Least 28 Days',
  description:
    'Verify each Neon project retains restore history or scheduled snapshots for the required number of days',
  service: 'logging',
  taskMapping: TASK_TEMPLATES.backupLogs,
  defaultSeverity: 'medium',
  variables: [...projectScopeVariables, minimumRetentionDaysVariable],

  run: async (ctx: CheckContext) => {
    const requiredDays = parseRetentionDays(ctx.variables);
    const requiredSeconds = requiredDays * SECONDS_PER_DAY;
    ctx.log(`Starting Neon retention check (minimum ${requiredDays} day(s))`);

    const scope = await resolveNeonScope(ctx);
    if (!scope) return;

    const projects = limitProjects(ctx, scope);
    let compliantCount = 0;

    for (const project of projects) {
      const name = project.name ?? project.id;
      const reading = await readRetention(ctx, project);
      const effective = effectiveRetention(reading);

      const evidence = {
        verification: API_VERIFIED,
        ...projectEvidence(project),
        requiredDays,
        historyRetentionSeconds: reading.historySeconds,
        historyRetentionDays: toDays(reading.historySeconds),
        snapshotRetentionSeconds: reading.snapshotSeconds,
        snapshotRetentionDays: toDays(reading.snapshotSeconds),
        snapshotReadError: reading.snapshotError,
        effectiveRetentionDays: toDays(effective.seconds),
        satisfiedBy: effective.source,
        auditLogRetentionNote:
          'Neon retains console/API audit logs for the duration set in your agreement with Neon; that period is not exposed by the API and is not measured here.',
        checkedAt: scope.checkedAt,
      };

      if (effective.seconds === null) {
        ctx.fail({
          title: `Retention unknown: ${name}`,
          description: `Neon returned neither a restore history window nor a snapshot retention for "${name}", so retained history cannot be evidenced.`,
          resourceType: 'neon_project',
          resourceId: project.id,
          severity: 'medium',
          remediation:
            'Confirm the Neon API key still has access to this project and re-run the check.',
          evidence,
        });
        continue;
      }

      if (effective.seconds >= requiredSeconds) {
        compliantCount++;
        ctx.pass({
          title: `Retention meets ${requiredDays} days: ${name}`,
          description: `Neon retains ${toDays(effective.seconds)} day(s) of history for this project via its ${effective.source === 'restore-history' ? 'point-in-time restore window' : 'scheduled snapshots'}.`,
          resourceType: 'neon_project',
          resourceId: project.id,
          evidence,
        });
        continue;
      }

      ctx.fail({
        title: `Retention below ${requiredDays} days: ${name}`,
        description: `Neon retains only ${toDays(effective.seconds)} day(s) of history for "${name}", short of the ${requiredDays} day(s) required.`,
        resourceType: 'neon_project',
        resourceId: project.id,
        severity: 'medium',
        remediation: `Raise the restore window in Neon Console > Project settings > Storage (up to ${MAX_HISTORY_RETENTION_DAYS} days on the Scale plan), or raise \`retention_seconds\` on the branch's backup schedule so scheduled snapshots are kept for at least ${requiredDays} days.`,
        evidence,
      });
    }

    ctx.log(
      `Neon retention check complete: ${compliantCount}/${projects.length} project(s) meet ${requiredDays} days`,
    );
  },
};
