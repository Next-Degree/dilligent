import { db, type Prisma } from '@db';
import { buildTaskAssignmentFilter } from '../../utils/assignment-filter';
import type { InboxSource } from '../inbox-source';
import { inboxKey, type InboxItem } from '../inbox.types';

type FailedTask = {
  id: string;
  title: string;
  assigneeId: string | null;
  updatedAt: Date;
  integrationCheckRuns: Array<{
    failedCount: number;
    completedAt: Date | null;
    createdAt: Date;
  }>;
};

/**
 * Describe a failed task from its latest check run, whichever way that run
 * went. Tasks are also failed by evidence automations (see task-schedule), so
 * an older failing run is not assumed to be the cause: when the latest run
 * passed or there is none, the task is just "Marked as failed".
 */
function summarizeFailure(
  task: FailedTask,
): Pick<InboxItem, 'detail' | 'occurredAt'> {
  const run = task.integrationCheckRuns[0];
  const runAt = run ? (run.completedAt ?? run.createdAt) : null;
  // The status write that failed the task bumps updatedAt, so the later of the
  // two is when the failure was last observed.
  const occurredAt = runAt && runAt > task.updatedAt ? runAt : task.updatedAt;

  if (!run || run.failedCount === 0) {
    return { detail: 'Marked as failed', occurredAt };
  }
  const noun = run.failedCount === 1 ? 'result' : 'results';
  return {
    detail: `${run.failedCount} failing ${noun} in its latest check run`,
    occurredAt,
  };
}

/** Tasks in `failed`: set by failing integration checks or evidence automations. */
export const taskFailedSource: InboxSource = {
  kind: 'task-failed',
  requires: [{ resource: 'task', action: 'read' }],

  async collect({ organizationId, limit, auth }) {
    // Same visibility as GET /v1/tasks: restricted roles see only their own.
    const where: Prisma.TaskWhereInput = {
      organizationId,
      status: 'failed',
      archivedAt: null,
      ...buildTaskAssignmentFilter(auth.memberId, auth.userRoles, {
        isApiKey: auth.isApiKey,
      }),
    };

    const [tasks, total] = await Promise.all([
      db.task.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        take: limit,
        select: {
          id: true,
          title: true,
          assigneeId: true,
          updatedAt: true,
          integrationCheckRuns: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { failedCount: true, completedAt: true, createdAt: true },
          },
        },
      }),
      db.task.count({ where }),
    ]);

    const items = tasks.map((task): InboxItem => ({
      key: inboxKey({ kind: 'task-failed', entityId: task.id }),
      kind: 'task-failed',
      severity: 'critical',
      title: task.title,
      path: `tasks/${task.id}`,
      assigneeMemberId: task.assigneeId,
      ...summarizeFailure(task),
    }));

    return { items, total };
  },
};
