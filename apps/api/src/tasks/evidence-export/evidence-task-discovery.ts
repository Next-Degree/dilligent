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

  const ids = new Set(tasksWithRuns.map((task) => task.id));

  // Attachment and comment rows reference tasks polymorphically (no FK), and
  // deleting a task leaves them behind. Collect those IDs separately and keep
  // only tasks that still exist, so a deleted task is not reported as failed.
  const polymorphicIds = new Set(taskAttachments.map((a) => a.entityId));
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
    for (const comment of comments) polymorphicIds.add(comment.entityId);
  }

  const unverified = [...polymorphicIds].filter((id) => !ids.has(id));
  if (unverified.length > 0) {
    const existing = await db.task.findMany({
      where: { organizationId, id: { in: unverified } },
      select: { id: true },
    });
    for (const task of existing) ids.add(task.id);
  }

  return Array.from(ids);
}
