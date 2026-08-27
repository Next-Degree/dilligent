import { TASK_TEMPLATES } from '../../../task-mappings';
import type { CheckContext, IntegrationCheck } from '../../../types';
import { remediationForReadFailure, toHttpReadFailure } from '../../http-read-failure';
import { API_VERIFIED } from '../attestation';
import { fetchNeonBackupSchedule, listNeonBranches, pickDefaultBranch } from '../client';
import { limitProjects, projectEvidence, resolveNeonScope } from '../scope';
import type { NeonBackupScheduleEntry, NeonBranch } from '../types';
import { projectScopeVariables } from '../variables';

const SECONDS_PER_DAY = 86_400;

const REMEDIATION =
  "Set a daily backup schedule on the project's default branch in Neon Console > Branches > Backups, or PUT a `daily` entry to /projects/{project_id}/branches/{branch_id}/backup_schedule. Scheduled snapshots require a paid Neon plan.";

const isDaily = (entry: NeonBackupScheduleEntry): boolean =>
  typeof entry.frequency === 'string' && entry.frequency.trim().toLowerCase() === 'daily';

const describeSchedule = (schedule: NeonBackupScheduleEntry[]) =>
  schedule.map((entry) => ({
    frequency: entry.frequency ?? null,
    hour: entry.hour ?? null,
    day: entry.day ?? null,
    month: entry.month ?? null,
    retentionSeconds: entry.retention_seconds ?? null,
    retentionDays:
      typeof entry.retention_seconds === 'number'
        ? Math.round((entry.retention_seconds / SECONDS_PER_DAY) * 10) / 10
        : null,
  }));

const branchEvidence = (branch: NeonBranch) => ({
  branchId: branch.id,
  branchName: branch.name ?? null,
  branchProtected: branch.protected ?? null,
  branchState: branch.current_state ?? null,
});

/**
 * Daily Database Backups (Neon)
 *
 * Reads the backup schedule on each project's default branch and requires a
 * daily entry. The default branch is the one this check evidences — Neon
 * schedules snapshots per branch, and the branch count is recorded so a
 * reviewer can see what else exists.
 *
 * Maps to: Backup logs
 */
export const dailyBackupsCheck: IntegrationCheck = {
  id: 'daily-backups',
  name: 'Daily Database Backups',
  description: "Verify each Neon project's default branch has a daily backup schedule",
  service: 'backups',
  taskMapping: TASK_TEMPLATES.backupLogs,
  defaultSeverity: 'high',
  variables: projectScopeVariables,

  run: async (ctx: CheckContext) => {
    ctx.log('Starting Neon daily backup check');

    const scope = await resolveNeonScope(ctx);
    if (!scope) return;

    const projects = limitProjects(ctx, scope);
    let dailyCount = 0;

    for (const project of projects) {
      const name = project.name ?? project.id;
      const base = { ...projectEvidence(project), checkedAt: scope.checkedAt };

      let branches: NeonBranch[];
      try {
        branches = await listNeonBranches(ctx, project.id);
      } catch (error) {
        const failure = toHttpReadFailure(error);
        ctx.fail({
          title: `Backup schedule unknown: ${name}`,
          description: `Could not list branches for this project: ${failure.error}`,
          resourceType: 'neon_project',
          resourceId: project.id,
          severity: 'medium',
          remediation: remediationForReadFailure(
            failure,
            'Confirm the Neon API key still has access to this project, then re-run the check.',
          ),
          evidence: { ...base, error: failure.error, denied: failure.denied },
        });
        continue;
      }

      const branch = pickDefaultBranch(branches);
      if (!branch) {
        ctx.fail({
          title: `No branch to back up: ${name}`,
          description: `Neon project "${name}" has no branches, so no backup schedule can exist.`,
          resourceType: 'neon_project',
          resourceId: project.id,
          severity: 'medium',
          remediation: 'Confirm this project is still in use; delete it if it is not.',
          evidence: { ...base, branchCount: 0 },
        });
        continue;
      }

      let schedule: NeonBackupScheduleEntry[];
      try {
        schedule = (await fetchNeonBackupSchedule(ctx, project.id, branch.id)).schedule ?? [];
      } catch (error) {
        const failure = toHttpReadFailure(error);
        ctx.fail({
          title: `Backup schedule unknown: ${name}`,
          description: `Could not read the backup schedule for branch "${branch.name ?? branch.id}": ${failure.error}`,
          resourceType: 'neon_project',
          resourceId: project.id,
          severity: 'high',
          remediation: remediationForReadFailure(failure, REMEDIATION),
          evidence: {
            ...base,
            ...branchEvidence(branch),
            error: failure.error,
            denied: failure.denied,
          },
        });
        continue;
      }

      const evidence = {
        verification: API_VERIFIED,
        ...base,
        ...branchEvidence(branch),
        branchCount: branches.length,
        schedule: describeSchedule(schedule),
        historyRetentionSeconds: project.history_retention_seconds ?? null,
      };

      const daily = schedule.find(isDaily);
      if (daily) {
        dailyCount++;
        ctx.pass({
          title: `Daily backups enabled: ${name}`,
          description: `Neon takes a daily snapshot of the default branch "${branch.name ?? branch.id}"${typeof daily.hour === 'number' ? ` at ${String(daily.hour).padStart(2, '0')}:00 UTC` : ''}.`,
          resourceType: 'neon_project',
          resourceId: project.id,
          evidence,
        });
        continue;
      }

      const frequencies = schedule
        .map((entry) => entry.frequency)
        .filter((value): value is string => typeof value === 'string');

      ctx.fail({
        title: `No daily backups: ${name}`,
        description:
          frequencies.length > 0
            ? `The default branch of "${name}" is backed up ${frequencies.join(', ')} — no daily snapshot is scheduled.`
            : `No backup schedule is configured on the default branch of "${name}".`,
        resourceType: 'neon_project',
        resourceId: project.id,
        severity: 'high',
        remediation: REMEDIATION,
        evidence,
      });
    }

    ctx.log(
      `Neon daily backup check complete: ${dailyCount}/${projects.length} project(s) with daily backups`,
    );
  },
};
