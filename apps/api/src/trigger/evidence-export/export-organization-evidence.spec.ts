import { EventEmitter } from 'node:events';

// Mock module boundaries so importing the task does not connect to Postgres,
// the Trigger SDK, S3, or pull in jsPDF. We only exercise streamArchiveToS3 —
// the concurrent populate+upload orchestration and its error propagation.
jest.mock('@db', () => ({ db: { organization: { findUnique: jest.fn() } } }));

jest.mock('@trigger.dev/sdk', () => ({
  metadata: { set: jest.fn(), get: jest.fn() },
  schemaTask: (config: unknown) => config,
}));

const mockUploadDone = jest.fn();
const mockUploadAbort = jest.fn().mockResolvedValue(undefined);
jest.mock('@aws-sdk/lib-storage', () => ({
  Upload: jest.fn().mockImplementation((opts: { params?: { Body?: unknown } }) => {
    // A real Upload consumes the Body stream and surfaces its errors via done().
    // Mimic that so a destroyed PassThrough doesn't become an unhandled error.
    const body = opts?.params?.Body as
      | { on?: (e: string, cb: () => void) => void; resume?: () => void }
      | undefined;
    if (body && typeof body.on === 'function') {
      body.on('error', () => {});
      if (typeof body.resume === 'function') body.resume();
    }
    return { done: mockUploadDone, abort: mockUploadAbort };
  }),
}));

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn(),
  GetObjectCommand: jest.fn(),
}));
jest.mock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl: jest.fn() }));

// Fake archiver: an EventEmitter with the methods streamArchiveToS3 touches.
function makeFakeArchive() {
  const emitter = new EventEmitter();
  return Object.assign(emitter, {
    pipe: jest.fn(),
    finalize: jest.fn().mockResolvedValue(undefined),
    abort: jest.fn(),
    append: jest.fn(),
  });
}
let fakeArchive: ReturnType<typeof makeFakeArchive>;
jest.mock('archiver', () => ({ ZipArchive: jest.fn(() => fakeArchive) }));

// The task module pulls these in at import time; stub them (unused by the SUT).
jest.mock('@/tasks/evidence-export/evidence-task-discovery', () => ({
  findTasksWithEvidence: jest.fn(),
}));
jest.mock('@/tasks/evidence-export/evidence-pdf-generator', () => ({
  sanitizeFilename: (s: string) => s,
}));
jest.mock('@/tasks/evidence-export/evidence-task-archive', () => ({
  appendTaskEvidenceToArchive: jest.fn(),
  hasExportableEvidence: jest.fn(),
  loadTaskEvidence: jest.fn(),
}));

import {
  appendTaskEvidenceToArchive,
  hasExportableEvidence,
  loadTaskEvidence,
} from '@/tasks/evidence-export/evidence-task-archive';
import {
  exportOrganizationEvidenceTask,
  populateArchive,
  streamArchiveToS3,
} from './export-organization-evidence';

describe('exportOrganizationEvidenceTask config', () => {
  // schemaTask is mocked to return its config, so the task IS its config object.
  const config = exportOrganizationEvidenceTask as unknown as {
    id: string;
    maxDuration: number;
  };

  it('allows large orgs at least an hour before Trigger.dev kills the run', () => {
    // Regression: orgs with high automation volume + large outputs exceeded the
    // old 30-minute (60 * 30 = 1800s) budget, so Trigger.dev killed the run
    // (retry maxAttempts: 0), leaving it in a non-COMPLETED terminal state that
    // the browser surfaces as a failed export with no download link. The task
    // must be allowed at least an hour to finish streaming the ZIP to S3.
    expect(config.maxDuration).toBeGreaterThanOrEqual(60 * 60);
    // maxDuration is in SECONDS — guard against the ms form (which would be days).
    expect(config.maxDuration).toBeLessThan(24 * 60 * 60);
  });
});

