import { executeBrowserEvidence } from './browser-evidence-execution';
import { reloginWithStoredCredentials } from './browser-credential-login';
import { BrowserEvidenceRunnerService } from './browser-evidence-runner.service';
import { BrowserbaseScreenshotService } from './browserbase-screenshot.service';
import { BrowserbaseOrgContextService } from './browserbase-org-context.service';
import {
  BrowserbaseSessionService,
  CAPTURE_VIEWPORT,
} from './browserbase-session.service';
import type { BrowserCredentialVaultAdapter } from './credential-vault';

jest.mock('@db', () => ({ db: {}, Prisma: {} }));

jest.mock('@/app/s3', () => ({
  BUCKET_NAME: 'test-bucket',
  getSignedUrl: jest.fn(),
  s3Client: { send: jest.fn() },
}));

jest.mock('./browser-credential-login', () => ({
  reloginWithStoredCredentials: jest.fn(),
}));

jest.mock('./browser-evidence-page', () => ({
  resolveEvidencePage: jest.fn(),
  bringEvidencePageToFront: jest.fn(),
}));

jest.mock('./browser-evidence-evaluation', () => ({
  evaluateIfNeeded: jest.fn().mockResolvedValue({ success: true }),
}));

jest.mock('./screenshot-overlay', () => ({
  renderOverlay: jest.fn().mockResolvedValue(Buffer.from('overlaid')),
}));

jest.mock('sharp', () =>
  jest.fn(() => ({ metadata: async () => ({ height: 100 }) })),
);

import { resolveEvidencePage } from './browser-evidence-page';

const SAVED_PROFILE = {
  id: 'bap_1',
  hostname: 'vendor.example.com',
  contextId: 'ctx_saved',
  vaultProvider: '1password',
  vaultExternalItemRef: 'op://v/i',
  vaultConnectionId: 'v',
};

/** A page stub with just the surface executeBrowserEvidence touches. */
function makePage() {
  return {
    goto: jest.fn().mockResolvedValue(undefined),
    url: jest.fn().mockReturnValue('https://vendor.example.com/final'),
    screenshot: jest.fn().mockResolvedValue(Buffer.from('shot')),
  };
}

/** `extract` is how checkAuth asks the page whether a sign-in prompt is showing. */
function makeStagehand(isLoggedIn: boolean) {
  return {
    extract: jest.fn().mockResolvedValue({ isLoggedIn }),
    agent: jest.fn(() => ({ execute: jest.fn().mockResolvedValue(undefined) })),
    context: { pages: () => [] },
  };
}

function makeSessions(stagehand: ReturnType<typeof makeStagehand>) {
  const page = makePage();
  jest
    .mocked(resolveEvidencePage)
    .mockResolvedValue(
      page as unknown as Awaited<ReturnType<typeof resolveEvidencePage>>,
    );
  const sessions = new BrowserbaseSessionService();
  jest
    .spyOn(sessions, 'createStagehand')
    .mockResolvedValue(
      stagehand as unknown as Awaited<
        ReturnType<BrowserbaseSessionService['createStagehand']>
      >,
    );
  jest
    .spyOn(sessions, 'ensureActivePage')
    .mockResolvedValue(
      page as unknown as Awaited<
        ReturnType<BrowserbaseSessionService['ensureActivePage']>
      >,
    );
  jest.spyOn(sessions, 'safeCloseStagehand').mockResolvedValue(undefined);
  return { sessions, page };
}

const vault = {
  resolveCredentialReference: jest.fn().mockResolvedValue(null),
} as unknown as BrowserCredentialVaultAdapter;

const baseExecutionInput = {
  organizationId: 'org_1',
  automationId: 'bau_1',
  runId: 'bar_1',
  targetUrl: 'https://vendor.example.com/privacy',
  instruction: 'screenshot the privacy policy',
  sessionId: 'sess_1',
};

describe('executeBrowserEvidence auth staging', () => {
  beforeEach(() => jest.clearAllMocks());

  it('skips the auth check and credential re-login for a public step', async () => {
    // isLoggedIn:false would send a saved-session run down the re-login path —
    // a public run must not even ask.
    const stagehand = makeStagehand(false);
    const { sessions } = makeSessions(stagehand);

    const result = await executeBrowserEvidence({
      input: { ...baseExecutionInput, auth: { mode: 'public' } },
      sessions,
      logger: { warn: jest.fn(), error: jest.fn() } as never,
      vault,
    });

    expect(result.success).toBe(true);
    expect(stagehand.extract).not.toHaveBeenCalled();
    expect(reloginWithStoredCredentials).not.toHaveBeenCalled();
    // The timeline must not claim an auth stage the run never performed.
    expect(result.logs.map((log) => log.stage)).not.toContain('auth');
  });

  it('still checks auth and re-logs in for a saved-session step', async () => {
    const stagehand = makeStagehand(false);
    const { sessions } = makeSessions(stagehand);
    // `page` is threaded back into the run; undefined means "keep the current one".
    jest
      .mocked(reloginWithStoredCredentials)
      .mockResolvedValue({ isLoggedIn: true, page: undefined as never });

    const result = await executeBrowserEvidence({
      input: {
        ...baseExecutionInput,
        auth: { mode: 'saved_session', profile: SAVED_PROFILE },
      },
      sessions,
      logger: { warn: jest.fn(), error: jest.fn() } as never,
      vault,
    });

    expect(result.success).toBe(true);
    expect(stagehand.extract).toHaveBeenCalled();
    expect(reloginWithStoredCredentials).toHaveBeenCalledTimes(1);
    // The login target carries the profile and the step's URL, nothing more.
    expect(
      jest.mocked(reloginWithStoredCredentials).mock.calls[0][0].input,
    ).toEqual({
      profile: SAVED_PROFILE,
      targetUrl: baseExecutionInput.targetUrl,
    });
  });
});

