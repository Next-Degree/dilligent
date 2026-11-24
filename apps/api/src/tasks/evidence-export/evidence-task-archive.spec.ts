// Each source module is tested on its own; here we check how they are wired.
jest.mock('@db', () => ({ db: {} }));
jest.mock('./evidence-data-loader', () => ({
  getAutomationHeaders: jest.fn(),
  streamAutomationRuns: jest.fn(() => 'RUN-BATCHES'),
}));
jest.mock('./evidence-json-builder', () => ({
  buildAutomationJsonStream: jest.fn(() => 'JSON-STREAM'),
}));
jest.mock('./evidence-pdf-generator', () => ({
  generateTaskSummaryPDF: jest.fn(() => 'SUMMARY-PDF'),
  generateAutomationPDFFromStream: jest.fn(() => Promise.resolve('AUTO-PDF')),
  sanitizeFilename: (name: string) => name.toLowerCase().replace(/\s+/g, '-'),
}));
jest.mock('./evidence-attachment-streamer', () => ({
  appendAttachmentToArchive: jest.fn(() => Promise.resolve()),
  createFilenameTracker: () => (name: string) => name,
  getTaskAttachments: jest.fn(),
}));
jest.mock('./evidence-comments', () => ({
  appendTaskCommentsToArchive: jest.fn(() =>
    Promise.resolve({ comments: 2, commentAttachments: 3 }),
  ),
  getTaskComments: jest.fn(),
}));
jest.mock('./evidence-browser-automations', () => ({
  appendBrowserAutomationsToArchive: jest.fn(() =>
    Promise.resolve({
      browserAutomations: 1,
      browserRuns: 5,
      browserScreenshots: 7,
    }),
  ),
  getTaskBrowserAutomations: jest.fn(),
}));

import { getTaskBrowserAutomations } from './evidence-browser-automations';
import {
  appendAttachmentToArchive,
  getTaskAttachments,
} from './evidence-attachment-streamer';
import {
  appendTaskCommentsToArchive,
  getTaskComments,
} from './evidence-comments';
import { appendBrowserAutomationsToArchive } from './evidence-browser-automations';
import { getAutomationHeaders } from './evidence-data-loader';
import { generateTaskSummaryPDF } from './evidence-pdf-generator';
import {
  appendTaskEvidenceToArchive,
  hasExportableEvidence,
  loadTaskEvidence,
  type TaskEvidence,
} from './evidence-task-archive';

const at = new Date('2026-01-01T00:00:00Z');

function evidence(overrides: Partial<TaskEvidence> = {}): TaskEvidence {
  return {
    headers: {
      taskId: 'tsk_1',
      taskTitle: 'Task',
      organizationId: 'org_1',
      organizationName: 'Acme',
      automations: [],
      exportedAt: at,
    },
    attachments: [],
    comments: [],
    browserAutomations: [],
    ...overrides,
  };
}

describe('hasExportableEvidence', () => {
  it('is false for an empty task', () => {
    expect(hasExportableEvidence(evidence())).toBe(false);
  });

  it('is false when comments have text but no files', () => {
    expect(
      hasExportableEvidence(
        evidence({
          comments: [
            {
              id: 'c',
              content: 'hi',
              createdAt: at,
              authorName: 'A',
              attachments: [],
            },
          ],
        }),
      ),
    ).toBe(false);
  });

  it('is true when a comment has a file', () => {
    expect(
      hasExportableEvidence(
        evidence({
          comments: [
            {
              id: 'c',
              content: 'see file',
              createdAt: at,
              authorName: 'A',
              attachments: [
                {
                  id: 'a',
                  name: 'f.pdf',
                  url: 'k',
                  type: 'document',
                  createdAt: at,
                },
              ],
            },
          ],
        }),
      ),
    ).toBe(true);
  });

  it('is true when the task has browser automation runs', () => {
    expect(
      hasExportableEvidence(
        evidence({
          browserAutomations: [
            {
              id: 'b',
              name: 'Status',
              targetUrl: 'https://x',
              instruction: 'i',
              evaluationCriteria: null,
              runCount: 1,
            },
          ],
        }),
      ),
    ).toBe(true);
  });

  it('is true for task attachments', () => {
    expect(
      hasExportableEvidence(
        evidence({
          attachments: [
            {
              id: 'a',
              name: 'f.pdf',
              url: 'k',
              type: 'document',
              createdAt: at,
            },
          ],
        }),
      ),
    ).toBe(true);
  });
});

