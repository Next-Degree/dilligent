/**
 * Task comments for the evidence export.
 *
 * Teams often upload evidence as comment attachments instead of the task's
 * Attachments area, so the export ships the comment thread as plain text plus
 * every file attached to a comment. The built-in auditor role can already read
 * these in the app (task:read); the export itself is gated by evidence:read.
 */

import { AttachmentEntityType, CommentEntityType, db } from '@db';
import {
  appendAttachmentToArchive,
  createFilenameTracker,
  type ArchiveSink,
  type TaskAttachment,
} from './evidence-attachment-streamer';
import { commentContentToText } from './evidence-comment-text';

export interface TaskComment {
  id: string;
  content: string;
  createdAt: Date;
  authorName: string;
  attachments: TaskAttachment[];
}

export interface CommentsArchiveStats {
  comments: number;
  commentAttachments: number;
  commentAttachmentsMissing: number;
}

export async function getTaskComments({
  organizationId,
  taskId,
}: {
  organizationId: string;
  taskId: string;
}): Promise<TaskComment[]> {
  const comments = await db.comment.findMany({
    where: {
      organizationId,
      entityType: CommentEntityType.task,
      entityId: taskId,
    },
    select: {
      id: true,
      content: true,
      createdAt: true,
      author: { select: { user: { select: { name: true, email: true } } } },
    },
    orderBy: { createdAt: 'asc' },
  });

  if (comments.length === 0) return [];

  // Comment files are stored polymorphically (entityType=comment,
  // entityId=<comment id>), matching CommentsService.uploadAttachment.
  const attachments = await db.attachment.findMany({
    where: {
      organizationId,
      entityType: AttachmentEntityType.comment,
      entityId: { in: comments.map((comment) => comment.id) },
    },
    select: {
      id: true,
      name: true,
      url: true,
      type: true,
      createdAt: true,
      entityId: true,
    },
    orderBy: { createdAt: 'asc' },
  });

  const byComment = new Map<string, TaskAttachment[]>();
  for (const { entityId, ...attachment } of attachments) {
    const list = byComment.get(entityId) ?? [];
    list.push(attachment);
    byComment.set(entityId, list);
  }

  return comments.map((comment) => ({
    id: comment.id,
    content: comment.content,
    createdAt: comment.createdAt,
    authorName:
      comment.author?.user?.name || comment.author?.user?.email || 'Unknown',
    attachments: byComment.get(comment.id) ?? [],
  }));
}

export function buildCommentsText({
  taskTitle,
  comments,
  fileNames,
}: {
  taskTitle: string;
  comments: TaskComment[];
  fileNames: Map<string, string>;
}): string {
  const divider = '='.repeat(60);
  const lines = [
    `Comments for task: ${taskTitle}`,
    `Total comments: ${comments.length}`,
    'Times are UTC.',
    '',
  ];

  for (const comment of comments) {
    lines.push(divider);
    lines.push(`${comment.createdAt.toISOString()}  ${comment.authorName}`);
    lines.push('');
    lines.push(commentContentToText(comment.content) || '(no text)');

    if (comment.attachments.length > 0) {
      lines.push('');
      lines.push('Attached files:');
      for (const attachment of comment.attachments) {
        lines.push(`  * ${fileNames.get(attachment.id) ?? attachment.name}`);
      }
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Writes `<folderPath>/comments.txt` and streams comment files into
 * `<folderPath>/attachments/`. Missing S3 objects become `_MISSING_` placeholders
 * (same rules as task attachments) and are counted separately; other S3
 * failures throw.
 */
export async function appendTaskCommentsToArchive({
  archive,
  taskTitle,
  comments,
  folderPath,
}: {
  archive: ArchiveSink;
  taskTitle: string;
  comments: TaskComment[];
  folderPath: string;
}): Promise<CommentsArchiveStats> {
  const stats: CommentsArchiveStats = {
    comments: comments.length,
    commentAttachments: 0,
    commentAttachmentsMissing: 0,
  };
  if (comments.length === 0) return stats;

  const tracker = createFilenameTracker();
  const fileNames = new Map<string, string>();

  for (const comment of comments) {
    for (const attachment of comment.attachments) {
      let entryName = '';
      const result = await appendAttachmentToArchive({
        archive,
        attachment,
        folderPath: `${folderPath}/attachments`,
        uniqueName: (rawName) => {
          entryName = tracker(rawName);
          return entryName;
        },
      });
      fileNames.set(attachment.id, `attachments/${entryName}`);
      if (result === 'missing') stats.commentAttachmentsMissing += 1;
      else stats.commentAttachments += 1;
    }
  }

  archive.append(
    Buffer.from(buildCommentsText({ taskTitle, comments, fileNames }), 'utf-8'),
    { name: `${folderPath}/comments.txt` },
  );

  return stats;
}
