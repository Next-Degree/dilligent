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

jest.mock('./evidence-browser-runs', () => ({
  EXPORTABLE_RUN_STATUSES: ['completed', 'failed', 'blocked'],
}));

import { findTasksWithEvidence, inBatches } from './evidence-task-discovery';

function primeAttachments({
  task = [] as Array<{ entityId: string }>,
  comment = [] as Array<{ entityId: string }>,
}) {
  mockDb.attachment.findMany.mockImplementation(
    (args: { where: { entityType: string } }) =>
      Promise.resolve(args.where.entityType === 'comment' ? comment : task),
  );
}

function primeTasks({ withRuns = [] as string[], existing = [] as string[] }) {
  mockDb.task.findMany.mockImplementation(
    (args: { where: { id?: { in: string[] } } }) =>
      Promise.resolve(
        args.where.id
          ? args.where.id.in
              .filter((id) => existing.includes(id))
              .map((id) => ({ id }))
          : withRuns.map((id) => ({ id })),
      ),
  );
}

describe('findTasksWithEvidence', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    primeTasks({});
    mockDb.comment.findMany.mockResolvedValue([]);
  });

  it('counts tasks with finished browser automation runs', async () => {
    primeAttachments({});
    primeTasks({ withRuns: ['tsk_browser'] });

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
    primeTasks({ existing: ['tsk_cmt'] });

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

  it('drops deleted tasks still referenced by leftover attachments or comments', async () => {
    primeAttachments({
      task: [{ entityId: 'tsk_alive' }, { entityId: 'tsk_deleted_a' }],
      comment: [{ entityId: 'cmt_1' }],
    });
    mockDb.comment.findMany.mockResolvedValue([{ entityId: 'tsk_deleted_b' }]);
    primeTasks({ existing: ['tsk_alive'] });

    await expect(findTasksWithEvidence('org_1')).resolves.toEqual([
      'tsk_alive',
    ]);
    expect(mockDb.task.findMany).toHaveBeenLastCalledWith({
      where: {
        organizationId: 'org_1',
        id: { in: ['tsk_alive', 'tsk_deleted_a', 'tsk_deleted_b'] },
      },
      select: { id: true },
    });
  });

  it('does not re-check tasks already found through runs, and de-duplicates', async () => {
    primeAttachments({ task: [{ entityId: 'tsk_1' }] });
    primeTasks({ withRuns: ['tsk_1', 'tsk_2'] });

    await expect(findTasksWithEvidence('org_1')).resolves.toEqual([
      'tsk_1',
      'tsk_2',
    ]);
    expect(mockDb.comment.findMany).not.toHaveBeenCalled();
    expect(mockDb.task.findMany).toHaveBeenCalledTimes(1);
  });
});

describe('inBatches', () => {
  it('splits long ID lists to stay under the Postgres parameter limit', () => {
    const ids = Array.from({ length: 25_001 }, (_, i) => `tsk_${i}`);

    const batches = inBatches(ids);

    expect(batches.map((b) => b.length)).toEqual([10_000, 10_000, 5_001]);
    expect(batches.flat()).toEqual(ids);
  });

  it('returns no batches for an empty list', () => {
    expect(inBatches([])).toEqual([]);
  });
});

describe('findTasksWithEvidence batching', () => {
  beforeEach(() => jest.clearAllMocks());

  it('queries comments and the existence check in batches', async () => {
    const commentFiles = Array.from({ length: 10_001 }, (_, i) => ({
      entityId: `cmt_${i}`,
    }));
    primeAttachments({ comment: commentFiles });
    mockDb.comment.findMany.mockResolvedValue([]);
    primeTasks({});

    await findTasksWithEvidence('org_1');

    expect(mockDb.comment.findMany).toHaveBeenCalledTimes(2);
    expect(mockDb.comment.findMany.mock.calls[1][0].where.id.in).toEqual([
      'cmt_10000',
    ]);
  });
});
