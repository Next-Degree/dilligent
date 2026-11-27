const mockDb = {
  browserAutomation: { findMany: jest.fn() },
  browserAutomationRun: { findMany: jest.fn(), findFirst: jest.fn() },
};

jest.mock('@db', () => ({ db: mockDb }));

jest.mock('./evidence-pdf-generator', () => ({
  sanitizeFilename: (name: string) =>
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, ''),
}));

const mockAppendAttachment = jest.fn();
jest.mock('./evidence-attachment-streamer', () => ({
  appendAttachmentToArchive: (params: {
    attachment: { name: string; url: string };
    uniqueName: (raw: string) => string;
  }) => {
    mockAppendAttachment(params);
    const missing = params.attachment.url.includes('gone');
    params.uniqueName(
      missing
        ? `_MISSING_${params.attachment.name}.txt`
        : params.attachment.name,
    );
    return Promise.resolve(missing ? 'missing' : 'written');
  },
  createFilenameTracker: () => (raw: string) => raw,
}));

import {
  appendBrowserAutomationsToArchive,
  getTaskBrowserAutomations,
  type BrowserAutomationHeader,
} from './evidence-browser-automations';

const created = new Date('2026-02-03T04:05:06.000Z');
const FOLDER = 'task/03-browser-automations/status-page-12345678';

function csvRun(overrides: Record<string, unknown> = {}) {
  return {
    id: 'bar_00000001',
    status: 'completed',
    createdAt: created,
    startedAt: created,
    completedAt: created,
    evaluationStatus: 'pass',
    evaluationReason: 'Status page shows uptime',
    finalUrl: 'https://status.example.com',
    error: null,
    stepRuns: [],
    ...overrides,
  };
}

function latestRun(overrides: Record<string, unknown> = {}) {
  return {
    id: 'bar_00000002',
    createdAt: created,
    screenshotUrl: 'browser-automations/org_1/bau/latest.jpg',
    focusScreenshotUrl: null,
    stepRuns: [],
    ...overrides,
  };
}

const automation: BrowserAutomationHeader = {
  id: 'bau_abcdefgh12345678',
  name: 'Status Page',
  targetUrl: 'https://status.example.com',
  instruction: 'Open the status page',
  evaluationCriteria: null,
  runCount: 2,
  steps: [],
};

const makeArchive = () => ({ append: jest.fn() });

function fileOf(archive: { append: jest.Mock }, suffix: string): string {
  const call = archive.append.mock.calls.find((c) =>
    String(c[1].name).endsWith(suffix),
  );
  return (call?.[0] as Buffer).toString('utf-8');
}

function exportOne(archive = makeArchive()) {
  return appendBrowserAutomationsToArchive({
    archive,
    automations: [automation],
    folderPath: 'task/03-browser-automations',
  });
}

describe('getTaskBrowserAutomations', () => {
  beforeEach(() => jest.clearAllMocks());

  it('scopes by org, counts only finished runs, and drops automations with none', async () => {
    mockDb.browserAutomation.findMany.mockResolvedValue([
      { ...automation, runCount: undefined, _count: { runs: 3 } },
      { ...automation, id: 'bau_never_run', _count: { runs: 0 } },
    ]);

    const result = await getTaskBrowserAutomations({
      organizationId: 'org_1',
      taskId: 'tsk_1',
    });

    const query = mockDb.browserAutomation.findMany.mock.calls[0][0];
    expect(query.where).toEqual({
      taskId: 'tsk_1',
      task: { organizationId: 'org_1' },
    });
    expect(query.select._count.select.runs.where.status.in).toEqual([
      'completed',
      'failed',
      'blocked',
    ]);
    expect(query.select.steps).toEqual({
      select: {
        order: true,
        targetUrl: true,
        instruction: true,
        evaluationCriteria: true,
      },
      orderBy: { order: 'asc' },
    });
    expect(result).toHaveLength(1);
    expect(result[0].runCount).toBe(3);
  });
});