describe('loadTaskEvidence', () => {
  it('loads every source for the task, scoped to the organization', async () => {
    const scope = { organizationId: 'org_1', taskId: 'tsk_1' };
    (getAutomationHeaders as jest.Mock).mockResolvedValue('HEADERS');
    (getTaskAttachments as jest.Mock).mockResolvedValue(['ATT']);
    (getTaskComments as jest.Mock).mockResolvedValue(['CMT']);
    (getTaskBrowserAutomations as jest.Mock).mockResolvedValue(['BAU']);

    await expect(loadTaskEvidence(scope)).resolves.toEqual({
      headers: 'HEADERS',
      attachments: ['ATT'],
      comments: ['CMT'],
      browserAutomations: ['BAU'],
    });
    expect(getAutomationHeaders).toHaveBeenCalledWith(scope);
    expect(getTaskAttachments).toHaveBeenCalledWith('org_1', 'tsk_1');
    expect(getTaskComments).toHaveBeenCalledWith(scope);
    expect(getTaskBrowserAutomations).toHaveBeenCalledWith(scope);
  });
});

describe('appendTaskEvidenceToArchive', () => {
  const file = {
    id: 'a',
    name: 'f.pdf',
    url: 'k',
    type: 'document' as const,
    createdAt: at,
  };
  const full = evidence({
    headers: {
      ...evidence().headers,
      automations: [
        {
          id: 'chk_0000000012345678',
          name: 'MFA Check',
          type: 'app_automation',
          runs: [],
          totalRuns: 1,
          successfulRuns: 1,
          failedRuns: 0,
          latestRunAt: at,
        },
      ],
    },
    attachments: [file],
    comments: [
      {
        id: 'c1',
        content: 'x',
        createdAt: at,
        authorName: 'A',
        attachments: [file, file],
      },
      {
        id: 'c2',
        content: 'y',
        createdAt: at,
        authorName: 'A',
        attachments: [file],
      },
    ],
    browserAutomations: [
      {
        id: 'b',
        name: 'Status Page',
        targetUrl: 'https://x',
        instruction: 'i',
        evaluationCriteria: null,
        runCount: 5,
      },
    ],
  });

  function makeArchive() {
    return { append: jest.fn() };
  }

  beforeEach(() => jest.clearAllMocks());

  it('passes every source count to the summary PDF', async () => {
    await appendTaskEvidenceToArchive({
      archive: makeArchive() as never,
      evidence: full,
      folderName: 'task',
      includeJson: false,
      perAutomationSubfolders: false,
    });

    expect(generateTaskSummaryPDF).toHaveBeenCalledWith(full.headers, {
      attachmentsCount: 1,
      commentsCount: 2,
      commentAttachmentsCount: 3,
      browserAutomations: [{ name: 'Status Page', runCount: 5 }],
    });
  });

  it('writes each source into its folder and returns combined stats', async () => {
    const archive = makeArchive();

    const stats = await appendTaskEvidenceToArchive({
      archive: archive as never,
      evidence: full,
      folderName: 'task',
      includeJson: true,
      perAutomationSubfolders: false,
    });

    expect(archive.append.mock.calls.map((c) => c[1].name)).toEqual([
      'task/00-summary.pdf',
      'task/app-mfa-check-12345678.pdf',
      'task/app-mfa-check-12345678.json',
    ]);
    expect(
      (appendAttachmentToArchive as jest.Mock).mock.calls[0][0].folderPath,
    ).toBe('task/01-attachments');
    expect(appendTaskCommentsToArchive).toHaveBeenCalledWith(
      expect.objectContaining({
        folderPath: 'task/02-comments',
        comments: full.comments,
        taskTitle: 'Task',
      }),
    );
    expect(appendBrowserAutomationsToArchive).toHaveBeenCalledWith(
      expect.objectContaining({
        folderPath: 'task/03-browser-automations',
        automations: full.browserAutomations,
      }),
    );
    expect(stats).toEqual({
      automations: 1,
      attachments: 1,
      comments: 2,
      commentAttachments: 3,
      browserAutomations: 1,
      browserRuns: 5,
      browserScreenshots: 7,
    });
  });

  it('uses per-automation subfolders and skips JSON when asked', async () => {
    const archive = makeArchive();

    await appendTaskEvidenceToArchive({
      archive: archive as never,
      evidence: full,
      folderName: 'task',
      includeJson: false,
      perAutomationSubfolders: true,
    });

    expect(archive.append.mock.calls.map((c) => c[1].name)).toEqual([
      'task/00-summary.pdf',
      'task/app-mfa-check-12345678/evidence.pdf',
    ]);
  });
});
