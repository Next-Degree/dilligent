import { describe, expect, it } from 'bun:test';
import { dailyBackupsCheck, logRetentionCheck } from '../checks';
import type { NeonFixture } from './harness';
import { findByResourceId, httpError, makeBranch, makeNeonContext, makeProject } from './harness';

const DAY = 86_400;

const withBranch = (overrides: Partial<NeonFixture> = {}): NeonFixture => ({
  organizations: [],
  projects: [makeProject({ id: 'prj-a', name: 'alpha' })],
  branches: { 'prj-a': [makeBranch({ id: 'br-main', name: 'main' })] },
  ...overrides,
});

describe('dailyBackupsCheck', () => {
  it('passes when the default branch has a daily schedule', async () => {
    const recorded = makeNeonContext(
      withBranch({
        backupSchedule: {
          'prj-a:br-main': [{ frequency: 'daily', hour: 3, retention_seconds: 35 * DAY }],
        },
      }),
    );
    await dailyBackupsCheck.run(recorded.ctx);

    const result = findByResourceId(recorded.passes, 'prj-a');
    expect(result?.title).toBe('Daily backups enabled: alpha');
    expect(result?.description).toContain('03:00 UTC');
    expect(result?.evidence).toMatchObject({
      verification: 'api-verified',
      branchName: 'main',
      schedule: [{ frequency: 'daily', retentionDays: 35 }],
    });
    expect(recorded.fails).toHaveLength(0);
  });

  it('fails when backups exist but none are daily, naming what is scheduled', async () => {
    const recorded = makeNeonContext(
      withBranch({ backupSchedule: { 'prj-a:br-main': [{ frequency: 'weekly', day: 1 }] } }),
    );
    await dailyBackupsCheck.run(recorded.ctx);

    const failure = findByResourceId(recorded.fails, 'prj-a');
    expect(failure?.title).toBe('No daily backups: alpha');
    expect(failure?.description).toContain('weekly');
  });

  it('fails when no schedule is configured at all', async () => {
    const recorded = makeNeonContext(withBranch({ backupSchedule: { 'prj-a:br-main': [] } }));
    await dailyBackupsCheck.run(recorded.ctx);

    expect(findByResourceId(recorded.fails, 'prj-a')?.description).toContain(
      'No backup schedule is configured',
    );
  });

  it('picks the default branch even when it is not returned first', async () => {
    const recorded = makeNeonContext(
      withBranch({
        branches: {
          'prj-a': [
            makeBranch({ id: 'br-dev', name: 'dev', default: false }),
            makeBranch({ id: 'br-main', name: 'main', default: true }),
          ],
        },
        backupSchedule: { 'prj-a:br-main': [{ frequency: 'daily' }] },
      }),
    );
    await dailyBackupsCheck.run(recorded.ctx);

    expect(findByResourceId(recorded.passes, 'prj-a')?.evidence).toMatchObject({
      branchId: 'br-main',
      branchCount: 2,
    });
  });

  it('honours the deprecated `primary` flag on older projects', async () => {
    const recorded = makeNeonContext(
      withBranch({
        branches: {
          'prj-a': [
            makeBranch({ id: 'br-dev', name: 'dev', default: undefined }),
            makeBranch({ id: 'br-legacy', name: 'legacy', default: undefined, primary: true }),
          ],
        },
        backupSchedule: { 'prj-a:br-legacy': [{ frequency: 'daily' }] },
      }),
    );
    await dailyBackupsCheck.run(recorded.ctx);

    expect(findByResourceId(recorded.passes, 'prj-a')?.evidence).toMatchObject({
      branchId: 'br-legacy',
    });
  });

  it('fails fast when no branch is flagged default, instead of guessing one', async () => {
    // br-dev sorts first and HAS a daily schedule; br-main does not. Guessing
    // branches[0] would pass a project whose production branch is unprotected.
    const recorded = makeNeonContext(
      withBranch({
        branches: {
          'prj-a': [
            makeBranch({ id: 'br-dev', name: 'dev', default: undefined }),
            makeBranch({ id: 'br-main', name: 'main', default: undefined }),
          ],
        },
        backupSchedule: { 'prj-a:br-dev': [{ frequency: 'daily' }] },
      }),
    );
    await dailyBackupsCheck.run(recorded.ctx);

    const failure = findByResourceId(recorded.fails, 'prj-a');
    expect(failure?.title).toBe('No default branch: alpha');
    expect(failure?.remediation).toContain('set_as_default');
    expect(failure?.evidence).toMatchObject({
      branchCount: 2,
      branchIds: ['br-dev', 'br-main'],
    });
    expect(recorded.passes).toHaveLength(0);
  });

  it('still reports the empty-project case distinctly from an unflagged one', async () => {
    const recorded = makeNeonContext(withBranch({ branches: { 'prj-a': [] } }));
    await dailyBackupsCheck.run(recorded.ctx);

    const failure = findByResourceId(recorded.fails, 'prj-a');
    expect(failure?.title).toBe('No branch to back up: alpha');
    expect(failure?.evidence).toMatchObject({ branchCount: 0 });
  });

  it('reports unknown rather than compliant when the schedule cannot be read', async () => {
    const recorded = makeNeonContext(
      withBranch({ backupSchedule: { 'prj-a:br-main': httpError(403) } }),
    );
    await dailyBackupsCheck.run(recorded.ctx);

    expect(findByResourceId(recorded.fails, 'prj-a')?.title).toBe('Backup schedule unknown: alpha');
    expect(recorded.passes).toHaveLength(0);
  });
});

