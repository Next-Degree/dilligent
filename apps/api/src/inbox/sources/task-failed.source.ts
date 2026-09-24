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

function summarizeFailure(
  task: FailedTask,
): Pick<InboxItem, 'detail' | 'occurredAt'> {
  const run = task.integrationCheckRuns[0];
  if (!run) {
    return { detail: 'Marked as failed', occurredAt: task.updatedAt };
  }
  const noun = run.failedCount === 1 ? 'result' : 'results';
  return {
    detail: `${run.failedCount} failing ${noun} in its most recent failed check`,
    occurredAt: run.completedAt ?? run.createdAt,
  };
}

/** Tasks in `failed` — almost always an integration check that went red. */
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
            where: { failedCount: { gt: 0 } },
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
