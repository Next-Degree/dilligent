const mockDb = {
  comment: { findMany: jest.fn() },
  attachment: { findMany: jest.fn() },
};

jest.mock('@db', () => ({
  db: mockDb,
  AttachmentEntityType: { task: 'task', comment: 'comment' },
  CommentEntityType: { task: 'task' },
}));

const mockAppendAttachment = jest.fn();
jest.mock('./evidence-attachment-streamer', () => ({
  appendAttachmentToArchive: (params: {
    attachment: { name: string; url: string };
    uniqueName: (raw: string) => string;
  }) => {
    mockAppendAttachment(params);
    const missing = params.attachment.url === 'gone';
    params.uniqueName(
      missing
        ? `_MISSING_${params.attachment.name}.txt`
        : params.attachment.name,
    );
    return Promise.resolve(missing ? 'missing' : 'written');
  },
  createFilenameTracker: () => {
    const used = new Set<string>();
    return (raw: string) => {
      let name = raw;
      let i = 1;
      while (used.has(name)) name = `${raw} (${i++})`;
      used.add(name);
      return name;
    };
  },
}));

import {
  appendTaskCommentsToArchive,
  buildCommentsText,
  getTaskComments,
  type TaskComment,
} from './evidence-comments';

function makeArchive() {
  return { append: jest.fn() };
}

const at = new Date('2026-03-01T10:00:00.000Z');

describe('getTaskComments', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns [] without querying attachments when the task has no comments', async () => {
    mockDb.comment.findMany.mockResolvedValue([]);

    await expect(
      getTaskComments({ organizationId: 'org_1', taskId: 'tsk_1' }),
    ).resolves.toEqual([]);
    expect(mockDb.attachment.findMany).not.toHaveBeenCalled();
  });

  it('scopes both queries to the org and groups files under their comment', async () => {
    mockDb.comment.findMany.mockResolvedValue([
      {
        id: 'cmt_1',
        content: 'first',
        createdAt: at,
        author: { user: { name: 'Jane Doe', email: 'jane@x.com' } },
      },
      {
        id: 'cmt_2',
        content: 'second',
        createdAt: at,
        author: { user: { name: '', email: 'bob@x.com' } },
      },
    ]);
    mockDb.attachment.findMany.mockResolvedValue([
      {
        id: 'att_1',
        name: 'log.csv',
        url: 'k1',
        type: 'document',
        createdAt: at,
        entityId: 'cmt_1',
      },
    ]);

    const comments = await getTaskComments({
      organizationId: 'org_1',
      taskId: 'tsk_1',
    });

    expect(mockDb.comment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organizationId: 'org_1',
          entityType: 'task',
          entityId: 'tsk_1',
        },
      }),
    );
    expect(mockDb.attachment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organizationId: 'org_1',
          entityType: 'comment',
          entityId: { in: ['cmt_1', 'cmt_2'] },
        },
      }),
    );
    expect(comments[0].authorName).toBe('Jane Doe');
    expect(comments[0].attachments).toEqual([
      {
        id: 'att_1',
        name: 'log.csv',
        url: 'k1',
        type: 'document',
        createdAt: at,
      },
    ]);
    expect(comments[1].authorName).toBe('bob@x.com');
    expect(comments[1].attachments).toEqual([]);
  });
});

describe('appendTaskCommentsToArchive', () => {
  beforeEach(() => jest.clearAllMocks());

  const comments: TaskComment[] = [
    {
      id: 'cmt_1',
      content: 'Evidence for Q1',
      createdAt: at,
      authorName: 'Jane Doe',
      attachments: [
        {
          id: 'att_1',
          name: 'report.pdf',
          url: 'k1',
          type: 'document',
          createdAt: at,
        },
      ],
    },
    {
      id: 'cmt_2',
      content: 'Evidence for Q2',
      createdAt: at,
      authorName: 'Jane Doe',
      attachments: [
        {
          id: 'att_2',
          name: 'report.pdf',
          url: 'k2',
          type: 'document',
          createdAt: at,
        },
      ],
    },
  ];

  it('writes nothing when there are no comments', async () => {
    const archive = makeArchive();
    const stats = await appendTaskCommentsToArchive({
      archive,
      taskTitle: 'Task',
      comments: [],
      folderPath: 'task/02-comments',
    });

    expect(stats).toEqual({
      comments: 0,
      commentAttachments: 0,
      commentAttachmentsMissing: 0,
    });
    expect(archive.append).not.toHaveBeenCalled();
  });

  it('streams files into attachments/ and lists their final names in comments.txt', async () => {
    const archive = makeArchive();
    const stats = await appendTaskCommentsToArchive({
      archive,
      taskTitle: 'Access Review',
      comments,
      folderPath: 'task/02-comments',
    });

    expect(stats).toEqual({
      comments: 2,
      commentAttachments: 2,
      commentAttachmentsMissing: 0,
    });
    expect(mockAppendAttachment).toHaveBeenCalledTimes(2);
    expect(mockAppendAttachment.mock.calls[0][0].folderPath).toBe(
      'task/02-comments/attachments',
    );

    const [buffer, options] = archive.append.mock.calls[0];
    expect(options).toEqual({ name: 'task/02-comments/comments.txt' });
    const text = (buffer as Buffer).toString('utf-8');
    expect(text).toContain('Comments for task: Access Review');
    expect(text).toContain('2026-03-01T10:00:00.000Z  Jane Doe');
    expect(text).toContain('* attachments/report.pdf');
    // Duplicate filenames are disambiguated, and the text points at the real entry.
    expect(text).toContain('* attachments/report.pdf (1)');
  });

  it('counts a file whose stored copy is gone as missing and points at its placeholder', async () => {
    const archive = makeArchive();
    const stats = await appendTaskCommentsToArchive({
      archive,
      taskTitle: 'Access Review',
      comments: [
        {
          ...comments[0],
          attachments: [{ ...comments[0].attachments[0], url: 'gone' }],
        },
      ],
      folderPath: 'task/02-comments',
    });

    expect(stats).toEqual({
      comments: 1,
      commentAttachments: 0,
      commentAttachmentsMissing: 1,
    });
    const text = (archive.append.mock.calls[0][0] as Buffer).toString('utf-8');
    expect(text).toContain('* attachments/_MISSING_report.pdf.txt');
  });
});

describe('buildCommentsText', () => {
  it('marks empty comments and falls back to the raw file name', () => {
    const text = buildCommentsText({
      taskTitle: 'T',
      comments: [
        {
          id: 'c',
          content: '',
          createdAt: at,
          authorName: 'A',
          attachments: [
            { id: 'a', name: 'x.png', url: 'k', type: 'image', createdAt: at },
          ],
        },
      ],
      fileNames: new Map(),
    });

    expect(text).toContain('(no text)');
    expect(text).toContain('* x.png');
  });
});
