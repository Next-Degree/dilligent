import { Injectable, Logger } from '@nestjs/common';
import { BrowserAuthProfileService } from './browser-auth-profile.service';
import { failedBrowserEvidenceRunResult } from './browser-automation-run-result';
import { BrowserAutomationRunStoreService } from './browser-automation-run-store.service';
import {
  isPublicStep,
  profileBlockedResult,
  profileMissingResult,
  rollUpStepResults,
  type StepForRun,
} from './browser-automation-step-results';
import type { BrowserEvidenceLog } from './browser-evidence-execution';
import {
  createEvidenceTimeline,
  type BrowserRunLivePhase,
  type EvidenceTimelineStep,
} from './browser-evidence-step-timeline';
import {
  BrowserEvidenceRunnerService,
  type BrowserEvidenceAuth,
  type BrowserEvidenceRunResult,
} from './browser-evidence-runner.service';
import { BrowserbaseSessionService } from './browserbase-session.service';

/** " · github.com" for a step's label, or "" when the URL can't be parsed. */
function hostSuffix(targetUrl: string): string {
  try {
    return ` · ${new URL(targetUrl).hostname.replace(/^www\./, '')}`;
  } catch {
    return '';
  }
}

type ResolvedProfile = Awaited<
  ReturnType<BrowserAuthProfileService['getProfile']>
>;

/**
 * Runs an automation's steps in order, each on its own connection's saved
 * session, and rolls the per-step results into a single run verdict. Owns the
 * per-step evidence bookkeeping (BrowserAutomationStepRun) and profile health
 * updates so the execution service stays focused on run lifecycle.
 */
@Injectable()
export class BrowserAutomationStepRunnerService {
  private readonly logger = new Logger(BrowserAutomationStepRunnerService.name);

  constructor(
    private readonly profiles: BrowserAuthProfileService = new BrowserAuthProfileService(
      new BrowserbaseSessionService(),
    ),
    private readonly runner: BrowserEvidenceRunnerService = new BrowserEvidenceRunnerService(
      new BrowserbaseSessionService(),
    ),
    private readonly runs: BrowserAutomationRunStoreService = new BrowserAutomationRunStoreService(),
  ) {}

  /** The connection a step runs on: its bound profile, or one matched by host. */
  async resolveStepProfile(input: {
    organizationId: string;
    step: StepForRun;
  }): Promise<ResolvedProfile> {
    // A public step has no connection, and asking for one would be actively
    // harmful: resolveProfileForTarget falls through to getOrCreateProfileFromUrl,
    // so a public host would silently gain a BrowserAuthProfile.
    if (isPublicStep(input.step)) return null;
    try {
      // Route through resolveProfileForTarget so an explicit binding is honored
      // exactly: it returns the context-ready profile, throws when the bound
      // profile is missing/cross-org, and rejects a host mismatch. That way a
      // broken binding fails as "no connection" (below) instead of silently
      // falling back to another host's login or handing over a pending context.
      return await this.profiles.resolveProfileForTarget({
        organizationId: input.organizationId,
        targetUrl: input.step.targetUrl,
        profileId: input.step.profileId ?? undefined,
      });
    } catch {
      return null;
    }
  }

  async runSteps(input: {
    organizationId: string;
    taskId: string;
    automationId: string;
    runId: string;
    steps: StepForRun[];
    firstProfile: ResolvedProfile;
    /** When set, step 0 runs on this already-open (live) session, not a new one. */
    firstSessionId?: string;
    /** Live activity timeline, streamed to the Run view via realtime. */
    onSteps?: (steps: EvidenceTimelineStep[]) => void;
    /** Follow each vendor's live view as the run advances to it. */
    onLiveView?: (url: string) => void;
    /** Live-view phase so the UI can cover the iframe between/after vendors. */
    onLivePhase?: (phase: BrowserRunLivePhase) => void;
  }): Promise<BrowserEvidenceRunResult> {
    const multiStep = input.steps.length > 1;
    const timeline = createEvidenceTimeline(input.onSteps);
    const results: BrowserEvidenceRunResult[] = [];
    for (let index = 0; index < input.steps.length; index += 1) {
      const profile =
        index === 0
          ? input.firstProfile
          : await this.resolveStepProfile({
              organizationId: input.organizationId,
              step: input.steps[index],
            });
      // Mark each vendor boundary so the combined timeline reads GH → AWS → …
      if (multiStep) {
        timeline.step(
          `Step ${index + 1}${hostSuffix(input.steps[index].targetUrl)}`,
        );
      }
      results.push(
        await this.runStep({
          organizationId: input.organizationId,
          taskId: input.taskId,
          automationId: input.automationId,
          runId: input.runId,
          step: input.steps[index],
          index,
          profile,
          // Step 0 runs on the pre-opened live session (so it's watchable);
          // later vendors each get their own session inside runEvidence.
          sessionId: index === 0 ? input.firstSessionId : undefined,
          onLog: (entry) => timeline.step(entry.message),
          onLiveView: input.onLiveView,
          // When this vendor's session is torn down, tell the UI whether another
          // vendor is coming ("switching") or the run is wrapping up ("finishing").
          onSessionClosing: () =>
            input.onLivePhase?.(
              index === input.steps.length - 1 ? 'finishing' : 'switching',
            ),
        }),
      );
    }
    const rolled = rollUpStepResults(results);
    timeline.finish(
      rolled.success ? 'done' : rolled.status === 'blocked' ? 'warn' : 'fail',
    );
    return rolled;
  }

