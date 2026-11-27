/**
 * Browser automation evidence for the export, per automation:
 *   runs.csv       every finished run (and step) with status and AI evaluation
 *   screenshots/   screenshots from the most recent run that has any
 *                  (full page, close-up, and per-step shots)
 *
 * Only the latest screenshots are exported: a daily automation produces
 * hundreds of images a year, which made exports slow and memory-hungry. Every
 * run's screenshot remains available in the app.
 *
 * `errorDetail` and `logs` are deliberately excluded: they are diagnostic-only
 * and never shown to end users.
 */

import { db } from '@db';
import type { ArchiveSink } from './evidence-attachment-streamer';
import {
  buildAutomationInfo,
  stepNumber,
  type BrowserStepSettings,
} from './evidence-browser-info';
import {
  EXPORTABLE_RUN_STATUSES,
  findLatestScreenshotRun,
  streamBrowserRuns,
} from './evidence-browser-runs';
import {
  createScreenshotWriter,
  utcFileStamp,
} from './evidence-browser-screenshots';
import { toCsvRow } from './evidence-csv';
import { sanitizeFilename } from './evidence-pdf-generator';

export interface BrowserAutomationHeader {
  id: string;
  name: string;
  targetUrl: string;
  instruction: string;
  evaluationCriteria: string | null;
  runCount: number;
  steps: BrowserStepSettings[];
}

export interface BrowserArchiveStats {
  browserAutomations: number;
  browserRuns: number;
  browserScreenshots: number;
  browserScreenshotsMissing: number;
}

type Shots = { shot: string; focus: string };
interface LatestShots {
  runId: string;
  createdAt: Date;
  run: Shots;
  steps: Map<number, Shots>;
}

const NO_SHOTS: Shots = { shot: '', focus: '' };

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
      steps: {
        select: {
          order: true,
          targetUrl: true,
          instruction: true,
          evaluationCriteria: true,
        },
        orderBy: { order: 'asc' },
      },
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

async function writeLatestScreenshots({
  automationId,
  screenshots,
}: {
  automationId: string;
  screenshots: ReturnType<typeof createScreenshotWriter>;
}): Promise<LatestShots | null> {
  const run = await findLatestScreenshotRun(automationId);
  if (!run) return null;

  const prefix = `${utcFileStamp(run.createdAt)}_${run.id.slice(-8)}`;
  const writePair = async ({
    keys,
    baseName,
  }: {
    keys: { screenshotUrl: string | null; focusScreenshotUrl: string | null };
    baseName: string;
  }): Promise<Shots> => {
    const owner = { ownerId: run.id, createdAt: run.createdAt };
    return {
      shot: await screenshots.write({
        ...owner,
        key: keys.screenshotUrl,
        baseName,
      }),
      focus: await screenshots.write({
        ...owner,
        key: keys.focusScreenshotUrl,
        baseName: `${baseName}_focus`,
      }),
    };
  };

  // Run first, so the shared final-step shot is named after the run.
  const runShots = await writePair({ keys: run, baseName: prefix });
  const steps = new Map<number, Shots>();
  for (const step of run.stepRuns) {
    steps.set(
      step.order,
      await writePair({
        keys: step,
        baseName: `${prefix}_step-${stepNumber(step.order)}`,
      }),
    );
  }
  return { runId: run.id, createdAt: run.createdAt, run: runShots, steps };
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
].join(',');

function toIso(date: Date | null): string {
  return date ? date.toISOString() : '';
}

export async function appendBrowserAutomationsToArchive({
  archive,
  automations,
  folderPath,
}: {
  archive: ArchiveSink;
  automations: BrowserAutomationHeader[];
  folderPath: string;
}): Promise<BrowserArchiveStats> {
  const stats: BrowserArchiveStats = {
    browserAutomations: 0,
    browserRuns: 0,
    browserScreenshots: 0,
    browserScreenshotsMissing: 0,
  };

  for (const automation of automations) {
    const automationFolder = `${folderPath}/${sanitizeFilename(automation.name)}-${automation.id.slice(-8)}`;
    const screenshots = createScreenshotWriter({
      archive,
      folderPath: automationFolder,
    });
    const latest = await writeLatestScreenshots({
      automationId: automation.id,
      screenshots,
    });
    const rows = [CSV_HEADER];

    for await (const batch of streamBrowserRuns(automation.id)) {
      for (const run of batch) {
        const isLatest = run.id === latest?.runId;
        const runShots = isLatest ? latest.run : NO_SHOTS;
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
            runShots.shot,
            runShots.focus,
          ]),
        );
        for (const step of run.stepRuns) {
          const stepShots =
            (isLatest && latest.steps.get(step.order)) || NO_SHOTS;
          rows.push(
            toCsvRow([
              run.id,
              String(stepNumber(step.order)),
              '',
              '',
              '',
              step.status,
              step.evaluationStatus,
              step.evaluationReason,
              '',
              step.error,
              stepShots.shot,
              stepShots.focus,
            ]),
          );
        }
        stats.browserRuns += 1;
      }
    }

    archive.append(
      Buffer.from(buildAutomationInfo({ automation, latest }), 'utf-8'),
      { name: `${automationFolder}/automation.txt` },
    );
    archive.append(Buffer.from(`${rows.join('\n')}\n`, 'utf-8'), {
      name: `${automationFolder}/runs.csv`,
    });
    const counts = screenshots.counts();
    stats.browserAutomations += 1;
    stats.browserScreenshots += counts.written;
    stats.browserScreenshotsMissing += counts.missing;
  }

  return stats;
}
