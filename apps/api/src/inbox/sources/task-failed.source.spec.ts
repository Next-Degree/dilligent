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
const RUN_AT = new Date('2026-09-20T06:04:00Z');
const UPDATED_AT = new Date('2026-09-22T06:05:00Z');

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

  it('maps a failed task using its most recent failed check run', async () => {
    dbMock.task.findMany.mockResolvedValue([
      {
        id: 'tsk_1',
        title: 'Enforce MFA on all admin accounts',
        assigneeId: 'mem_2',
        updatedAt: UPDATED_AT,
        integrationCheckRuns: [
          { failedCount: 3, completedAt: RUN_AT, createdAt: RUN_AT },
        ],
      },
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
        detail: '3 failing results in its most recent failed check',
        path: 'tasks/tsk_1',
        occurredAt: RUN_AT,
        assigneeMemberId: 'mem_2',
      },
    ]);
  });

  it('uses the singular noun for one failing result', async () => {
    dbMock.task.findMany.mockResolvedValue([
      {
        id: 'tsk_1',
        title: 'T',
        assigneeId: null,
        updatedAt: UPDATED_AT,
        integrationCheckRuns: [
          { failedCount: 1, completedAt: null, createdAt: RUN_AT },
        ],
      },
    ]);

    const { items } = await taskFailedSource.collect({
      organizationId: ORG,
      limit: 10,
      auth: auth(),
    });

    expect(items[0].detail).toBe(
      '1 failing result in its most recent failed check',
    );
    expect(items[0].occurredAt).toBe(RUN_AT);
  });

  it('falls back to the task itself when no failed check run exists', async () => {
    dbMock.task.findMany.mockResolvedValue([
      {
        id: 'tsk_1',
        title: 'T',
        assigneeId: null,
        updatedAt: UPDATED_AT,
        integrationCheckRuns: [],
      },
    ]);

    const { items } = await taskFailedSource.collect({
      organizationId: ORG,
      limit: 10,
      auth: auth(),
    });

    expect(items[0].detail).toBe('Marked as failed');
    expect(items[0].occurredAt).toBe(UPDATED_AT);
  });
});
