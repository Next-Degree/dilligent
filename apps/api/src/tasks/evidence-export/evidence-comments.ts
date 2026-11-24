/**
 * Task comments for the evidence export.
 *
 * Teams often upload evidence as comment attachments instead of the task's
 * Attachments area, so the export ships the comment thread as plain text plus
 * every file attached to a comment. Auditors can already read these comments in
 * the app (task:read), so this adds no new exposure.
 */

import { AttachmentEntityType, CommentEntityType, db } from '@db';
import type { Archiver } from 'archiver';
import {
  appendAttachmentToArchive,
  createFilenameTracker,
  type TaskAttachment,
} from './evidence-attachment-streamer';

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function mentionLabel(attrs: unknown): string {
  if (!isRecord(attrs)) return '';
  if (typeof attrs.label === 'string') return attrs.label;
  return typeof attrs.id === 'string' ? attrs.id : '';
}

const BLOCK_NODE_TYPES = new Set([
  'paragraph',
  'heading',
  'blockquote',
  'codeBlock',
  'bulletList',
  'orderedList',
]);

function renderRichTextNode(node: unknown): string {
  if (Array.isArray(node)) return node.map(renderRichTextNode).join('');
  if (!isRecord(node)) return '';

  if (node.type === 'text') {
    return typeof node.text === 'string' ? node.text : '';
  }
  if (node.type === 'hardBreak') return '\n';
  if (node.type === 'mention') return `@${mentionLabel(node.attrs)}`;

  const inner = renderRichTextNode(node.content);
  if (node.type === 'listItem') return `- ${inner.trim()}\n`;
  if (typeof node.type === 'string' && BLOCK_NODE_TYPES.has(node.type)) {
    return `${inner}\n`;
  }
  return inner;
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/**
 * Comments are stored either as plain text or as serialized Tiptap JSON.
 * Returns readable plain text for both; anything unrecognised is returned as-is.
 */
export function commentContentToText(content: string): string {
  const parsed = parseJson(content);
  const isRichText =
    (isRecord(parsed) &&
      (parsed.type === 'doc' || Array.isArray(parsed.content))) ||
    (Array.isArray(parsed) && parsed.every(isRecord));

  if (!isRichText) return content;

  return renderRichTextNode(parsed)
    .replace(/\n{3,}/g, '\n\n')
    .trim();
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
 * (same rules as task attachments); other S3 failures throw.
 */
export async function appendTaskCommentsToArchive({
  archive,
  taskTitle,
  comments,
  folderPath,
}: {
  archive: Archiver;
  taskTitle: string;
  comments: TaskComment[];
  folderPath: string;
}): Promise<CommentsArchiveStats> {
  if (comments.length === 0) return { comments: 0, commentAttachments: 0 };

  const tracker = createFilenameTracker();
  const fileNames = new Map<string, string>();
  let commentAttachments = 0;

  for (const comment of comments) {
    for (const attachment of comment.attachments) {
      let entryName = '';
      await appendAttachmentToArchive({
        archive,
        attachment,
        folderPath: `${folderPath}/attachments`,
        uniqueName: (rawName) => {
          entryName = tracker(rawName);
          return entryName;
        },
      });
      fileNames.set(attachment.id, `attachments/${entryName}`);
      commentAttachments += 1;
    }
  }

  archive.append(
    Buffer.from(buildCommentsText({ taskTitle, comments, fileNames }), 'utf-8'),
    { name: `${folderPath}/comments.txt` },
  );

  return { comments: comments.length, commentAttachments };
}
