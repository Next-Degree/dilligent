import { db } from '@db';
import { BrowserAutomationCrudService } from './browser-automation-crud.service';
import { BrowserbaseScreenshotService } from './browserbase-screenshot.service';

jest.mock('@db', () => ({
  db: {
    $transaction: jest.fn(),
    task: { findFirst: jest.fn() },
    browserAutomation: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    browserAutomationStep: { deleteMany: jest.fn(), updateMany: jest.fn() },
    browserAutomationRun: { findMany: jest.fn(), findUnique: jest.fn() },
  },
  TaskFrequency: { daily: 'daily' },
}));

jest.mock('@/app/s3', () => ({
  BUCKET_NAME: 'test-bucket',
  getSignedUrl: jest.fn(),
  s3Client: { send: jest.fn() },
}));

/** The steps `create` was asked to write, in order. */
function createdSteps(mock: jest.Mock) {
  return mock.mock.calls[0][0].data.steps.create;
}

describe('BrowserAutomationCrudService authMode', () => {
  const service = new BrowserAutomationCrudService(
    new BrowserbaseScreenshotService(),
  );

  beforeEach(() => {
    jest.clearAllMocks();
    (db.task.findFirst as jest.Mock).mockResolvedValue({ id: 'tsk_1' });
    (db.browserAutomation.findFirst as jest.Mock).mockResolvedValue(null);
    (db.browserAutomation.create as jest.Mock).mockResolvedValue({
      id: 'bau_1',
    });
    (db.browserAutomation.findUnique as jest.Mock).mockResolvedValue({
      id: 'bau_1',
      task: { organizationId: 'org_1' },
    });
  });

  const steps = [
    {
      authMode: 'public' as const,
      // A stale binding left over from the step's saved-session past. It must
      // not survive: a public step never runs on a connection.
      profileId: 'bap_stale',
      targetUrl: 'https://example.com/privacy',
      instruction: 'capture the privacy policy',
    },
    {
      profileId: 'bap_1',
      targetUrl: 'https://vendor.example.com/settings',
      instruction: 'capture the MFA policy',
    },
  ];

  it('stores authMode on create and drops a public step’s stale profileId', async () => {
    await service.createBrowserAutomation(
      {
        taskId: 'tsk_1',
        name: 'Evidence',
        targetUrl: steps[0].targetUrl,
        instruction: steps[0].instruction,
        steps,
      },
      'org_1',
    );

    expect(createdSteps(db.browserAutomation.create as jest.Mock)).toEqual([
      expect.objectContaining({
        order: 0,
        authMode: 'public',
        profileId: null,
      }),
      // An omitted authMode keeps today's behavior rather than becoming public.
      expect.objectContaining({
        order: 1,
        authMode: 'saved_session',
        profileId: 'bap_1',
      }),
    ]);
  });

  it('stores authMode on update too (update recreates the whole step list)', async () => {
    const update = jest.fn().mockResolvedValue({ id: 'bau_1' });
    (db.$transaction as jest.Mock).mockImplementation(async (callback) =>
      callback({
        browserAutomationStep: { deleteMany: jest.fn() },
        browserAutomation: { update },
      }),
    );

    await service.updateBrowserAutomation('bau_1', { steps }, 'org_1');

    expect(update.mock.calls[0][0].data.steps.create).toEqual([
      expect.objectContaining({ authMode: 'public', profileId: null }),
      expect.objectContaining({
        authMode: 'saved_session',
        profileId: 'bap_1',
      }),
    ]);
  });

  it('defaults the legacy single-instruction shape to saved_session', async () => {
    await service.createBrowserAutomation(
      {
        taskId: 'tsk_1',
        name: 'Evidence',
        targetUrl: 'https://vendor.example.com',
        instruction: 'capture evidence',
      },
      'org_1',
    );

    expect(createdSteps(db.browserAutomation.create as jest.Mock)).toEqual([
      expect.objectContaining({ authMode: 'saved_session', profileId: null }),
    ]);
  });
});

/**
 * errorDetail holds a raw error message and stack, read straight from the
 * database when diagnosing a run. A stack can carry internal hostnames or a
 * secret echoed back by an upstream service, and these rows are readable by
 * anyone who can read the automation, so every query returning a run must
 * exclude it. Asserted on the query arguments, so a new query that forgets
 * fails here rather than leaking quietly.
 */
describe('BrowserAutomationCrudService keeps errorDetail out of responses', () => {
  const service = new BrowserAutomationCrudService(
    new BrowserbaseScreenshotService(),
  );

  beforeEach(() => {
    jest.clearAllMocks();
    (db.task.findFirst as jest.Mock).mockResolvedValue({ id: 'tsk_1' });
    (db.browserAutomation.findUnique as jest.Mock).mockResolvedValue(null);
    (db.browserAutomation.findMany as jest.Mock).mockResolvedValue([]);
    (db.browserAutomationRun.findMany as jest.Mock).mockResolvedValue([]);
    (db.browserAutomationRun.findUnique as jest.Mock).mockResolvedValue(null);
  });

  // The nested cases are the easy ones to miss: the omit belongs on the
  // relation, not on the automation query wrapped around it.
  it.each([
    [
      'listing an automation’s runs',
      () => service.getAutomationRuns('bau_1', 20),
      () => (db.browserAutomationRun.findMany as jest.Mock).mock.calls[0][0],
    ],
    [
      'fetching one run',
      () => service.getRunWithPresignedUrl('bar_1'),
      () => (db.browserAutomationRun.findUnique as jest.Mock).mock.calls[0][0],
    ],
    [
      'runs nested in one automation',
      () => service.getBrowserAutomation('bau_1'),
      () =>
        (db.browserAutomation.findUnique as jest.Mock).mock.calls[0][0].include
          .runs,
    ],
    [
      'runs nested in a task’s automations',
      () => service.getBrowserAutomationsForTask('tsk_1'),
      () =>
        (db.browserAutomation.findMany as jest.Mock).mock.calls[0][0].include
          .runs,
    ],
  ])('omits it when %s', async (_label, call, queryArgs) => {
    await call();

    expect(queryArgs().omit?.errorDetail).toBe(true);
  });
});
