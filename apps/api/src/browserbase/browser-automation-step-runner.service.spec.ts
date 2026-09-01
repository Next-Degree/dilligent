import { BrowserAuthProfileService } from './browser-auth-profile.service';
import { BrowserAutomationRunStoreService } from './browser-automation-run-store.service';
import { BrowserAutomationStepRunnerService } from './browser-automation-step-runner.service';
import type { StepForRun } from './browser-automation-step-results';
import { BrowserEvidenceRunnerService } from './browser-evidence-runner.service';
import { BrowserbaseSessionService } from './browserbase-session.service';
import {
  PUBLIC_AUTH_MODE,
  SAVED_SESSION_AUTH_MODE,
} from './browser-step-auth-mode';

jest.mock('@db', () => ({ db: {}, Prisma: {} }));

jest.mock('@/app/s3', () => ({
  BUCKET_NAME: 'test-bucket',
  getSignedUrl: jest.fn(),
  s3Client: { send: jest.fn() },
}));

const publicStep: StepForRun = {
  id: 'bas_public',
  order: 0,
  authMode: PUBLIC_AUTH_MODE,
  profileId: null,
  targetUrl: 'https://example.com/privacy',
  instruction: 'screenshot the privacy policy',
  evaluationCriteria: null,
};

const savedStep: StepForRun = {
  id: 'bas_saved',
  order: 0,
  authMode: SAVED_SESSION_AUTH_MODE,
  profileId: 'bap_1',
  targetUrl: 'https://vendor.example.com/settings',
  instruction: 'screenshot the MFA policy',
  evaluationCriteria: null,
};

const succeeded = {
  success: true,
  status: 'completed' as const,
  logs: [],
};

function build() {
  const sessions = new BrowserbaseSessionService();
  const profiles = new BrowserAuthProfileService(sessions);
  const runner = new BrowserEvidenceRunnerService(sessions);
  const runs = new BrowserAutomationRunStoreService();

  const resolveProfileForTarget = jest
    .spyOn(profiles, 'resolveProfileForTarget')
    .mockRejectedValue(new Error('resolveProfileForTarget must not be called'));
  // These return the updated profile row; the tests only care that they're
  // called (or not), so a minimal stand-in stands in for the whole row.
  const updatedProfile = { id: 'bap_1' } as never;
  const markVerified = jest
    .spyOn(profiles, 'markVerified')
    .mockResolvedValue(updatedProfile);
  const markNeedsReauth = jest
    .spyOn(profiles, 'markNeedsReauth')
    .mockResolvedValue(updatedProfile);
  const markBlocked = jest
    .spyOn(profiles, 'markBlocked')
    .mockResolvedValue(updatedProfile);

  const runEvidence = jest
    .spyOn(runner, 'runEvidence')
    .mockResolvedValue(succeeded);
  jest.spyOn(runner, 'executeEvidenceOnSession').mockResolvedValue(succeeded);

  jest
    .spyOn(runs, 'createStepRun')
    .mockImplementation(async () => ({ id: 'basr_1' }) as never);
  jest.spyOn(runs, 'finishStepRun').mockResolvedValue(undefined as never);

  const service = new BrowserAutomationStepRunnerService(
    profiles,
    runner,
    runs,
  );
  return {
    service,
    resolveProfileForTarget,
    markVerified,
    markNeedsReauth,
    markBlocked,
    runEvidence,
  };
}

const runInput = (steps: StepForRun[]) => ({
  organizationId: 'org_1',
  taskId: 'tsk_1',
  automationId: 'bau_1',
  runId: 'bar_1',
  steps,
  firstProfile: null,
});

describe('BrowserAutomationStepRunnerService — public steps', () => {
  beforeEach(() => jest.clearAllMocks());

  it('never resolves a connection for a public step', async () => {
    const { service, resolveProfileForTarget } = build();

    const resolved = await service.resolveStepProfile({
      organizationId: 'org_1',
      step: publicStep,
    });

    expect(resolved).toBeNull();
    // resolveProfileForTarget falls through to getOrCreateProfileFromUrl, so
    // calling it at all would give the public host a BrowserAuthProfile.
    expect(resolveProfileForTarget).not.toHaveBeenCalled();
  });

  it('runs a public step instead of reporting a missing connection', async () => {
    const { service, runEvidence } = build();

    const result = await service.runSteps(runInput([publicStep]));

    expect(result.success).toBe(true);
    expect(result.blockedReason).toBeUndefined();
    expect(runEvidence).toHaveBeenCalledTimes(1);
    expect(runEvidence.mock.calls[0][0].auth).toEqual({ mode: 'public' });
  });

  it('never touches connection health for a public step', async () => {
    const { service, markVerified, markNeedsReauth, markBlocked } = build();

    await service.runSteps(runInput([publicStep]));

    expect(markVerified).not.toHaveBeenCalled();
    expect(markNeedsReauth).not.toHaveBeenCalled();
    expect(markBlocked).not.toHaveBeenCalled();
  });

  it('still reports a missing connection for a saved-session step', async () => {
    const { service, runEvidence } = build();

    const result = await service.runSteps(runInput([savedStep]));

    expect(result.success).toBe(false);
    expect(result.failureCode).toBe('needs_reauth');
    expect(result.blockedReason).toBe('No connection is bound to this step.');
    expect(runEvidence).not.toHaveBeenCalled();
  });

  it('rolls up a mixed automation: saved-session step 1, public step 2', async () => {
    const { service, resolveProfileForTarget, runEvidence, markVerified } =
      build();
    const profile = {
      id: 'bap_1',
      hostname: 'vendor.example.com',
      contextId: 'ctx_saved',
      status: 'verified',
      vaultProvider: null,
      vaultExternalItemRef: null,
      vaultConnectionId: null,
    };

    const result = await service.runSteps({
      ...runInput([savedStep, { ...publicStep, order: 1 }]),
      firstProfile: profile as never,
    });

    expect(result.success).toBe(true);
    expect(runEvidence).toHaveBeenCalledTimes(2);
    expect(runEvidence.mock.calls[0][0].auth).toEqual({
      mode: 'saved_session',
      profile: expect.objectContaining({ id: 'bap_1', contextId: 'ctx_saved' }),
    });
    expect(runEvidence.mock.calls[1][0].auth).toEqual({ mode: 'public' });
    // Step 2 is public, so the second step never asks for a connection…
    expect(resolveProfileForTarget).not.toHaveBeenCalled();
    // …and only step 1's connection has its health updated.
    expect(markVerified).toHaveBeenCalledTimes(1);
  });
});
