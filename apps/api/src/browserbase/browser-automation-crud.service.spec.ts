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
    },
    browserAutomationStep: { deleteMany: jest.fn(), updateMany: jest.fn() },
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
