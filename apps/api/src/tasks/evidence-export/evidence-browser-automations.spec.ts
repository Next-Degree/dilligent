const mockDb = {
  browserAutomation: { findMany: jest.fn() },
  browserAutomationRun: { findMany: jest.fn() },
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
    attachment: { name: string };
    uniqueName: (raw: string) => string;
  }) => {
    mockAppendAttachment(params);
    params.uniqueName(params.attachment.name);
    return Promise.resolve();
  },
  createFilenameTracker: () => (raw: string) => raw,
}));

import {
  appendBrowserAutomationsToArchive,
  getTaskBrowserAutomations,
  toCsvField,
  type BrowserAutomationHeader,
} from './evidence-browser-automations';

const created = new Date('2026-02-03T04:05:06.000Z');

function run(overrides: Record<string, unknown> = {}) {
  return {
    id: 'bar_00000001',
    status: 'completed',
    createdAt: created,
    startedAt: created,
    completedAt: created,
    screenshotUrl: 'browser-automations/org_1/bau_1/bar_1.jpg',
    focusScreenshotUrl: null,
    evaluationStatus: 'pass',
    evaluationReason: 'Status page shows uptime',
    finalUrl: 'https://status.example.com',
    error: null,
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
  runCount: 1,
};

function appendedNames(archive: { append: jest.Mock }): string[] {
  return archive.append.mock.calls.map((call) => call[1].name);
}

function csvOf(archive: { append: jest.Mock }): string {
  const call = archive.append.mock.calls.find((c) =>
    c[1].name.endsWith('runs.csv'),
  );
  return (call?.[0] as Buffer).toString('utf-8');
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
    expect(result).toHaveLength(1);
    expect(result[0].runCount).toBe(3);
  });
});

describe('appendBrowserAutomationsToArchive', () => {
  beforeEach(() => jest.clearAllMocks());

  it('writes screenshots, automation.txt and a runs.csv row per run', async () => {
    mockDb.browserAutomationRun.findMany.mockResolvedValueOnce([
      run({
        focusScreenshotUrl: 'browser-automations/org_1/bau_1/bar_1-focus.png',
      }),
    ]);
    const archive = { append: jest.fn() };

    const stats = await appendBrowserAutomationsToArchive({
      archive: archive as never,
      automations: [automation],
      folderPath: 'task/03-browser-automations',
    });

    expect(stats).toEqual({
      browserAutomations: 1,
      browserRuns: 1,
      browserScreenshots: 2,
    });
    const folder = 'task/03-browser-automations/status-page-12345678';
    expect(mockAppendAttachment.mock.calls.map((c) => c[0].folderPath)).toEqual(
      [`${folder}/screenshots`, `${folder}/screenshots`],
    );
    expect(mockAppendAttachment.mock.calls[1][0].attachment.name).toMatch(
      /_00000001_focus\.png$/,
    );
    expect(appendedNames(archive)).toEqual([
      `${folder}/automation.txt`,
      `${folder}/runs.csv`,
    ]);

    const csv = csvOf(archive);
    expect(csv.split('\n')[0]).toContain('run_id,step,created_at');
    expect(csv).toContain('bar_00000001,,2026-02-03T04:05:06.000Z');
    expect(csv).toContain('pass,Status page shows uptime');
  });

  it('only fetches finished runs, in chronological order', async () => {
    mockDb.browserAutomationRun.findMany.mockResolvedValueOnce([]);
    await appendBrowserAutomationsToArchive({
      archive: { append: jest.fn() } as never,
      automations: [automation],
      folderPath: 'f',
    });

    const query = mockDb.browserAutomationRun.findMany.mock.calls[0][0];
    expect(query.where.status.in).toEqual(['completed', 'failed', 'blocked']);
    expect(query.orderBy).toEqual([{ createdAt: 'asc' }, { id: 'asc' }]);
    expect(query.select).not.toHaveProperty('errorDetail');
    expect(query.select).not.toHaveProperty('logs');
  });

  it('pages through runs with a cursor until a short batch', async () => {
    const fullBatch = Array.from({ length: 100 }, (_, i) =>
      run({ id: `bar_${String(i).padStart(8, '0')}`, screenshotUrl: null }),
    );
    mockDb.browserAutomationRun.findMany
      .mockResolvedValueOnce(fullBatch)
      .mockResolvedValueOnce([
        run({ id: 'bar_last0001', screenshotUrl: null }),
      ]);

    const stats = await appendBrowserAutomationsToArchive({
      archive: { append: jest.fn() } as never,
      automations: [automation],
      folderPath: 'f',
    });

    expect(stats.browserRuns).toBe(101);
    const second = mockDb.browserAutomationRun.findMany.mock.calls[1][0];
    expect(second.cursor).toEqual({ id: 'bar_00000099' });
    expect(second.skip).toBe(1);
  });

  it('adds step rows and writes a shared screenshot only once', async () => {
    const lastStepKey = 'browser-automations/org_1/bau_1/step-2.jpg';
    mockDb.browserAutomationRun.findMany.mockResolvedValueOnce([
      run({
        screenshotUrl: lastStepKey,
        stepRuns: [
          {
            order: 1,
            status: 'completed',
            screenshotUrl: 'browser-automations/org_1/bau_1/step-1.jpg',
            focusScreenshotUrl: null,
            evaluationStatus: null,
            evaluationReason: null,
            error: null,
          },
          {
            order: 2,
            status: 'completed',
            screenshotUrl: lastStepKey,
            focusScreenshotUrl: null,
            evaluationStatus: 'pass',
            evaluationReason: 'ok',
            error: null,
          },
        ],
      }),
    ]);
    const archive = { append: jest.fn() };

    const stats = await appendBrowserAutomationsToArchive({
      archive: archive as never,
      automations: [automation],
      folderPath: 'f',
    });

    // run shot + step 1 shot; step 2 reuses the run's file.
    expect(stats.browserScreenshots).toBe(2);
    const lines = csvOf(archive).trim().split('\n');
    expect(lines).toHaveLength(4); // header + run + 2 steps
    const runShot = lines[1].split(',').at(-2);
    expect(lines[3].split(',').at(-2)).toBe(runShot);
    expect(lines[2]).toMatch(/^bar_00000001,1,/);
  });

  it('skips values that are not S3 keys', async () => {
    mockDb.browserAutomationRun.findMany.mockResolvedValueOnce([
      run({ screenshotUrl: 'https://signed.example.com/x.jpg' }),
    ]);

    const stats = await appendBrowserAutomationsToArchive({
      archive: { append: jest.fn() } as never,
      automations: [automation],
      folderPath: 'f',
    });

    expect(stats.browserScreenshots).toBe(0);
    expect(mockAppendAttachment).not.toHaveBeenCalled();
  });
});

describe('toCsvField', () => {
  it('quotes commas, quotes and newlines', () => {
    expect(toCsvField('a,b')).toBe('"a,b"');
    expect(toCsvField('say "hi"')).toBe('"say ""hi"""');
    expect(toCsvField('line1\nline2')).toBe('"line1\nline2"');
  });

  it('neutralises spreadsheet formulas', () => {
    expect(toCsvField('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(toCsvField('-1')).toBe("'-1");
  });

  it('renders empty values as empty fields', () => {
    expect(toCsvField(null)).toBe('');
    expect(toCsvField(undefined)).toBe('');
  });
});