describe('appendBrowserAutomationsToArchive', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDb.browserAutomationRun.findFirst.mockResolvedValue(null);
    mockDb.browserAutomationRun.findMany.mockResolvedValue([]);
  });

  it('exports screenshots only from the most recent finished run that has one', async () => {
    mockDb.browserAutomationRun.findFirst.mockResolvedValue(
      latestRun({ focusScreenshotUrl: 'browser-automations/org_1/bau/f.png' }),
    );

    await exportOne();

    const query = mockDb.browserAutomationRun.findFirst.mock.calls[0][0];
    expect(query.where).toEqual({
      automationId: automation.id,
      status: { in: ['completed', 'failed', 'blocked'] },
      screenshotUrl: { not: null },
    });
    expect(query.orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
    expect(
      mockAppendAttachment.mock.calls.map((c) => c[0].attachment.name),
    ).toEqual([
      '2026-02-03_040506_00000002.jpg',
      '2026-02-03_040506_00000002_focus.png',
    ]);
    expect(mockAppendAttachment.mock.calls[0][0].folderPath).toBe(
      `${FOLDER}/screenshots`,
    );
  });

  it('lists every run in runs.csv but links screenshots only on the latest run', async () => {
    mockDb.browserAutomationRun.findFirst.mockResolvedValue(latestRun());
    mockDb.browserAutomationRun.findMany.mockResolvedValueOnce([
      csvRun(),
      csvRun({ id: 'bar_00000002', evaluationStatus: 'fail' }),
    ]);
    const archive = makeArchive();

    const stats = await exportOne(archive);

    const lines = fileOf(archive, 'runs.csv').trim().split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('run_id,step,created_at');
    expect(lines[1]).toMatch(
      /^bar_00000001,,.*,pass,Status page shows uptime,.*,,$/,
    );
    expect(lines[2]).toMatch(
      /^bar_00000002,,.*,screenshots\/2026-02-03_040506_00000002\.jpg,$/,
    );
    expect(stats).toEqual({
      browserAutomations: 1,
      browserRuns: 2,
      browserScreenshots: 1,
      browserScreenshotsMissing: 0,
    });
  });

  it('does not load screenshot keys for the CSV, or any diagnostic fields', async () => {
    await exportOne();

    const query = mockDb.browserAutomationRun.findMany.mock.calls[0][0];
    expect(query.where.status.in).toEqual(['completed', 'failed', 'blocked']);
    expect(query.orderBy).toEqual([{ createdAt: 'asc' }, { id: 'asc' }]);
    for (const field of ['screenshotUrl', 'errorDetail', 'logs']) {
      expect(query.select).not.toHaveProperty(field);
    }
  });

  it('pages through runs with a cursor until a short batch', async () => {
    const fullBatch = Array.from({ length: 100 }, (_, i) =>
      csvRun({ id: `bar_${String(i).padStart(8, '0')}` }),
    );
    mockDb.browserAutomationRun.findMany
      .mockResolvedValueOnce(fullBatch)
      .mockResolvedValueOnce([csvRun({ id: 'bar_last0001' })]);

    const stats = await exportOne();

    expect(stats.browserRuns).toBe(101);
    const second = mockDb.browserAutomationRun.findMany.mock.calls[1][0];
    expect(second.cursor).toEqual({ id: 'bar_00000099' });
    expect(second.skip).toBe(1);
  });

  it('writes step shots of the latest run, sharing the final step with the run', async () => {
    const lastStepKey = 'browser-automations/org_1/bau/step-2.jpg';
    mockDb.browserAutomationRun.findFirst.mockResolvedValue(
      latestRun({
        screenshotUrl: lastStepKey,
        stepRuns: [
          { order: 0, screenshotUrl: 'k/step-1.jpg', focusScreenshotUrl: null },
          { order: 1, screenshotUrl: lastStepKey, focusScreenshotUrl: null },
        ],
      }),
    );
    const step = {
      status: 'completed',
      evaluationStatus: null,
      evaluationReason: null,
      error: null,
    };
    mockDb.browserAutomationRun.findMany.mockResolvedValueOnce([
      csvRun({
        id: 'bar_00000002',
        stepRuns: [
          { ...step, order: 0 },
          { ...step, order: 1 },
        ],
      }),
    ]);
    const archive = makeArchive();

    const stats = await exportOne(archive);

    expect(stats.browserScreenshots).toBe(2);
    const lines = fileOf(archive, 'runs.csv').trim().split('\n');
    expect(lines).toHaveLength(4); // header + run + 2 steps
    const runShot = lines[1].split(',').at(-2);
    expect(runShot).toBe('screenshots/2026-02-03_040506_00000002.jpg');
    expect(lines[2].split(',').at(-2)).toBe(
      'screenshots/2026-02-03_040506_00000002_step-1.jpg',
    );
    expect(lines[3].split(',').at(-2)).toBe(runShot);
    // Stored orders 0 and 1 are shown 1-based, matching automation.txt.
    expect(lines[2]).toMatch(/^bar_00000002,1,/);
    expect(lines[3]).toMatch(/^bar_00000002,2,/);
  });

  it('counts a screenshot whose stored copy is gone as missing, not written', async () => {
    mockDb.browserAutomationRun.findFirst.mockResolvedValue(
      latestRun({ screenshotUrl: 'browser-automations/gone.jpg' }),
    );

    const stats = await exportOne();

    expect(stats.browserScreenshots).toBe(0);
    expect(stats.browserScreenshotsMissing).toBe(1);
  });

  it('says so in automation.txt when no run captured a screenshot', async () => {
    mockDb.browserAutomationRun.findMany.mockResolvedValueOnce([csvRun()]);
    const archive = makeArchive();

    const stats = await exportOne(archive);

    expect(mockAppendAttachment).not.toHaveBeenCalled();
    expect(stats.browserScreenshots).toBe(0);
    expect(fileOf(archive, 'automation.txt')).toContain(
      'Screenshots: none of the exported runs captured one.',
    );
  });

  it('names the screenshot run in automation.txt', async () => {
    mockDb.browserAutomationRun.findFirst.mockResolvedValue(latestRun());
    const archive = makeArchive();

    await exportOne(archive);

    expect(fileOf(archive, 'automation.txt')).toContain(
      'run bar_00000002, 2026-02-03T04:05:06.000Z',
    );
  });
});