describe('streamArchiveToS3', () => {
  const s3Client = {} as never;
  const baseParams = { s3Client, bucket: 'b', key: 'k' };

  beforeEach(() => {
    fakeArchive = makeFakeArchive();
    mockUploadDone.mockReset().mockResolvedValue(undefined);
    mockUploadAbort.mockClear();
  });

  it('finalizes the archive once and resolves on the happy path', async () => {
    const populate = jest.fn().mockResolvedValue(undefined);

    await streamArchiveToS3({ ...baseParams, populate });

    expect(populate).toHaveBeenCalledWith(fakeArchive);
    expect(fakeArchive.finalize).toHaveBeenCalledTimes(1);
    expect(fakeArchive.pipe).toHaveBeenCalledTimes(1);
    expect(mockUploadDone).toHaveBeenCalledTimes(1);
    expect(mockUploadAbort).not.toHaveBeenCalled();
  });

  it('aborts the archive + upload and rethrows when populate fails', async () => {
    const boom = new Error('populate failed');
    const populate = jest.fn().mockRejectedValue(boom);
    // Upload would hang until the stream ends; resolve it so allSettled settles.
    mockUploadDone.mockResolvedValue(undefined);

    await expect(streamArchiveToS3({ ...baseParams, populate })).rejects.toBe(
      boom,
    );

    expect(fakeArchive.abort).toHaveBeenCalledTimes(1);
    expect(fakeArchive.finalize).not.toHaveBeenCalled();
    expect(mockUploadAbort).toHaveBeenCalledTimes(1);
  });

  it('aborts the multipart upload and rethrows when the S3 upload fails', async () => {
    const uploadErr = new Error('s3 upload failed');
    const populate = jest.fn().mockResolvedValue(undefined);
    mockUploadDone.mockRejectedValue(uploadErr);

    await expect(streamArchiveToS3({ ...baseParams, populate })).rejects.toBe(
      uploadErr,
    );

    expect(fakeArchive.finalize).toHaveBeenCalledTimes(1);
    // populate succeeded, so we do not abort the archive itself...
    expect(fakeArchive.abort).not.toHaveBeenCalled();
    // ...but we DO cancel the multipart upload to avoid orphaned S3 parts.
    expect(mockUploadAbort).toHaveBeenCalledTimes(1);
  });
});

describe('populateArchive', () => {
  const stats = {
    automations: 1,
    attachments: 2,
    attachmentsMissing: 1,
    comments: 3,
    commentAttachments: 1,
    commentAttachmentsMissing: 0,
    browserAutomations: 1,
    browserRuns: 10,
    browserScreenshots: 2,
    browserScreenshotsMissing: 1,
  };

  function evidenceFor(taskId: string, title: string) {
    return { headers: { taskId, taskTitle: title, automations: [] } };
  }

  function manifestOf(archive: ReturnType<typeof makeFakeArchive>) {
    const call = archive.append.mock.calls.find(
      (c: unknown[]) =>
        (c[1] as { name: string }).name === 'acme/manifest.json',
    );
    return JSON.parse(String(call?.[0]));
  }

  beforeEach(() => {
    jest.clearAllMocks();
    fakeArchive = makeFakeArchive();
  });

  it('writes every task with evidence, totals the new sources, and lists failures', async () => {
    (loadTaskEvidence as jest.Mock).mockImplementation(
      ({ taskId }: { taskId: string }) => {
        if (taskId === 'tsk_broken')
          return Promise.reject(new Error('S3 down'));
        return Promise.resolve(evidenceFor(taskId, `Task ${taskId}`));
      },
    );
    (hasExportableEvidence as jest.Mock).mockImplementation(
      (e: { headers: { taskId: string } }) => e.headers.taskId !== 'tsk_empty',
    );
    (appendTaskEvidenceToArchive as jest.Mock).mockResolvedValue(stats);

    await populateArchive({
      archive: fakeArchive as never,
      organizationId: 'org_1',
      organizationName: 'Acme',
      orgFolder: 'acme',
      taskIds: ['tsk_a', 'tsk_empty', 'tsk_broken', 'tsk_b'],
      includeJson: false,
    });

    expect(appendTaskEvidenceToArchive).toHaveBeenCalledTimes(2);
    expect(
      (appendTaskEvidenceToArchive as jest.Mock).mock.calls[0][0].folderName,
    ).toBe('acme/Task tsk_a-tsk_a');

    const manifest = manifestOf(fakeArchive);
    expect(manifest.tasksCount).toBe(2);
    expect(manifest.totalAttachments).toBe(4);
    expect(manifest.totalCommentAttachments).toBe(2);
    expect(manifest.totalBrowserRuns).toBe(20);
    expect(manifest.totalBrowserScreenshots).toBe(4);
    // Placeholders are reported separately, not inside the file totals.
    expect(manifest.totalMissingFiles).toBe(4);
    expect(manifest.hasFailures).toBe(true);
    expect(manifest.failedTasks).toEqual([
      { taskId: 'tsk_broken', reason: 'S3 down' },
    ]);
    expect(manifest.includedSources.join('\n')).toContain('02-comments');
    expect(manifest.includedSources.join('\n')).toContain(
      '03-browser-automations',
    );
  });
});
