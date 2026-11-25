import { metadata, schemaTask } from '@trigger.dev/sdk';
import { z } from 'zod';
import { PassThrough } from 'node:stream';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { ZipArchive, type Archiver } from 'archiver';
import { db } from '@db';
import { format } from 'date-fns';
import { createS3Client } from '@/app/create-s3-client';
import { findTasksWithEvidence } from '@/tasks/evidence-export/evidence-task-discovery';
import { sanitizeFilename } from '@/tasks/evidence-export/evidence-pdf-generator';
import {
  appendTaskEvidenceToArchive,
  hasExportableEvidence,
  loadTaskEvidence,
  type TaskEvidenceStats,
} from '@/tasks/evidence-export/evidence-task-archive';
import { configure as configureStringify } from 'safe-stable-stringify';

const safeStringify = configureStringify({
  bigint: true,
  circularValue: '[Circular]',
  deterministic: false,
});

const PRESIGNED_URL_EXPIRY = 3600;
// 10 MB parts; the multipart uploader buffers at most queueSize * partSize (~40 MB),
// so worker memory stays flat regardless of total ZIP size.
const UPLOAD_PART_SIZE = 10 * 1024 * 1024;
const UPLOAD_QUEUE_SIZE = 4;

function getBucketName(): string {
  const bucket = process.env.APP_AWS_BUCKET_NAME;
  if (!bucket) throw new Error('APP_AWS_BUCKET_NAME is not set.');
  return bucket;
}

export const exportOrganizationEvidenceTask = schemaTask({
  id: 'export-organization-evidence',
  // Runs on an isolated worker; 8 GB / 4 vCPU gives ample headroom for jsPDF +
  // zlib across the largest orgs now that the ZIP streams to S3 (never buffered).
  machine: { preset: 'large-1x' },
  // concurrencyLimit 1 + a per-org concurrencyKey (passed at trigger time) means
  // at most one export runs per org at a time; different orgs still run in parallel.
  queue: { name: 'evidence-export', concurrencyLimit: 1 },
  // maxDuration is max compute time in SECONDS. Orgs with high automation
  // volume + large outputs were exceeding the old 30-minute budget, so
  // Trigger.dev killed the run (retry maxAttempts: 0) — a non-COMPLETED
  // terminal state the browser reports as a failed export with no download
  // link. Give the single-threaded stream-to-S3 pass up to an hour to finish.
  maxDuration: 60 * 60,
  retry: { maxAttempts: 0 },
  schema: z.object({
    organizationId: z.string(),
    includeJson: z.boolean().default(false),
  }),
  run: async ({ organizationId, includeJson }, { ctx }) => {
    metadata.set('status', 'starting');
    metadata.set('progress', 0);

    const organization = await db.organization.findUnique({
      where: { id: organizationId },
      select: { name: true },
    });
    if (!organization) throw new Error('Organization not found');

    const taskIds = await findTasksWithEvidence(organizationId);
    if (taskIds.length === 0) throw new Error('No tasks with evidence found');

    metadata.set('tasksTotal', taskIds.length);
    metadata.set('tasksCompleted', 0);
    metadata.set('status', 'generating');

    const orgFolder = sanitizeFilename(organization.name);
    const exportDate = format(new Date(), 'yyyy-MM-dd');
    const s3Key = `${organizationId}/exports/evidence-${exportDate}-${ctx.run.id}.zip`;

    const s3Client = createS3Client();
    const bucket = getBucketName();

    await streamArchiveToS3({
      s3Client,
      bucket,
      key: s3Key,
      populate: (archive) =>
        populateArchive({
          archive,
          organizationId,
          organizationName: organization.name,
          orgFolder,
          taskIds,
          includeJson,
        }),
    });

    metadata.set('status', 'generating-link');
    metadata.set('progress', 95);

    const downloadUrl = await getSignedUrl(
      s3Client,
      new GetObjectCommand({ Bucket: bucket, Key: s3Key }),
      { expiresIn: PRESIGNED_URL_EXPIRY },
    );

    metadata.set('status', 'completed');
    metadata.set('progress', 100);
    metadata.set('downloadUrl', downloadUrl);

    return { downloadUrl, s3Key };
  },
});

/**
 * Pipe a freshly-built ZIP archive straight to S3 via multipart upload. The
 * archive is populated and uploaded concurrently, so peak memory is bounded by
 * one automation's PDF plus the uploader's part buffer — never the whole ZIP.
 */
