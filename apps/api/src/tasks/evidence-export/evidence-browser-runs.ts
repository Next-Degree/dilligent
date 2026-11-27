/**
 * Queries for finished browser automation runs used by the evidence export.
 * Diagnostic fields (`errorDetail`, `logs`) are never selected.
 */

import { db } from '@db';

// pending/running runs have no outcome yet, so they are not evidence.
export const EXPORTABLE_RUN_STATUSES = [
  'completed',
  'failed',
  'blocked',
] as const;
const RUN_BATCH_SIZE = 100;

/**
 * The most recent finished run that captured a screenshot. The run-level
 * screenshot is its last step's, so any captured shot sets this field.
 */
export function findLatestScreenshotRun(automationId: string) {
  return db.browserAutomationRun.findFirst({
    where: {
      automationId,
      status: { in: [...EXPORTABLE_RUN_STATUSES] },
      screenshotUrl: { not: null },
    },
    select: {
      id: true,
      createdAt: true,
      screenshotUrl: true,
      focusScreenshotUrl: true,
      stepRuns: {
        select: { order: true, screenshotUrl: true, focusScreenshotUrl: true },
        orderBy: { order: 'asc' },
      },
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });
}

/** Every finished run, oldest first, in batches; text fields only. */
export async function* streamBrowserRuns(automationId: string) {
  let cursor: { id: string } | undefined;
  for (;;) {
    const batch = await db.browserAutomationRun.findMany({
      where: { automationId, status: { in: [...EXPORTABLE_RUN_STATUSES] } },
      select: {
        id: true,
        status: true,
        createdAt: true,
        startedAt: true,
        completedAt: true,
        evaluationStatus: true,
        evaluationReason: true,
        finalUrl: true,
        error: true,
        stepRuns: {
          select: {
            order: true,
            status: true,
            evaluationStatus: true,
            evaluationReason: true,
            error: true,
          },
          orderBy: { order: 'asc' },
        },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: RUN_BATCH_SIZE,
      ...(cursor ? { cursor, skip: 1 } : {}),
    });
    if (batch.length > 0) yield batch;
    if (batch.length < RUN_BATCH_SIZE) return;
    cursor = { id: batch[batch.length - 1].id };
  }
}
