import { db } from '@db';
import { BrowserAuthProfileService } from './browser-auth-profile.service';
import { BrowserAutomationExecutionService } from './browser-automation-execution.service';
import { BrowserEvidenceRunnerService } from './browser-evidence-runner.service';
import { BrowserbaseSessionService } from './browserbase-session.service';

jest.mock('@db', () => ({
  db: {
    $transaction: jest.fn(),
    browserAutomation: { findUnique: jest.fn() },
    browserAutomationRun: { updateMany: jest.fn(), findUnique: jest.fn() },
    browserAutomationStepRun: { create: jest.fn(), update: jest.fn() },
  },
  Prisma: {
    TransactionIsolationLevel: { Serializable: 'Serializable' },
  },
}));

describe('BrowserAutomationExecutionService', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    (db.$transaction as jest.Mock).mockImplementation(async (callback) =>
      callback({
        browserAutomationRun: {
          count: jest.fn().mockResolvedValue(0),
          create: jest.fn().mockResolvedValue({
            id: 'bar_1',
            automationId: 'bau_1',
            profileId: 'bap_1',
            startedAt: new Date('2026-06-19T12:00:00.000Z'),
          }),
        },
      }),
    );
    (db.browserAutomation.findUnique as jest.Mock).mockResolvedValue({
      id: 'bau_1',
      taskId: 'tsk_1',
      targetUrl: 'https://example.com',
      instruction: 'collect evidence',
      evaluationCriteria: null,
      task: { organizationId: 'org_1' },
    });
    (db.browserAutomationRun.updateMany as jest.Mock).mockResolvedValue({
      count: 1,
    });
    (db.browserAutomationStepRun.create as jest.Mock).mockResolvedValue({
      id: 'basr_1',
    });
  });

  it('persists a failed terminal state when the runner throws', async () => {
    const sessions = new BrowserbaseSessionService();
    const profiles = new BrowserAuthProfileService(sessions);
    const runner = new BrowserEvidenceRunnerService(sessions);

    jest.spyOn(profiles, 'resolveProfileForTarget').mockResolvedValue({
      id: 'bap_1',
      organizationId: 'org_1',
      hostname: 'example.com',
      loginIdentity: '',
      displayName: 'example.com browser profile',
      identifierLabel: null,
      contextId: 'ctx_1',
      status: 'verified',
      lastVerifiedAt: null,
      lastAuthCheckUrl: null,
      blockedReason: null,
      lastSignInOutcome: null,
      lastSignInDetail: null,
      lastSignInAt: null,
      vaultProvider: null,
      vaultExternalItemRef: null,
      vaultConnectionId: null,
      createdAt: new Date('2026-06-19T12:00:00.000Z'),
      updatedAt: new Date('2026-06-19T12:00:00.000Z'),
    });
    jest
      .spyOn(runner, 'runEvidence')
      .mockRejectedValue(new Error('Target closed'));

    const service = new BrowserAutomationExecutionService(
      sessions,
      profiles,
      runner,
    );

    const response = await service.runBrowserAutomation('bau_1', 'org_1');

    expect(response.success).toBe(false);
    expect(response.failureCode).toBe('browser_session_lost');
    expect(db.browserAutomationRun.updateMany).toHaveBeenCalledWith({
      where: { id: 'bar_1', status: 'running' },
      data: expect.objectContaining({
        status: 'failed',
        failureCode: 'browser_session_lost',
        failureStage: 'session',
      }),
    });
  });

  it("opens the org's public context for a public first step instead of throwing", async () => {
    const sessions = new BrowserbaseSessionService();
    const profiles = new BrowserAuthProfileService(sessions);
    const runner = new BrowserEvidenceRunnerService(sessions);

    // A public-first automation: no connection exists, and none should be
    // resolved (resolving would create a BrowserAuthProfile for the host).
    (db.browserAutomation.findUnique as jest.Mock).mockResolvedValue({
      id: 'bau_1',
      taskId: 'tsk_1',
      targetUrl: 'https://example.com/privacy',
      instruction: 'capture the privacy policy',
      evaluationCriteria: null,
      task: { organizationId: 'org_1' },
      steps: [
        {
          id: 'bas_1',
          order: 0,
          authMode: 'public',
          profileId: null,
          targetUrl: 'https://example.com/privacy',
          instruction: 'capture the privacy policy',
          evaluationCriteria: null,
        },
      ],
    });
    const resolveSpy = jest.spyOn(profiles, 'resolveProfileForTarget');
    const publicContextSpy = jest
      .spyOn(profiles, 'getOrCreatePublicContext')
      .mockResolvedValue('ctx_org_public');
    const createContext = jest
      .spyOn(sessions, 'createBrowserbaseContext')
      .mockResolvedValue('ctx_throwaway');
    const createSession = jest
      .spyOn(sessions, 'createSessionWithContext')
      .mockResolvedValue({ sessionId: 'sess_1', liveViewUrl: 'https://live' });

    const service = new BrowserAutomationExecutionService(
      sessions,
      profiles,
      runner,
    );

    const started = await service.startAutomationWithLiveView('bau_1', 'org_1');

    expect(started.sessionId).toBe('sess_1');
    // No connection to attribute the run to — the column is nullable for this.
    expect(started.profileId).toBeUndefined();
    expect(resolveSpy).not.toHaveBeenCalled();
    // The client hands this session id straight back to execute-live, where the
    // tenant guard resolves its context and demands the org own it. A per-run
    // context owned by nobody 403s there, so the session opens on the org's.
    expect(publicContextSpy).toHaveBeenCalledWith('org_1');
    expect(createContext).not.toHaveBeenCalled();
    expect(createSession).toHaveBeenCalledWith(
      'ctx_org_public',
      expect.anything(),
      false,
    );
  });

  it('rejects live-session replay when the run is already terminal', async () => {
    const sessions = new BrowserbaseSessionService();
    const profiles = new BrowserAuthProfileService(sessions);
    const runner = new BrowserEvidenceRunnerService(sessions);

    (db.browserAutomationRun.findUnique as jest.Mock).mockResolvedValue({
      id: 'bar_1',
      automationId: 'bau_1',
      status: 'completed',
    });
    const runSpy = jest.spyOn(runner, 'executeEvidenceOnSession');

    const service = new BrowserAutomationExecutionService(
      sessions,
      profiles,
      runner,
    );

    await expect(
      service.executeAutomationOnSession('bau_1', 'bar_1', 'sess_1', 'org_1'),
    ).rejects.toThrow('Run is no longer active');
    expect(runSpy).not.toHaveBeenCalled();
  });
});