// Failures are classified into user-facing text on the way out; errorDetail
// carries the raw cause across that boundary.
describe('executeBrowserEvidence error detail', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns the raw error alongside the classified one', async () => {
    const stagehand = makeStagehand(true);
    const { sessions, page } = makeSessions(stagehand);
    page.goto.mockRejectedValue(
      new Error('ECONNRESET while talking to the agent'),
    );

    const result = await executeBrowserEvidence({
      input: { ...baseExecutionInput, auth: { mode: 'public' } },
      sessions,
      logger: { warn: jest.fn(), error: jest.fn() } as never,
      vault,
    });

    expect(result.success).toBe(false);
    // Unrecognised, so the user-facing text says nothing useful…
    expect(result.failureCode).toBe('unknown');
    expect(result.error).toBe(
      'Browser automation failed for an unknown reason.',
    );
    // …which is exactly why the raw cause has to survive.
    expect(result.errorDetail).toContain(
      'ECONNRESET while talking to the agent',
    );
  });
});

describe('BrowserEvidenceRunnerService public sessions', () => {
  const buildRunner = () => {
    const sessions = new BrowserbaseSessionService();
    const screenshots = new BrowserbaseScreenshotService();
    const orgContexts = new BrowserbaseOrgContextService(sessions);
    const getPublicContext = jest
      .spyOn(orgContexts, 'getOrCreatePublicContext')
      .mockResolvedValue('ctx_org_public');
    const createContext = jest
      .spyOn(sessions, 'createBrowserbaseContext')
      .mockResolvedValue('ctx_throwaway');
    const createSession = jest
      .spyOn(sessions, 'createSessionWithContext')
      .mockResolvedValue({
        sessionId: 'sess_new',
        liveViewUrl: 'https://live',
      });
    const closeSession = jest
      .spyOn(sessions, 'closeSession')
      .mockResolvedValue(undefined);
    const service = new BrowserEvidenceRunnerService(
      sessions,
      screenshots,
      vault,
      orgContexts,
    );
    return {
      service,
      createContext,
      createSession,
      closeSession,
      getPublicContext,
    };
  };

  const publicInput = {
    ...baseExecutionInput,
    auth: { mode: 'public' as const },
  };

  beforeEach(() => jest.clearAllMocks());

  it("opens on the org's public context with persist:false, not a profile context", async () => {
    const { service, createContext, createSession, getPublicContext } =
      buildRunner();
    jest
      .spyOn(
        service as unknown as {
          executeEvidenceOnSessionUnlocked: () => Promise<unknown>;
        },
        'executeEvidenceOnSessionUnlocked',
      )
      .mockResolvedValue({ success: true, status: 'completed', logs: [] });

    await service.runEvidence(publicInput);

    // The org's own context, not a per-run one owned by nobody: the tenant
    // guards prove a session's org via its context, so an unowned context makes
    // every endpoint that takes the session id back reject it as another org's.
    expect(getPublicContext).toHaveBeenCalledWith(publicInput.organizationId);
    expect(createContext).not.toHaveBeenCalled();
    // persist:false is the guarantee that nothing is written back to the context.
    expect(createSession).toHaveBeenCalledWith(
      'ctx_org_public',
      CAPTURE_VIEWPORT,
      false,
    );
    // And never the saved connection's context.
    expect(createSession).not.toHaveBeenCalledWith(
      SAVED_PROFILE.contextId,
      expect.anything(),
      expect.anything(),
    );
  });

  it('closes the public session on the failure path too', async () => {
    const { service, closeSession } = buildRunner();
    jest
      .spyOn(
        service as unknown as {
          executeEvidenceOnSessionUnlocked: () => Promise<unknown>;
        },
        'executeEvidenceOnSessionUnlocked',
      )
      .mockRejectedValue(new Error('navigation blew up'));

    await expect(service.runEvidence(publicInput)).rejects.toThrow(
      'navigation blew up',
    );
    expect(closeSession).toHaveBeenCalledWith('sess_new');
  });
});
