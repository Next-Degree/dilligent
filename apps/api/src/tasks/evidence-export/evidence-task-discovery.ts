/**
 * Finds every task in an org that has something the evidence export can ship.
 * Must stay in sync with hasExportableEvidence (evidence-task-archive.ts):
 * each source here is a source that function counts.
 */

import { AttachmentEntityType, CommentEntityType, db } from '@db';
import { EXPORTABLE_RUN_STATUSES } from './evidence-browser-runs';

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
  for (const batch of inBatches(commentIds)) {
    const comments = await db.comment.findMany({
      where: {
        organizationId,
        entityType: CommentEntityType.task,
        id: { in: batch },
      },
      select: { entityId: true },
    });
    for (const comment of comments) polymorphicIds.add(comment.entityId);
  }

  const unverified = [...polymorphicIds].filter((id) => !ids.has(id));
  for (const batch of inBatches(unverified)) {
    const existing = await db.task.findMany({
      where: { organizationId, id: { in: batch } },
      select: { id: true },
    });
    for (const task of existing) ids.add(task.id);
  }

  return Array.from(ids);
}

// Postgres caps a query at 32,767 bind parameters; stay well under it.
const IN_BATCH_SIZE = 10_000;

export function inBatches<T>(items: T[]): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += IN_BATCH_SIZE) {
    batches.push(items.slice(i, i + IN_BATCH_SIZE));
  }
  return batches;
}
