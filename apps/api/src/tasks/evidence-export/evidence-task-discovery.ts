/**
 * Finds every task in an org that has something the evidence export can ship.
 * Must stay in sync with hasExportableEvidence (evidence-task-archive.ts):
 * each source here is a source that function counts.
 */

import { AttachmentEntityType, CommentEntityType, db } from '@db';
import { EXPORTABLE_RUN_STATUSES } from './evidence-browser-automations';

export async function findTasksWithEvidence(
  organizationId: string,
): Promise<string[]> {
  const [tasksWithRuns, taskAttachments, commentAttachments] =
    await Promise.all([
      db.task.findMany({
        where: {
          organizationId,
          OR: [
            { integrationCheckRuns: { some: {} } },
            {
              evidenceAutomations: {
                some: { runs: { some: { version: { not: null } } } },
              },
            },
            {
              browserAutomations: {
                some: {
                  runs: {
                    some: { status: { in: [...EXPORTABLE_RUN_STATUSES] } },
                  },
                },
              },
            },
          ],
        },
        select: { id: true },
      }),
      db.attachment.findMany({
        where: { organizationId, entityType: AttachmentEntityType.task },
        select: { entityId: true },
        distinct: ['entityId'],
      }),
      db.attachment.findMany({
        where: { organizationId, entityType: AttachmentEntityType.comment },
        select: { entityId: true },
        distinct: ['entityId'],
      }),
    ]);

  const ids = new Set<string>();
  for (const task of tasksWithRuns) ids.add(task.id);
  for (const attachment of taskAttachments) ids.add(attachment.entityId);

  // Comment files point at a comment, so resolve those comments to their task.
  const commentIds = commentAttachments.map((a) => a.entityId);
  if (commentIds.length > 0) {
    const comments = await db.comment.findMany({
      where: {
        organizationId,
        entityType: CommentEntityType.task,
        id: { in: commentIds },
      },
      select: { entityId: true },
    });
    for (const comment of comments) ids.add(comment.entityId);
  }

  return Array.from(ids);
}
