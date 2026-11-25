import { NotFoundException } from '@nestjs/common';

// ------- Mock archiver -------
// Collect append() calls on a simple harness. finalize() resolves a shared
// deferred so tests can await populate completion.
interface MockArchive {
  appendCalls: Array<{ source: unknown; options: { name: string } }>;
  append: jest.Mock;
  finalize: jest.Mock;
  abort: jest.Mock;
  on: jest.Mock;
  pipe: jest.Mock;
  finalized: Promise<void>;
  aborted: boolean;
}

const archiveInstances: MockArchive[] = [];

function createMockArchive(): MockArchive {
  let resolveFinalized!: () => void;
  let rejectFinalized!: (err: Error) => void;
  const finalized = new Promise<void>((resolve, reject) => {
    resolveFinalized = resolve;
    rejectFinalized = reject;
  });

  const archive: MockArchive = {
    appendCalls: [],
    append: jest.fn((source, options) => {
      archive.appendCalls.push({ source, options });
      return archive;
    }),
    finalize: jest.fn(async () => {
      resolveFinalized();
    }),
    abort: jest.fn(() => {
      archive.aborted = true;
      rejectFinalized(new Error('aborted'));
    }),
    on: jest.fn(() => archive),
    pipe: jest.fn(() => archive),
    finalized,
    aborted: false,
  };
  return archive;
}

jest.mock('archiver', () => ({
  ZipArchive: jest.fn(() => {
    const instance = createMockArchive();
    archiveInstances.push(instance);
    return instance;
  }),
}));

// ------- Mock S3 -------
jest.mock('../../app/s3', () => ({
  BUCKET_NAME: 'test-bucket',
  s3Client: {
    send: jest.fn(),
  },
  getSignedUrl: jest.fn(),
}));

// ------- Mock @db -------
const mockDb = {
  task: { findFirst: jest.fn(), findMany: jest.fn() },
  integrationCheckRun: { findMany: jest.fn() },
  evidenceAutomationRun: { findMany: jest.fn() },
  attachment: { findMany: jest.fn() },
  comment: { findMany: jest.fn() },
  browserAutomation: { findMany: jest.fn() },
  browserAutomationRun: { findMany: jest.fn(), findFirst: jest.fn() },
};

jest.mock('@db', () => ({
  db: mockDb,
  AttachmentEntityType: {
    task: 'task',
    vendor: 'vendor',
    risk: 'risk',
    comment: 'comment',
    trust_nda: 'trust_nda',
    task_item: 'task_item',
  },
  CommentEntityType: { task: 'task' },
}));

// ------- Mock PDF generator to avoid heavy jsPDF work -------
jest.mock('./evidence-pdf-generator', () => ({
  generateTaskSummaryPDF: jest.fn(() => Buffer.from('SUMMARY-PDF')),
  generateAutomationPDF: jest.fn(() => Buffer.from('AUTOMATION-PDF')),
  generateAutomationPDFFromStream: jest.fn(
    async (
      _header: unknown,
      _context: unknown,
      runBatches: AsyncIterable<unknown>,
    ) => {
      for await (const _batch of runBatches) {
        /* drain so underlying DB queries execute */
      }
      return Buffer.from('AUTOMATION-PDF');
    },
  ),
  sanitizeFilename: (name: string) =>
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 50) || 'export',
}));

import { GetObjectCommand } from '@aws-sdk/client-s3';
import { s3Client } from '../../app/s3';
import { EvidenceExportService } from './evidence-export.service';
import { generateTaskSummaryPDF } from './evidence-pdf-generator';