export async function streamArchiveToS3(params: {
  s3Client: S3Client;
  bucket: string;
  key: string;
  populate: (archive: Archiver) => Promise<void>;
}): Promise<void> {
  const { s3Client, bucket, key, populate } = params;

  const archive = new ZipArchive({ zlib: { level: 6 } });
  const passThrough = new PassThrough();

  archive.on('warning', (err) => {
    console.warn(`Archive warning (${key}): ${err.message}`);
  });
  // pipe() does not forward source errors to the destination — do it explicitly
  // so a failed archive ends the upload stream and upload.done() rejects.
  archive.on('error', (err) => passThrough.destroy(err));
  archive.pipe(passThrough);

  const upload = new Upload({
    client: s3Client,
    params: {
      Bucket: bucket,
      Key: key,
      Body: passThrough,
      ContentType: 'application/zip',
    },
    queueSize: UPLOAD_QUEUE_SIZE,
    partSize: UPLOAD_PART_SIZE,
  });

  const populatePromise = (async () => {
    try {
      await populate(archive);
      await archive.finalize();
    } catch (err) {
      archive.abort();
      passThrough.destroy(err instanceof Error ? err : new Error(String(err)));
      throw err;
    }
  })();

  // allSettled so a populate failure cannot leave upload.done() pending forever.
  const [populateResult, uploadResult] = await Promise.allSettled([
    populatePromise,
    upload.done(),
  ]);

  if (populateResult.status === 'rejected') {
    await upload.abort().catch(() => {});
    throw populateResult.reason;
  }
  if (uploadResult.status === 'rejected') {
    // Cancel the multipart upload so no orphaned parts linger on S3.
    await upload.abort().catch(() => {});
    throw uploadResult.reason;
  }
}

export async function populateArchive({
  archive,
  organizationId,
  organizationName,
  orgFolder,
  taskIds,
  includeJson,
}: {
  archive: Archiver;
  organizationId: string;
  organizationName: string;
  orgFolder: string;
  taskIds: string[];
  includeJson: boolean;
}): Promise<void> {
  const manifestEntries: Array<
    { id: string; title: string } & TaskEvidenceStats
  > = [];
  const failedTasks: Array<{ taskId: string; reason: string }> = [];

  for (let i = 0; i < taskIds.length; i++) {
    const taskId = taskIds[i];
    try {
      const evidence = await loadTaskEvidence({ organizationId, taskId });
      if (hasExportableEvidence(evidence)) {
        const { headers } = evidence;
        const taskFolder = `${orgFolder}/${sanitizeFilename(headers.taskTitle)}-${headers.taskId.slice(-8)}`;
        const stats = await appendTaskEvidenceToArchive({
          archive,
          evidence,
          folderName: taskFolder,
          includeJson,
          perAutomationSubfolders: false,
        });
        manifestEntries.push({
          id: headers.taskId,
          title: headers.taskTitle,
          ...stats,
        });
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.warn(`Failed to export task ${taskId}: ${reason}`);
      failedTasks.push({ taskId, reason });
    }

    metadata.set('tasksCompleted', i + 1);
    metadata.set('tasksFailed', failedTasks.length);
    metadata.set('progress', Math.round(((i + 1) / taskIds.length) * 90));
  }

  manifestEntries.sort((a, b) => a.title.localeCompare(b.title));

  const sum = (key: keyof TaskEvidenceStats) =>
    manifestEntries.reduce((total, entry) => total + entry[key], 0);

  const manifest = {
    organization: organizationName,
    organizationId,
    exportedAt: new Date().toISOString(),
    // Lets an auditor see what each task folder can contain without the app.
    includedSources: [
      '01-attachments: files uploaded to the task',
      'app-*.pdf / custom-*.pdf: integration check and custom automation runs',
      '02-comments: task comment thread (comments.txt) and files attached to comments',
      '03-browser-automations: every finished run (runs.csv) and the screenshots of the most recent run that has them; older screenshots stay in the app',
      '_MISSING_*.txt: a file whose stored copy no longer exists (counted under totalMissingFiles, not in the file totals)',
    ],
    tasksCount: manifestEntries.length,
    totalAttachments: sum('attachments'),
    totalCommentAttachments: sum('commentAttachments'),
    totalBrowserRuns: sum('browserRuns'),
    totalBrowserScreenshots: sum('browserScreenshots'),
    totalMissingFiles:
      sum('attachmentsMissing') +
      sum('commentAttachmentsMissing') +
      sum('browserScreenshotsMissing'),
    // Surface partial failures inside the ZIP itself so an auditor reading only
    // the archive can tell the export is incomplete (not just via the run UI).
    hasFailures: failedTasks.length > 0,
    failedTasks,
    tasks: manifestEntries,
  };
  archive.append(
    Buffer.from(safeStringify(manifest, null, 2) ?? '{}', 'utf-8'),
    { name: `${orgFolder}/manifest.json` },
  );
  // Note: archive.finalize() is owned by streamArchiveToS3 (the caller).
}
