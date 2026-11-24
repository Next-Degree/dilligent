import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { db } from '@db';
import { ZipArchive, type Archiver } from 'archiver';
import { format } from 'date-fns';
import { configure as configureStringify } from 'safe-stable-stringify';
import type {
  TaskEvidenceSummary,
  EvidenceExportResult,
  EvidenceZipStream,
  NormalizedAutomation,
} from './evidence-export.types';
import {
  generateAutomationPDF,
  sanitizeFilename,
} from './evidence-pdf-generator';
import {
  getAutomationHeaders,
  loadFullAutomation,
} from './evidence-data-loader';
import { findTasksWithEvidence } from './evidence-task-discovery';
import {
  appendTaskEvidenceToArchive,
  hasExportableEvidence,
  loadTaskEvidence,
  type TaskEvidenceStats,
} from './evidence-task-archive';

const safeStringify = configureStringify({
  bigint: true,
  circularValue: '[Circular]',
  deterministic: false,
});

function buildExportInfo(
  info:
    | { kind: 'task'; taskId: string }
    | {
        kind: 'organization';
        organizationName: string;
        organizationId: string;
        taskCount: number;
      },
): string {
  const lines = [
    'Evidence export',
    `Started at: ${new Date().toISOString()}`,
  ];
  if (info.kind === 'task') {
    lines.push(`Task ID: ${info.taskId}`);
  } else {
    lines.push(`Organization: ${info.organizationName}`);
    lines.push(`Organization ID: ${info.organizationId}`);
    lines.push(`Tasks included: ${info.taskCount}`);
  }
  return lines.join('\n') + '\n';
}

@Injectable()
export class EvidenceExportService {
  private readonly logger = new Logger(EvidenceExportService.name);
  // Used by the JSON summary endpoint — loads automations sequentially via the data loader.
  async getTaskEvidenceSummary(
    organizationId: string,
    taskId: string,
  ): Promise<TaskEvidenceSummary> {
    const headers = await getAutomationHeaders({ organizationId, taskId });

    const automations: NormalizedAutomation[] = [];
    for (const header of headers.automations) {
      automations.push(await loadFullAutomation({ taskId, header }));
    }

    this.logger.log('Task evidence summary built', {
      organizationId,
      taskId,
      automations: automations.length,
    });

    return { ...headers, automations };
  }

  async exportAutomationPDF(
    organizationId: string,
    taskId: string,
    automationId: string,
  ): Promise<EvidenceExportResult> {
    const headers = await getAutomationHeaders({ organizationId, taskId });

    const automationHeader = headers.automations.find(
      (a) => a.id === automationId,
    );
    if (!automationHeader) {
      throw new NotFoundException('Automation not found');
    }

    const automation = await loadFullAutomation({
      taskId,
      header: automationHeader,
    });

    const pdfBuffer = generateAutomationPDF(automation, {
      organizationName: headers.organizationName,
      taskTitle: headers.taskTitle,
    });

    this.logger.log('Automation evidence PDF generated', {
      organizationId,
      taskId,
      automationId,
      runs: automation.runs.length,
      pdfBytes: pdfBuffer.length,
    });

    const filename = `${sanitizeFilename(headers.organizationName)}_${sanitizeFilename(automation.name)}_evidence_${format(new Date(), 'yyyy-MM-dd')}.pdf`;

    return { fileBuffer: pdfBuffer, mimeType: 'application/pdf', filename };
  }

  async streamTaskEvidenceZip(
    organizationId: string,
    taskId: string,
    options: { includeRawJson?: boolean } = {},
  ): Promise<EvidenceZipStream> {
    const task = await db.task.findFirst({
      where: { id: taskId, organizationId },
      include: { organization: { select: { name: true } } },
    });

    if (!task) {
      throw new NotFoundException('Task not found');
    }

    const folderName = `${sanitizeFilename(task.organization.name)}_${sanitizeFilename(task.title)}_evidence`;
    const filename = `${folderName}_${format(new Date(), 'yyyy-MM-dd')}.zip`;

    const archive = this.createArchive(`task ${taskId}`);

    void this.populateTaskArchive({
      archive,
      organizationId,
      taskId,
      folderName,
      options,
    }).catch((err) => {
      this.logger.error(
        `Failed to populate task ZIP for ${taskId}: ${
          err instanceof Error ? err.stack : String(err)
        }`,
      );
      archive.abort();
    });

    return { archive, filename };
  }

