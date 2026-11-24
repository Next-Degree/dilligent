const mockDb = {
  task: { findMany: jest.fn() },
  attachment: { findMany: jest.fn() },
  comment: { findMany: jest.fn() },
};

jest.mock('@db', () => ({
  db: mockDb,
  AttachmentEntityType: { task: 'task', comment: 'comment' },
  CommentEntityType: { task: 'task' },
}));

jest.mock('./evidence-browser-automations', () => ({
  EXPORTABLE_RUN_STATUSES: ['completed', 'failed', 'blocked'],
}));

import { findTasksWithEvidence } from './evidence-task-discovery';

function primeAttachments({
  task = [] as Array<{ entityId: string }>,
  comment = [] as Array<{ entityId: string }>,
}) {
  mockDb.attachment.findMany.mockImplementation(
    (args: { where: { entityType: string } }) =>
      Promise.resolve(args.where.entityType === 'comment' ? comment : task),
  );
}

describe('findTasksWithEvidence', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDb.task.findMany.mockResolvedValue([]);
    mockDb.comment.findMany.mockResolvedValue([]);
  });

  it('counts tasks with finished browser automation runs', async () => {
    primeAttachments({});
    mockDb.task.findMany.mockResolvedValue([{ id: 'tsk_browser' }]);

    await expect(findTasksWithEvidence('org_1')).resolves.toEqual([
      'tsk_browser',
    ]);

    const { where } = mockDb.task.findMany.mock.calls[0][0];
    expect(where.organizationId).toBe('org_1');
    expect(where.OR).toContainEqual({
      browserAutomations: {
        some: {
          runs: {
            some: { status: { in: ['completed', 'failed', 'blocked'] } },
          },
        },
      },
    });
  });

  it('resolves comment files to their task, scoped to the org and to task comments', async () => {
    primeAttachments({
      comment: [{ entityId: 'cmt_1' }, { entityId: 'cmt_2' }],
    });
    mockDb.comment.findMany.mockResolvedValue([{ entityId: 'tsk_cmt' }]);

    await expect(findTasksWithEvidence('org_1')).resolves.toEqual(['tsk_cmt']);
    expect(mockDb.comment.findMany).toHaveBeenCalledWith({
      where: {
        organizationId: 'org_1',
        entityType: 'task',
        id: { in: ['cmt_1', 'cmt_2'] },
      },
      select: { entityId: true },
    });
  });

  it('skips the comment lookup when no comment has files, and de-duplicates tasks', async () => {
    primeAttachments({ task: [{ entityId: 'tsk_1' }] });
    mockDb.task.findMany.mockResolvedValue([{ id: 'tsk_1' }, { id: 'tsk_2' }]);

    await expect(findTasksWithEvidence('org_1')).resolves.toEqual([
      'tsk_1',
      'tsk_2',
    ]);
    expect(mockDb.comment.findMany).not.toHaveBeenCalled();
  });
});
