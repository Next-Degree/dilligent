const dbMock = {
  task: {
    findMany: jest.fn(),
    count: jest.fn(),
  },
};

jest.mock('@db', () => ({ db: dbMock }));

import type { AuthContext } from '../../auth/types';
import { taskFailedSource } from './task-failed.source';

const ORG = 'org_1';
const EARLIER = new Date('2026-06-01T06:00:00Z');
const RECENT = new Date('2026-09-22T06:05:00Z');

function failedTask(
  runs: Array<{
    failedCount: number;
    completedAt: Date | null;
    createdAt: Date;
  }>,
  updatedAt: Date = EARLIER,
) {
  return {
    id: 'tsk_1',
    title: 'Enforce MFA on all admin accounts',
    assigneeId: 'mem_2',
    updatedAt,
    integrationCheckRuns: runs,
  };
}

async function collectOne() {
  const { items } = await taskFailedSource.collect({
    organizationId: ORG,
    limit: 10,
    auth: auth(),
  });
  return items[0];
}

function auth(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    organizationId: ORG,
    authType: 'session',
    isApiKey: false,
    isPlatformAdmin: false,
    userRoles: ['admin'],
    memberId: 'mem_admin',
    ...overrides,
  };
}

describe('taskFailedSource', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    dbMock.task.findMany.mockResolvedValue([]);
    dbMock.task.count.mockResolvedValue(0);
  });

  it('requires task:read', () => {
    expect(taskFailedSource.requires).toEqual([
      { resource: 'task', action: 'read' },
    ]);
  });

  it('queries only failed, unarchived tasks in the caller organization', async () => {
    await taskFailedSource.collect({
      organizationId: ORG,
      limit: 10,
      auth: auth(),
    });

    const { where, take } = dbMock.task.findMany.mock.calls[0][0];
    expect(where).toEqual({
      organizationId: ORG,
      status: 'failed',
      archivedAt: null,
    });
    expect(take).toBe(10);
    expect(dbMock.task.count).toHaveBeenCalledWith({ where });
  });

  it('limits restricted roles to their own tasks, matching GET /v1/tasks', async () => {
    await taskFailedSource.collect({
      organizationId: ORG,
      limit: 10,
      auth: auth({ userRoles: ['employee'], memberId: 'mem_emp' }),
    });

    expect(dbMock.task.findMany.mock.calls[0][0].where).toMatchObject({
      assigneeId: 'mem_emp',
    });
  });

  it('reads the latest check run whatever its result, not the latest failed one', async () => {
    await taskFailedSource.collect({
      organizationId: ORG,
      limit: 10,
      auth: auth(),
    });

    const { integrationCheckRuns } =
      dbMock.task.findMany.mock.calls[0][0].select;
    expect(integrationCheckRuns).toEqual({
      orderBy: { createdAt: 'desc' },
      take: 1,
      select: { failedCount: true, completedAt: true, createdAt: true },
    });
  });

  it('describes a task failed by its latest check run', async () => {
    dbMock.task.findMany.mockResolvedValue([
      failedTask([{ failedCount: 3, completedAt: RECENT, createdAt: RECENT }]),
    ]);
    dbMock.task.count.mockResolvedValue(7);

    const result = await taskFailedSource.collect({
      organizationId: ORG,
      limit: 10,
      auth: auth(),
    });

    expect(result.total).toBe(7);
    expect(result.items).toEqual([
      {
        key: 'v1:task-failed:tsk_1',
        kind: 'task-failed',
        severity: 'critical',
        title: 'Enforce MFA on all admin accounts',
        detail: '3 failing results in its latest check run',
        path: 'tasks/tsk_1',
        occurredAt: RECENT,
        assigneeMemberId: 'mem_2',
      },
    ]);
  });

  it('uses the singular noun and falls back to the run creation time', async () => {
    dbMock.task.findMany.mockResolvedValue([
      failedTask([{ failedCount: 1, completedAt: null, createdAt: RECENT }]),
    ]);

    const item = await collectOne();

    expect(item.detail).toBe('1 failing result in its latest check run');
    expect(item.occurredAt).toBe(RECENT);
  });

  it('does not blame the checks when the latest run passed', async () => {
    // Evidence automations also fail tasks (task-schedule), with checks green.
    dbMock.task.findMany.mockResolvedValue([
      failedTask(
        [{ failedCount: 0, completedAt: EARLIER, createdAt: EARLIER }],
        RECENT,
      ),
    ]);

    const item = await collectOne();

    expect(item.detail).toBe('Marked as failed');
    expect(item.occurredAt).toBe(RECENT);
  });

  it('dates a fresh failure by the status change, not an old failing run', async () => {
    dbMock.task.findMany.mockResolvedValue([
      failedTask(
        [{ failedCount: 3, completedAt: EARLIER, createdAt: EARLIER }],
        RECENT,
      ),
    ]);

    const item = await collectOne();

    expect(item.occurredAt).toBe(RECENT);
  });

  it('falls back to the task itself when it has no check runs', async () => {
    dbMock.task.findMany.mockResolvedValue([failedTask([], RECENT)]);

    const item = await collectOne();

    expect(item.detail).toBe('Marked as failed');
    expect(item.occurredAt).toBe(RECENT);
  });
});