  async streamOrganizationEvidenceZip(
    organizationId: string,
    options: { includeRawJson?: boolean } = {},
  ): Promise<EvidenceZipStream> {
    const organization = await db.organization.findUnique({
      where: { id: organizationId },
      select: { name: true },
    });

    if (!organization) {
      throw new NotFoundException('Organization not found');
    }

    const taskIds = await findTasksWithEvidence(organizationId);
    if (taskIds.length === 0) {
      throw new NotFoundException(
        'No tasks with evidence or attachments found',
      );
    }

    const orgFolder = sanitizeFilename(organization.name);
    const exportDate = format(new Date(), 'yyyy-MM-dd');
    const filename = `${orgFolder}_all-evidence_${exportDate}.zip`;

    const archive = this.createArchive(`org ${organizationId}`);

    void this.populateOrganizationArchive({
      archive,
      organizationId,
      organizationName: organization.name,
      orgFolder,
      taskIds,
      options,
    }).catch((err) => {
      this.logger.error(
        `Failed to populate org ZIP for ${organizationId}: ${
          err instanceof Error ? err.stack : String(err)
        }`,
      );
      archive.abort();
    });

    return { archive, filename };
  }

  private createArchive(label: string): Archiver {
    const archive = new ZipArchive({ zlib: { level: 6 } });
    archive.on('warning', (err) => {
      this.logger.warn(`Archive warning (${label}): ${err.message}`);
    });
    archive.on('error', (err) => {
      this.logger.error(`Archive error (${label}): ${err.message}`);
    });
    return archive;
  }

  private async populateTaskArchive(params: {
    archive: Archiver;
    organizationId: string;
    taskId: string;
    folderName: string;
    options: { includeRawJson?: boolean };
  }): Promise<void> {
    const { archive, organizationId, taskId, folderName, options } = params;

    // Force the archiver to emit a real ZIP byte immediately, before the
    // per-task data load runs. Combined with res.flushHeaders() upstream this
    // keeps the response visibly alive through any proxy idle timer.
    archive.append(
      Buffer.from(
        buildExportInfo({ kind: 'task', taskId }),
        'utf-8',
      ),
      { name: `${folderName}/EXPORT_INFO.txt` },
    );

    const evidence = await loadTaskEvidence({ organizationId, taskId });
    const stats = await appendTaskEvidenceToArchive({
      archive,
      evidence,
      folderName,
      includeJson: !!options.includeRawJson,
      perAutomationSubfolders: true,
    });

    await archive.finalize();

    this.logger.log('Task evidence ZIP streamed', {
      organizationId,
      taskId,
      ...stats,
      includeRawJson: !!options.includeRawJson,
    });
  }

  private async populateOrganizationArchive(params: {
    archive: Archiver;
    organizationId: string;
    organizationName: string;
    orgFolder: string;
    taskIds: string[];
    options: { includeRawJson?: boolean };
  }): Promise<void> {
    const {
      archive,
      organizationId,
      organizationName,
      orgFolder,
      taskIds,
      options,
    } = params;

    // Push the first ZIP byte out immediately so proxies see a live stream
    // before the slow per-task loop begins. See populateTaskArchive note.
    archive.append(
      Buffer.from(
        buildExportInfo({
          kind: 'organization',
          organizationName,
          organizationId,
          taskCount: taskIds.length,
        }),
        'utf-8',
      ),
      { name: `${orgFolder}/EXPORT_INFO.txt` },
    );

    const manifestEntries: Array<
      { id: string; title: string } & TaskEvidenceStats
    > = [];

    for (const taskId of taskIds) {
      try {
        const evidence = await loadTaskEvidence({ organizationId, taskId });
        if (!hasExportableEvidence(evidence)) continue;

        const { headers } = evidence;
        const taskFolder = `${orgFolder}/${sanitizeFilename(headers.taskTitle)}-${headers.taskId.slice(-8)}`;
        const stats = await appendTaskEvidenceToArchive({
          archive,
          evidence,
          folderName: taskFolder,
          includeJson: !!options.includeRawJson,
          perAutomationSubfolders: false,
        });

        manifestEntries.push({
          id: headers.taskId,
          title: headers.taskTitle,
          ...stats,
        });
      } catch (error) {
        this.logger.warn(
          `Failed to export task ${taskId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    manifestEntries.sort((a, b) => a.title.localeCompare(b.title));
    const totalAttachments = manifestEntries.reduce(
      (total, entry) => total + entry.attachments,
      0,
    );

    const manifest = {
      organization: organizationName,
      organizationId,
      exportedAt: new Date().toISOString(),
      tasksCount: manifestEntries.length,
      totalAttachments,
      tasks: manifestEntries,
    };
    archive.append(
      Buffer.from(safeStringify(manifest, null, 2) ?? '{}', 'utf-8'),
      { name: `${orgFolder}/manifest.json` },
    );

    await archive.finalize();

    this.logger.log('Organization evidence ZIP streamed', {
      organizationId,
      tasks: manifestEntries.length,
      totalAttachments,
      includeRawJson: !!options.includeRawJson,
    });
  }
}