  private async runStep(input: {
    organizationId: string;
    taskId: string;
    automationId: string;
    runId: string;
    step: StepForRun;
    index: number;
    profile: ResolvedProfile;
    /** Run this step on an existing (live) session instead of a fresh one. */
    sessionId?: string;
    /** Per-stage progress, streamed into the run timeline. */
    onLog?: (log: BrowserEvidenceLog) => void;
    /** This step's live view once its session opens (fresh-session steps only). */
    onLiveView?: (url: string) => void;
    /** Fired before this step's fresh session is closed (fresh-session steps only). */
    onSessionClosing?: () => void;
  }): Promise<BrowserEvidenceRunResult> {
    const stepRun = await this.runs.createStepRun({
      runId: input.runId,
      stepId: input.step.id,
      order: input.index,
    });
    const { profile } = input;
    const isPublic = isPublicStep(input.step);

    const result = isPublic
      ? await this.executeStep({
          ...input,
          stepRunId: stepRun.id,
          auth: { mode: 'public' },
        })
      : await this.runSavedSessionStep({
          ...input,
          stepRunId: stepRun.id,
          profile,
        });

    await this.runs.finishStepRun({ stepRunId: stepRun.id, result });
    // A public step has no connection whose health this outcome could describe,
    // so it never touches profile status.
    if (!isPublic && profile) {
      await this.applyProfileResult({
        organizationId: input.organizationId,
        profileId: profile.id,
        result,
      });
    }
    return result;
  }

  /** A saved-session step: needs a healthy connection before it can run at all. */
  private async runSavedSessionStep(input: {
    organizationId: string;
    taskId: string;
    automationId: string;
    step: StepForRun;
    stepRunId: string;
    profile: ResolvedProfile;
    sessionId?: string;
    onLog?: (log: BrowserEvidenceLog) => void;
    onLiveView?: (url: string) => void;
    onSessionClosing?: () => void;
  }): Promise<BrowserEvidenceRunResult> {
    const { profile } = input;
    if (!profile) return profileMissingResult();

    const canAutoRelogin =
      profile.status === 'needs_reauth' && Boolean(profile.vaultProvider);
    if (profile.status !== 'verified' && !canAutoRelogin) {
      return profileBlockedResult(profile.status);
    }

    return this.executeStep({
      ...input,
      auth: {
        mode: 'saved_session',
        profile: {
          id: profile.id,
          hostname: profile.hostname,
          contextId: profile.contextId,
          vaultProvider: profile.vaultProvider,
          vaultExternalItemRef: profile.vaultExternalItemRef,
          vaultConnectionId: profile.vaultConnectionId,
        },
      },
    });
  }

  /** Hand the step to the evidence runner, on the live session or a fresh one. */
  private async executeStep(input: {
    organizationId: string;
    taskId: string;
    automationId: string;
    step: StepForRun;
    stepRunId: string;
    auth: BrowserEvidenceAuth;
    sessionId?: string;
    onLog?: (log: BrowserEvidenceLog) => void;
    onLiveView?: (url: string) => void;
    onSessionClosing?: () => void;
  }): Promise<BrowserEvidenceRunResult> {
    try {
      const runInput = {
        organizationId: input.organizationId,
        taskId: input.taskId,
        automationId: input.automationId,
        // Unique per step so screenshots don't collide under one run id.
        runId: input.stepRunId,
        targetUrl: input.step.targetUrl,
        instruction: input.step.instruction,
        evaluationCriteria: input.step.evaluationCriteria,
        auth: input.auth,
        onLog: input.onLog,
      };
      return input.sessionId
        ? await this.runner.executeEvidenceOnSession({
            ...runInput,
            sessionId: input.sessionId,
          })
        : await this.runner.runEvidence({
            ...runInput,
            onSession: input.onLiveView
              ? (info) => input.onLiveView?.(info.liveViewUrl)
              : undefined,
            onSessionClosing: input.onSessionClosing,
          });
    } catch (error) {
      this.logger.error('Browser evidence runner failed', error);
      return failedBrowserEvidenceRunResult(error);
    }
  }

  /** Reflect a run's outcome onto the connection's health (verified/reauth/blocked). */
  async applyProfileResult(input: {
    organizationId: string;
    profileId: string;
    result: BrowserEvidenceRunResult;
  }) {
    if (input.result.success) {
      await this.profiles.markVerified({
        organizationId: input.organizationId,
        profileId: input.profileId,
      });
      return;
    }

    if (input.result.failureCode === 'needs_reauth') {
      await this.profiles.markNeedsReauth({
        organizationId: input.organizationId,
        profileId: input.profileId,
        reason: input.result.blockedReason,
      });
    }

    if (
      input.result.failureCode === 'captcha_blocked' ||
      input.result.failureCode === 'needs_user_action'
    ) {
      await this.profiles.markBlocked({
        organizationId: input.organizationId,
        profileId: input.profileId,
        reason:
          input.result.blockedReason ??
          input.result.error ??
          'User action is required before this automation can run.',
      });
    }
  }
}