describe('EvidenceExportService — streaming ZIPs', () => {
  let service: EvidenceExportService;

  beforeEach(() => {
    jest.clearAllMocks();
    archiveInstances.length = 0;
    service = new EvidenceExportService();
    // New evidence sources default to empty so pre-existing scenarios are unchanged.
    mockDb.comment.findMany.mockResolvedValue([]);
    mockDb.browserAutomation.findMany.mockResolvedValue([]);
    mockDb.browserAutomationRun.findMany.mockResolvedValue([]);
    mockDb.browserAutomationRun.findFirst.mockResolvedValue(null);
  });

  const taskRow = {
    id: 'tsk_123',
    title: 'SOC 2 — Access Review',
    organization: { name: 'Acme Corp' },
  };

  function primeTaskQueries({
    attachments = [] as Array<{
      id: string;
      name: string;
      url: string;
      type: string;
      createdAt: Date;
    }>,
    appRuns = [] as unknown[],
    customRuns = [] as unknown[],
  }) {
    mockDb.task.findFirst.mockResolvedValue(taskRow);
    mockDb.integrationCheckRun.findMany.mockResolvedValue(appRuns);
    mockDb.evidenceAutomationRun.findMany.mockResolvedValue(customRuns);
    mockDb.attachment.findMany.mockResolvedValue(attachments);
  }

  describe('streamTaskEvidenceZip', () => {
    it('throws NotFoundException when task does not exist', async () => {
      mockDb.task.findFirst.mockResolvedValue(null);

      await expect(
        service.streamTaskEvidenceZip('org_1', 'tsk_missing'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('returns a filename scoped to org + task + date', async () => {
      primeTaskQueries({});

      const { filename } = await service.streamTaskEvidenceZip(
        'org_1',
        'tsk_123',
      );

      expect(filename).toMatch(
        /^acme-corp_soc-2-access-review_evidence_\d{4}-\d{2}-\d{2}\.zip$/,
      );
    });

    it('appends summary PDF then attachments (ordered before automations)', async () => {
      const attachments = [
        {
          id: 'att_1',
          name: 'contract.pdf',
          url: 'org_1/attachments/task/tsk_123/123-abc-contract.pdf',
          type: 'document',
          createdAt: new Date('2024-01-01'),
        },
      ];

      // Mock S3 GetObject to return a small Buffer body
      (s3Client!.send as jest.Mock).mockResolvedValue({
        Body: Buffer.from('FAKE-PDF-BYTES'),
      });

      primeTaskQueries({ attachments });

      const { archive } = await service.streamTaskEvidenceZip(
        'org_1',
        'tsk_123',
      );
      const mock = archive as unknown as MockArchive;
      await mock.finalized;

      const paths = mock.appendCalls.map((c) => c.options.name);
      // EXPORT_INFO.txt is appended first to flush a ZIP byte through proxies
      // before the slow per-task data load runs.
      expect(paths[0]).toBe(
        'acme-corp_soc-2-access-review_evidence/EXPORT_INFO.txt',
      );
      expect(paths[1]).toBe(
        'acme-corp_soc-2-access-review_evidence/00-summary.pdf',
      );
      expect(paths[2]).toBe(
        'acme-corp_soc-2-access-review_evidence/01-attachments/contract.pdf',
      );

      // S3 hit with attachment's S3 key
      expect(s3Client!.send).toHaveBeenCalledWith(
        expect.any(GetObjectCommand),
      );

      // Summary PDF rendered with attachment count
      expect(generateTaskSummaryPDF).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({ attachmentsCount: 1 }),
      );
    });

    it('writes a placeholder when S3 object is truly missing (NoSuchKey)', async () => {
      const attachments = [
        {
          id: 'att_missing',
          name: 'ghost.pdf',
          url: 'org_1/attachments/task/tsk_123/missing-ghost.pdf',
          type: 'document',
          createdAt: new Date(),
        },
      ];

      const noSuchKeyError = Object.assign(new Error('NoSuchKey'), {
        name: 'NoSuchKey',
        $metadata: { httpStatusCode: 404 },
      });
      (s3Client!.send as jest.Mock).mockRejectedValue(noSuchKeyError);
      primeTaskQueries({ attachments });

      const { archive } = await service.streamTaskEvidenceZip(
        'org_1',
        'tsk_123',
      );
      const mock = archive as unknown as MockArchive;
      await mock.finalized;

      const placeholder = mock.appendCalls.find((c) =>
        c.options.name.includes('_MISSING_'),
      );
      expect(placeholder).toBeDefined();
      expect(placeholder!.options.name).toMatch(/_MISSING_ghost\.pdf\.txt$/);
      expect(String(placeholder!.source)).toContain('att_missing');
    });

    it('aborts the archive on transient S3 failures (not a placeholder)', async () => {
      const attachments = [
        {
          id: 'att_err',
          name: 'file.pdf',
          url: 'org_1/attachments/task/tsk_123/file.pdf',
          type: 'document',
          createdAt: new Date(),
        },
      ];

      // AccessDenied — NOT a missing-object error; must surface as a failure.
      const accessDeniedError = Object.assign(new Error('Access Denied'), {
        name: 'AccessDenied',
        $metadata: { httpStatusCode: 403 },
      });
      (s3Client!.send as jest.Mock).mockRejectedValue(accessDeniedError);
      primeTaskQueries({ attachments });

      const { archive } = await service.streamTaskEvidenceZip(
        'org_1',
        'tsk_123',
      );
      const mock = archive as unknown as MockArchive;

      await expect(mock.finalized).rejects.toThrow('aborted');
      expect(mock.abort).toHaveBeenCalled();

      // No placeholder text file written for a non-missing error
      const placeholder = mock.appendCalls.find((c) =>
        c.options.name.includes('_MISSING_'),
      );
      expect(placeholder).toBeUndefined();
    });

    it('aborts on NoSuchBucket (a 404 that is NOT a missing object)', async () => {
      const attachments = [
        {
          id: 'att_bucket',
          name: 'file.pdf',
          url: 'org_1/attachments/task/tsk_123/file.pdf',
          type: 'document',
          createdAt: new Date(),
        },
      ];

      // Bucket misconfiguration — returns HTTP 404 but must NOT be
      // treated as a single missing attachment. Otherwise the export looks
      // "successful" while silently containing only placeholders.
      const noSuchBucketError = Object.assign(new Error('NoSuchBucket'), {
        name: 'NoSuchBucket',
        $metadata: { httpStatusCode: 404 },
      });
      (s3Client!.send as jest.Mock).mockRejectedValue(noSuchBucketError);
      primeTaskQueries({ attachments });

      const { archive } = await service.streamTaskEvidenceZip(
        'org_1',
        'tsk_123',
      );
      const mock = archive as unknown as MockArchive;

      await expect(mock.finalized).rejects.toThrow('aborted');
      expect(mock.abort).toHaveBeenCalled();

      const placeholder = mock.appendCalls.find((c) =>
        c.options.name.includes('_MISSING_'),
      );
      expect(placeholder).toBeUndefined();
    });

    it('prevents placeholder vs success filename collision in final ZIP path', async () => {
      // Regression guard for cubic P2: if a legitimate file is uploaded with
      // the name `_MISSING_foo.txt` and succeeds from S3, AND another upload
      // named `foo` fails (NoSuchKey), the wrapping of the failure into
      // `_MISSING_foo.txt` must NOT collide with the successful file.
      const attachments = [
        {
          id: 'att_real',
          name: '_MISSING_foo.txt',
          url: 'key-real',
          type: 'document',
          createdAt: new Date('2024-01-01'),
        },
        {
          id: 'att_miss',
          name: 'foo',
          url: 'key-miss',
          type: 'document',
          createdAt: new Date('2024-01-02'),
        },
      ];

      (s3Client!.send as jest.Mock).mockImplementation(
        (cmd: { input: { Key: string } }) => {
          if (cmd.input.Key === 'key-real') {
            return Promise.resolve({ Body: Buffer.from('REAL') });
          }
          return Promise.reject(
            Object.assign(new Error('NoSuchKey'), {
              name: 'NoSuchKey',
              $metadata: { httpStatusCode: 404 },
            }),
          );
        },
      );
      primeTaskQueries({ attachments });

      const { archive } = await service.streamTaskEvidenceZip(
        'org_1',
        'tsk_123',
      );
      const mock = archive as unknown as MockArchive;
      await mock.finalized;

      const attachmentPaths = mock.appendCalls
        .map((c) => c.options.name)
        .filter((p) => p.includes('/01-attachments/'));

      // Two entries, each with a distinct final path inside the ZIP.
      expect(attachmentPaths).toHaveLength(2);
      const uniquePaths = new Set(attachmentPaths);
      expect(uniquePaths.size).toBe(2);

      // The real file keeps its name; the placeholder gets a numeric suffix
      // because the tracker now dedupes on the final ZIP entry name.
      expect(attachmentPaths).toContain(
        'acme-corp_soc-2-access-review_evidence/01-attachments/_MISSING_foo.txt',
      );
      expect(attachmentPaths).toContain(
        'acme-corp_soc-2-access-review_evidence/01-attachments/_MISSING_foo (1).txt',
      );
    });

    it('disambiguates duplicate filenames within attachments folder', async () => {
      const attachments = [
        {
          id: 'att_a',
          name: 'report.pdf',
          url: 'key-a',
          type: 'document',
          createdAt: new Date('2024-01-01'),
        },
        {
          id: 'att_b',
          name: 'report.pdf',
          url: 'key-b',
          type: 'document',
          createdAt: new Date('2024-01-02'),
        },
      ];

      (s3Client!.send as jest.Mock).mockResolvedValue({
        Body: Buffer.from('PDF'),
      });
      primeTaskQueries({ attachments });

      const { archive } = await service.streamTaskEvidenceZip(
        'org_1',
        'tsk_123',
      );
      const mock = archive as unknown as MockArchive;
      await mock.finalized;

      const attachmentPaths = mock.appendCalls
        .map((c) => c.options.name)
        .filter((p) => p.includes('/01-attachments/'));

      expect(attachmentPaths).toHaveLength(2);
      expect(attachmentPaths[0]).toMatch(/\/report\.pdf$/);
      expect(attachmentPaths[1]).toMatch(/\/report \(1\)\.pdf$/);
    });

    it('queries only task-entity attachments (not vendor/risk/comment)', async () => {
      primeTaskQueries({});
      await service.streamTaskEvidenceZip('org_1', 'tsk_123');
      const mock = archiveInstances[0];
      await mock.finalized;

      expect(mockDb.attachment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            organizationId: 'org_1',
            entityType: 'task',
            entityId: 'tsk_123',
          }),
        }),
      );
    });

    it('produces a valid ZIP with automations only (no attachments) — no regression', async () => {
      // Simulates the common case: task has automation runs but no files
      // uploaded. Must NOT create an empty 01-attachments/ folder and must
      // still emit the summary + automation PDFs like before this PR.
      const appRun = {
        id: 'icr_1',
        checkId: 'mfa-check',
        checkName: 'MFA Enabled',
        status: 'success',
        startedAt: new Date('2024-01-15T10:00:00Z'),
        completedAt: new Date('2024-01-15T10:00:05Z'),
        durationMs: 5000,
        totalChecked: 1,
        passedCount: 1,
        failedCount: 0,
        errorMessage: null,
        logs: null,
        createdAt: new Date('2024-01-15T10:00:00Z'),
        connection: { provider: { slug: 'g', name: 'G' } },
        results: [],
      };
      primeTaskQueries({ attachments: [], appRuns: [appRun], customRuns: [] });

      const { archive } = await service.streamTaskEvidenceZip(
        'org_1',
        'tsk_123',
      );
      const mock = archive as unknown as MockArchive;
      await mock.finalized;

      const paths = mock.appendCalls.map((c) => c.options.name);

      // Summary PDF present
      expect(paths).toContain(
        'acme-corp_soc-2-access-review_evidence/00-summary.pdf',
      );
      // No 01-attachments/ folder at all
      expect(paths.some((p) => p.includes('/01-attachments/'))).toBe(false);
      // At least one automation PDF was written in a subfolder (per-task uses subfolders)
      expect(paths.some((p) => /\/app-.+\/evidence\.pdf$/.test(p))).toBe(true);

      // S3 GetObject should NOT have been called — no attachments to fetch.
      expect(s3Client!.send).not.toHaveBeenCalled();

      // Summary PDF renders with attachmentsCount=0 (line omitted in PDF).
      expect(generateTaskSummaryPDF).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({ attachmentsCount: 0 }),
      );
      // No comments or browser runs → no 02-/03- folders.
      expect(paths.some((p) => p.includes('/02-comments/'))).toBe(false);
      expect(paths.some((p) => p.includes('/03-browser-automations/'))).toBe(
        false,
      );
    });

    it('loads each automation individually instead of all runs at once (OOM fix)', async () => {
      const appRuns = [
        {
          id: 'icr_1',
          checkId: 'mfa-check',
          checkName: 'MFA Enabled',
          status: 'success',
          startedAt: new Date('2024-01-15'),
          completedAt: new Date('2024-01-15'),
          durationMs: 5000,
          totalChecked: 1,
          passedCount: 1,
          failedCount: 0,
          errorMessage: null,
          logs: { entries: ['checked MFA'] },
          createdAt: new Date('2024-01-15'),
          connection: { provider: { slug: 'gws', name: 'Google Workspace' } },
          results: [
            {
              id: 'r1',
              passed: true,
              resourceType: 'user',
              resourceId: 'u1',
              title: 'MFA active',
              description: null,
              severity: null,
              remediation: null,
              evidence: { mfa: true },
              collectedAt: new Date(),
            },
          ],
        },
        {
          id: 'icr_2',
          checkId: 'access-review',
          checkName: 'Access Review',
          status: 'success',
          startedAt: new Date('2024-01-16'),
          completedAt: new Date('2024-01-16'),
          durationMs: 3000,
          totalChecked: 2,
          passedCount: 2,
          failedCount: 0,
          errorMessage: null,
          logs: null,
          createdAt: new Date('2024-01-16'),
          connection: { provider: { slug: 'gws', name: 'Google Workspace' } },
          results: [],
        },
      ];

      mockDb.task.findFirst.mockResolvedValue(taskRow);
      mockDb.attachment.findMany.mockResolvedValue([]);
      mockDb.evidenceAutomationRun.findMany.mockResolvedValue([]);
      mockDb.integrationCheckRun.findMany.mockImplementation(
        (args: { where: { checkId?: string } }) => {
          if (args.where.checkId) {
            return Promise.resolve(
              appRuns.filter((r) => r.checkId === args.where.checkId),
            );
          }
          return Promise.resolve(appRuns);
        },
      );

      const { archive } = await service.streamTaskEvidenceZip(
        'org_1',
        'tsk_123',
      );
      const mock = archive as unknown as MockArchive;
      await mock.finalized;

      const paths = mock.appendCalls.map((c) => c.options.name);

      // Both automations get their own subfolder and PDF
      expect(paths.filter((p) => /\/evidence\.pdf$/.test(p))).toHaveLength(2);
      expect(paths.some((p) => p.includes('/app-mfa-enabled-'))).toBe(true);
      expect(paths.some((p) => p.includes('/app-access-review-'))).toBe(true);

      // Verify per-automation loading: findMany is called with individual
      // checkId filters (not a single bulk load of all results).
      const findManyCalls = mockDb.integrationCheckRun.findMany.mock.calls;
      const perAutomationCalls = findManyCalls.filter(
        (call: unknown[]) =>
          (call[0] as { where: { checkId?: string } }).where.checkId,
      );
      expect(perAutomationCalls).toHaveLength(2);
      const loadedCheckIds = perAutomationCalls.map(
        (call: unknown[]) =>
          (call[0] as { where: { checkId: string } }).where.checkId,
      );
      expect(loadedCheckIds).toContain('mfa-check');
      expect(loadedCheckIds).toContain('access-review');
    });

    it('produces a summary-only ZIP when task has neither automations nor attachments', async () => {
      primeTaskQueries({ attachments: [], appRuns: [], customRuns: [] });

      const { archive } = await service.streamTaskEvidenceZip(
        'org_1',
        'tsk_123',
      );
      const mock = archive as unknown as MockArchive;
      await mock.finalized;

      const paths = mock.appendCalls.map((c) => c.options.name);
      expect(paths).toEqual([
        'acme-corp_soc-2-access-review_evidence/EXPORT_INFO.txt',
        'acme-corp_soc-2-access-review_evidence/00-summary.pdf',
      ]);
      expect(s3Client!.send).not.toHaveBeenCalled();
    });
    it('adds comments and browser automation runs to the task ZIP', async () => {
      primeTaskQueries({});
      mockDb.comment.findMany.mockResolvedValue([
        {
          id: 'cmt_1',
          content: 'Looks good',
          createdAt: new Date('2026-01-02T00:00:00Z'),
          author: { user: { name: 'Jane', email: 'j@x.com' } },
        },
      ]);
      mockDb.attachment.findMany.mockImplementation(
        (args: { where: { entityType: string } }) =>
          Promise.resolve(
            args.where.entityType === 'comment'
              ? [
                  {
                    id: 'att_c1',
                    name: 'proof.png',
                    url: 'k-comment',
                    type: 'image',
                    createdAt: new Date(),
                    entityId: 'cmt_1',
                  },
                ]
              : [],
          ),
      );
      mockDb.browserAutomation.findMany.mockResolvedValue([
        {
          id: 'bau_0000000012345678',
          name: 'Status Page',
          targetUrl: 'https://status.example.com',
          instruction: 'Open it',
          evaluationCriteria: null,
          _count: { runs: 1 },
        },
      ]);
      mockDb.browserAutomationRun.findFirst.mockResolvedValue({
        id: 'bar_aaaaaaaa',
        createdAt: new Date('2026-01-03T00:00:00Z'),
        screenshotUrl: 'browser-automations/org_1/bau/bar.jpg',
        focusScreenshotUrl: null,
        stepRuns: [],
      });
      mockDb.browserAutomationRun.findMany.mockResolvedValueOnce([
        {
          id: 'bar_aaaaaaaa',
          status: 'completed',
          createdAt: new Date('2026-01-03T00:00:00Z'),
          startedAt: null,
          completedAt: null,
          evaluationStatus: 'pass',
          evaluationReason: 'ok',
          finalUrl: null,
          error: null,
          stepRuns: [],
        },
      ]);
      (s3Client!.send as jest.Mock).mockResolvedValue({
        Body: Buffer.from('IMG'),
      });

      const { archive } = await service.streamTaskEvidenceZip(
        'org_1',
        'tsk_123',
      );
      const mock = archive as unknown as MockArchive;
      await mock.finalized;

      const base = 'acme-corp_soc-2-access-review_evidence';
      const paths = mock.appendCalls.map((c) => c.options.name);
      expect(paths).toEqual(
        expect.arrayContaining([
          `${base}/02-comments/attachments/proof.png`,
          `${base}/02-comments/comments.txt`,
          `${base}/03-browser-automations/status-page-12345678/automation.txt`,
          `${base}/03-browser-automations/status-page-12345678/runs.csv`,
        ]),
      );
      expect(
        paths.some((p) =>
          /03-browser-automations\/status-page-12345678\/screenshots\/2026-01-03_000000_aaaaaaaa\.jpg$/.test(
            p,
          ),
        ),
      ).toBe(true);
    });
  });
});
