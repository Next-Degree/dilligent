/**
 * Browser automation evidence for the export: every finished run's screenshots
 * (full page, focused close-up, and per-step shots for multi-step automations)
 * plus a runs.csv with the status and AI evaluation of each run.
 *
 * `errorDetail` and `logs` are deliberately excluded: they are diagnostic-only
 * and never shown to end users.
 */

import { db } from '@db';
import type { Archiver } from 'archiver';
import { format } from 'date-fns';
import { createScreenshotWriter } from './evidence-browser-screenshots';
import { sanitizeFilename } from './evidence-pdf-generator';

// pending/running runs have no outcome yet, so they are not evidence.
export const EXPORTABLE_RUN_STATUSES = [
  'completed',
  'failed',
  'blocked',
] as const;
const RUN_BATCH_SIZE = 100;

export interface BrowserAutomationHeader {
  id: string;
  name: string;
  targetUrl: string;
  instruction: string;
  evaluationCriteria: string | null;
  runCount: number;
}

export interface BrowserArchiveStats {
  browserAutomations: number;
  browserRuns: number;
  browserScreenshots: number;
}

export async function getTaskBrowserAutomations({
  organizationId,
  taskId,
}: {
  organizationId: string;
  taskId: string;
}): Promise<BrowserAutomationHeader[]> {
  const automations = await db.browserAutomation.findMany({
    where: { taskId, task: { organizationId } },
    select: {
      id: true,
      name: true,
      targetUrl: true,
      instruction: true,
      evaluationCriteria: true,
      _count: {
        select: {
          runs: { where: { status: { in: [...EXPORTABLE_RUN_STATUSES] } } },
        },
      },
    },
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
  });

  return automations
    .filter((automation) => automation._count.runs > 0)
    .map(({ _count, ...automation }) => ({
      ...automation,
      runCount: _count.runs,
    }));
}

async function* streamBrowserRuns(automationId: string) {
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
        screenshotUrl: true,
        focusScreenshotUrl: true,
        evaluationStatus: true,
        evaluationReason: true,
        finalUrl: true,
        error: true,
        stepRuns: {
          select: {
            order: true,
            status: true,
            screenshotUrl: true,
            focusScreenshotUrl: true,
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

const CSV_HEADER = [
  'run_id',
  'step',
  'created_at',
  'started_at',
  'completed_at',
  'status',
  'evaluation',
  'evaluation_reason',
  'final_url',
  'error',
  'screenshot',
  'focus_screenshot',
];

/** Quotes a CSV field and neutralises spreadsheet formula injection. */
export function toCsvField(value: string | null | undefined): string {
  if (!value) return '';
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function toCsvRow(values: Array<string | null | undefined>): string {
  return values.map(toCsvField).join(',');
}

function toIso(date: Date | null): string {
  return date ? date.toISOString() : '';
}

function buildAutomationInfo(automation: BrowserAutomationHeader): string {
  return [
    `Browser automation: ${automation.name}`,
    `Target URL: ${automation.targetUrl}`,
    `Runs exported: ${automation.runCount}`,
    '',
    'Instruction:',
    automation.instruction,
    '',
    'Evaluation criteria:',
    automation.evaluationCriteria || '(none: runs capture a screenshot only)',
    '',
    'See runs.csv for every run. Times are UTC.',
    '',
  ].join('\n');
}

export async function appendBrowserAutomationsToArchive({
  archive,
  automations,
  folderPath,
}: {
  archive: Archiver;
  automations: BrowserAutomationHeader[];
  folderPath: string;
}): Promise<BrowserArchiveStats> {
  const stats: BrowserArchiveStats = {
    browserAutomations: 0,
    browserRuns: 0,
    browserScreenshots: 0,
  };

  for (const automation of automations) {
    const automationFolder = `${folderPath}/${sanitizeFilename(automation.name)}-${automation.id.slice(-8)}`;
    const screenshots = createScreenshotWriter({
      archive,
      folderPath: automationFolder,
    });
    const rows = [CSV_HEADER.join(',')];

    for await (const batch of streamBrowserRuns(automation.id)) {
      for (const run of batch) {
        const prefix = `${format(run.createdAt, 'yyyy-MM-dd_HHmmss')}_${run.id.slice(-8)}`;
        const shared = { ownerId: run.id, createdAt: run.createdAt };
        const shot = await screenshots.write({
          ...shared,
          key: run.screenshotUrl,
          baseName: prefix,
        });
        const focus = await screenshots.write({
          ...shared,
          key: run.focusScreenshotUrl,
          baseName: `${prefix}_focus`,
        });
        rows.push(
          toCsvRow([
            run.id,
            '',
            toIso(run.createdAt),
            toIso(run.startedAt),
            toIso(run.completedAt),
            run.status,
            run.evaluationStatus,
            run.evaluationReason,
            run.finalUrl,
            run.error,
            shot,
            focus,
          ]),
        );

        for (const step of run.stepRuns) {
          const stepShot = await screenshots.write({
            ...shared,
            key: step.screenshotUrl,
            baseName: `${prefix}_step-${step.order}`,
          });
          const stepFocus = await screenshots.write({
            ...shared,
            key: step.focusScreenshotUrl,
            baseName: `${prefix}_step-${step.order}_focus`,
          });
          rows.push(
            toCsvRow([
              run.id,
              String(step.order),
              '',
              '',
              '',
              step.status,
              step.evaluationStatus,
              step.evaluationReason,
              '',
              step.error,
              stepShot,
              stepFocus,
            ]),
          );
        }
        stats.browserRuns += 1;
      }
    }

    archive.append(Buffer.from(buildAutomationInfo(automation), 'utf-8'), {
      name: `${automationFolder}/automation.txt`,
    });
    archive.append(Buffer.from(`${rows.join('\n')}\n`, 'utf-8'), {
      name: `${automationFolder}/runs.csv`,
    });
    stats.browserAutomations += 1;
    stats.browserScreenshots += screenshots.count();
  }

  return stats;
}
