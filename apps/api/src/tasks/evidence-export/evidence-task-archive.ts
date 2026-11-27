/**
 * Loads and writes one task's evidence into a ZIP. Shared by the single-task
 * export (EvidenceExportService) and the org-wide auditor export (Trigger.dev
 * task) so both ZIPs always contain the same sources.
 *
 * Task folder layout:
 *   00-summary.pdf
 *   01-attachments/            files uploaded to the task
 *   <automation PDFs/JSON>     integration checks + custom automations
 *   02-comments/               comments.txt + attachments/
 *   03-browser-automations/    <automation>/automation.txt, runs.csv, screenshots/
 */

import type {
  NormalizedAutomation,
  TaskEvidenceSummary,
} from './evidence-export.types';
import {
  appendBrowserAutomationsToArchive,
  getTaskBrowserAutomations,
  type BrowserAutomationHeader,
} from './evidence-browser-automations';
import {
  appendAttachmentToArchive,
  createFilenameTracker,
  getTaskAttachments,
  type ArchiveSink,
  type TaskAttachment,
} from './evidence-attachment-streamer';
import {
  appendTaskCommentsToArchive,
  getTaskComments,
  type TaskComment,
} from './evidence-comments';
import {
  getAutomationHeaders,
  streamAutomationRuns,
} from './evidence-data-loader';
import { buildAutomationJsonStream } from './evidence-json-builder';
import {
  generateAutomationPDFFromStream,
  generateTaskSummaryPDF,
  sanitizeFilename,
} from './evidence-pdf-generator';

export interface TaskEvidence {
  headers: TaskEvidenceSummary;
  attachments: TaskAttachment[];
  comments: TaskComment[];
  browserAutomations: BrowserAutomationHeader[];
}

export interface TaskEvidenceStats {
  automations: number;
  /** Files actually written; `_MISSING_` placeholders are counted below. */
  attachments: number;
  attachmentsMissing: number;
  comments: number;
  commentAttachments: number;
  commentAttachmentsMissing: number;
  browserAutomations: number;
  browserRuns: number;
  browserScreenshots: number;
  browserScreenshotsMissing: number;
}

export async function loadTaskEvidence({
  organizationId,
  taskId,
}: {
  organizationId: string;
  taskId: string;
}): Promise<TaskEvidence> {
  const [headers, attachments, comments, browserAutomations] =
    await Promise.all([
      getAutomationHeaders({ organizationId, taskId }),
      getTaskAttachments(organizationId, taskId),
      getTaskComments({ organizationId, taskId }),
      getTaskBrowserAutomations({ organizationId, taskId }),
    ]);
  return { headers, attachments, comments, browserAutomations };
}

/**
 * Whether a task belongs in the org-wide export. Comment text alone does not
 * count (it would pull in every discussed-but-unevidenced task); comment files do.
 */
export function hasExportableEvidence(evidence: TaskEvidence): boolean {
  return (
    evidence.headers.automations.length > 0 ||
    evidence.attachments.length > 0 ||
    evidence.browserAutomations.length > 0 ||
    evidence.comments.some((comment) => comment.attachments.length > 0)
  );
}

async function appendAutomation({
  archive,
  headers,
  automationHeader,
  folderName,
  includeJson,
  perAutomationSubfolders,
}: {
  archive: ArchiveSink;
  headers: TaskEvidenceSummary;
  automationHeader: NormalizedAutomation;
  folderName: string;
  includeJson: boolean;
  perAutomationSubfolders: boolean;
}): Promise<void> {
  const typePrefix =
    automationHeader.type === 'app_automation' ? 'app' : 'custom';
  const automationSlug = `${typePrefix}-${sanitizeFilename(automationHeader.name)}-${automationHeader.id.slice(-8)}`;
  const filePrefix = perAutomationSubfolders
    ? `${folderName}/${automationSlug}/evidence`
    : `${folderName}/${automationSlug}`;
  const runBatches = () =>
    streamAutomationRuns({ taskId: headers.taskId, header: automationHeader });

  // Streams runs in batches so peak memory is one batch, not the whole history.
  const pdfBuffer = await generateAutomationPDFFromStream(
    automationHeader,
    {
      organizationName: headers.organizationName,
      taskTitle: headers.taskTitle,
    },
    runBatches(),
  );
  archive.append(pdfBuffer, { name: `${filePrefix}.pdf` });

  if (includeJson) {
    // A second, independent DB cursor so neither output buffers the full run set.
    const jsonStream = buildAutomationJsonStream({
      summary: headers,
      header: automationHeader,
      runBatches: runBatches(),
    });
    archive.append(jsonStream, { name: `${filePrefix}.json` });
  }
}

export async function appendTaskEvidenceToArchive({
  archive,
  evidence,
  folderName,
  includeJson,
  perAutomationSubfolders,
}: {
  archive: ArchiveSink;
  evidence: TaskEvidence;
  folderName: string;
  includeJson: boolean;
  perAutomationSubfolders: boolean;
}): Promise<TaskEvidenceStats> {
  const { headers, attachments, comments, browserAutomations } = evidence;

  const summaryPdf = generateTaskSummaryPDF(headers, {
    attachmentsCount: attachments.length,
    commentsCount: comments.length,
    commentAttachmentsCount: comments.reduce(
      (total, comment) => total + comment.attachments.length,
      0,
    ),
    browserAutomations: browserAutomations.map(({ name, runCount }) => ({
      name,
      runCount,
    })),
  });
  archive.append(summaryPdf, { name: `${folderName}/00-summary.pdf` });

  const attachmentCounts = { written: 0, missing: 0 };
  const uniqueName = createFilenameTracker();
  for (const attachment of attachments) {
    const result = await appendAttachmentToArchive({
      archive,
      attachment,
      folderPath: `${folderName}/01-attachments`,
      uniqueName,
    });
    attachmentCounts[result] += 1;
  }

  for (const automationHeader of headers.automations) {
    await appendAutomation({
      archive,
      headers,
      automationHeader,
      folderName,
      includeJson,
      perAutomationSubfolders,
    });
  }

  const commentStats = await appendTaskCommentsToArchive({
    archive,
    taskTitle: headers.taskTitle,
    comments,
    folderPath: `${folderName}/02-comments`,
  });

  const browserStats = await appendBrowserAutomationsToArchive({
    archive,
    automations: browserAutomations,
    folderPath: `${folderName}/03-browser-automations`,
  });

  return {
    automations: headers.automations.length,
    attachments: attachmentCounts.written,
    attachmentsMissing: attachmentCounts.missing,
    ...commentStats,
    ...browserStats,
  };
}