describe('logRetentionCheck', () => {
  const runRetention = async (fixture: NeonFixture, days?: number) => {
    const recorded = makeNeonContext(
      fixture,
      days === undefined ? undefined : { minimum_retention_days: days },
    );
    await logRetentionCheck.run(recorded.ctx);
    return recorded;
  };

  it('passes on a restore history window that meets the default 28 days', async () => {
    const recorded = await runRetention(
      withBranch({
        projects: [
          makeProject({ id: 'prj-a', name: 'alpha', history_retention_seconds: 30 * DAY }),
        ],
        backupSchedule: { 'prj-a:br-main': [] },
      }),
    );

    const result = findByResourceId(recorded.passes, 'prj-a');
    expect(result?.title).toBe('Retention meets 28 days: alpha');
    expect(result?.evidence).toMatchObject({
      historyRetentionDays: 30,
      effectiveRetentionDays: 30,
      satisfiedBy: 'restore-history',
    });
  });

  it('passes on snapshot retention when the restore window alone falls short', async () => {
    const recorded = await runRetention(
      withBranch({
        projects: [makeProject({ id: 'prj-a', name: 'alpha', history_retention_seconds: DAY })],
        backupSchedule: {
          'prj-a:br-main': [{ frequency: 'daily', retention_seconds: 35 * DAY }],
        },
      }),
    );

    expect(findByResourceId(recorded.passes, 'prj-a')?.evidence).toMatchObject({
      historyRetentionDays: 1,
      snapshotRetentionDays: 35,
      satisfiedBy: 'snapshot-schedule',
    });
  });

  it('fails when neither window reaches the threshold', async () => {
    const recorded = await runRetention(
      withBranch({
        projects: [makeProject({ id: 'prj-a', name: 'alpha', history_retention_seconds: 7 * DAY })],
        backupSchedule: { 'prj-a:br-main': [{ frequency: 'daily', retention_seconds: 7 * DAY }] },
      }),
    );

    const failure = findByResourceId(recorded.fails, 'prj-a');
    expect(failure?.title).toBe('Retention below 28 days: alpha');
    expect(failure?.evidence).toMatchObject({ effectiveRetentionDays: 7, requiredDays: 28 });
  });

  it('honours a configured threshold', async () => {
    const recorded = await runRetention(
      withBranch({
        projects: [makeProject({ id: 'prj-a', name: 'alpha', history_retention_seconds: 7 * DAY })],
        backupSchedule: { 'prj-a:br-main': [] },
      }),
      7,
    );

    expect(findByResourceId(recorded.passes, 'prj-a')?.title).toBe('Retention meets 7 days: alpha');
  });

  it('says a threshold above the snapshot ceiling is unreachable, not just unmet', async () => {
    // Neon caps retention_seconds at 3,024,000 (35d) and the restore window
    // below that, so a 40-day bar can never be cleared by configuration.
    const recorded = await runRetention(
      withBranch({
        projects: [
          makeProject({ id: 'prj-a', name: 'alpha', history_retention_seconds: 30 * DAY }),
        ],
        backupSchedule: { 'prj-a:br-main': [{ frequency: 'daily', retention_seconds: 35 * DAY }] },
      }),
      40,
    );

    const failure = findByResourceId(recorded.fails, 'prj-a');
    expect(failure?.title).toBe('Retention below 40 days: alpha');
    expect(failure?.remediation).toContain('No Neon setting can reach 40 days');
    expect(failure?.remediation).toContain('Lower the threshold');
  });

  it('gives the ordinary raise-it remediation when the threshold is reachable', async () => {
    const recorded = await runRetention(
      withBranch({
        projects: [makeProject({ id: 'prj-a', name: 'alpha', history_retention_seconds: 7 * DAY })],
        backupSchedule: { 'prj-a:br-main': [] },
      }),
    );

    const failure = findByResourceId(recorded.fails, 'prj-a');
    expect(failure?.remediation).toContain('Raise the restore window');
    expect(failure?.remediation).not.toContain('No Neon setting can reach');
  });

  it('falls back to the restore window when snapshots are plan-gated, recording why', async () => {
    const recorded = await runRetention(
      withBranch({
        projects: [
          makeProject({ id: 'prj-a', name: 'alpha', history_retention_seconds: 30 * DAY }),
        ],
        backupSchedule: { 'prj-a:br-main': httpError(403, 'Upgrade required') },
      }),
    );

    const result = findByResourceId(recorded.passes, 'prj-a');
    expect(result?.evidence.snapshotReadError).toContain('403');
    expect(result?.evidence).toMatchObject({ satisfiedBy: 'restore-history' });
  });

  it("names the missing default branch rather than reading another branch's snapshots", async () => {
    const recorded = await runRetention(
      withBranch({
        projects: [
          makeProject({ id: 'prj-a', name: 'alpha', history_retention_seconds: 30 * DAY }),
        ],
        branches: {
          'prj-a': [makeBranch({ id: 'br-dev', name: 'dev', default: undefined })],
        },
      }),
    );

    const result = findByResourceId(recorded.passes, 'prj-a');
    expect(result?.evidence.snapshotReadError).toBe('no default branch flagged among 1 branch(es)');
    expect(result?.evidence).toMatchObject({ satisfiedBy: 'restore-history' });
  });

  it('reports unknown when Neon returns no retention figure at all', async () => {
    const recorded = await runRetention(
      withBranch({
        projects: [
          makeProject({ id: 'prj-a', name: 'alpha', history_retention_seconds: undefined }),
        ],
        backupSchedule: { 'prj-a:br-main': [] },
      }),
    );

    expect(findByResourceId(recorded.fails, 'prj-a')?.title).toBe('Retention unknown: alpha');
  });

  it('states that Neon audit-log retention is contractual and not measured here', async () => {
    const recorded = await runRetention(
      withBranch({ backupSchedule: { 'prj-a:br-main': [{ retention_seconds: 35 * DAY }] } }),
    );

    expect(findByResourceId(recorded.passes, 'prj-a')?.evidence.auditLogRetentionNote).toContain(
      'not exposed by the API',
    );
  });
});
