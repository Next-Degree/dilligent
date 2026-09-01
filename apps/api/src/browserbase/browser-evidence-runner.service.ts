import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@db';
import {
  BrowserbaseSessionService,
  CAPTURE_VIEWPORT,
} from './browserbase-session.service';
import { BrowserbaseScreenshotService } from './browserbase-screenshot.service';
import {
  BROWSER_CREDENTIAL_VAULT_ADAPTER,
  type BrowserCredentialVaultAdapter,
} from './credential-vault';
import { resolveBrowserCredentialVaultAdapter } from './browser-credential-vault.factory';
import {
  type BrowserAutomationFailureCode,
  type BrowserAutomationFailureStage,
} from './browser-automation-errors';
import {
  executeBrowserEvidence,
  type BrowserEvidenceLog,
  type BrowserEvidenceExecutionResult,
} from './browser-evidence-execution';
import { browserRunCoordinator } from './browser-run-coordinator';

/** The saved vendor login a `saved_session` step runs under. */
export interface BrowserEvidenceProfile {
  id: string;
  hostname: string;
  contextId: string;
  vaultProvider?: string | null;
  vaultExternalItemRef?: string | null;
  vaultConnectionId?: string | null;
}

/**
 * How a step authenticates. A discriminated union rather than a nullable
 * profile, so the compiler forces every read site to handle both modes instead
 * of silently falling through to connection resolution (which would *create* a
 * BrowserAuthProfile for a public host — exactly what public mode avoids).
 */
export type BrowserEvidenceAuth =
  | { mode: 'saved_session'; profile: BrowserEvidenceProfile }
  | { mode: 'public' };

export interface BrowserEvidenceRunnerInput {
  organizationId: string;
  taskId?: string;
  automationId: string;
  runId: string;
  targetUrl: string;
  instruction: string;
  evaluationCriteria?: string | null;
  auth: BrowserEvidenceAuth;
  beforeExecution?: () => Promise<void>;
  /** Live per-stage progress callback (used to stream a test run's activity). */
  onLog?: (log: BrowserEvidenceLog) => void;
  /** Fired as the agent switches tabs, so a watched run's live view follows it. */
  onLiveView?: (url: string) => void;
  /** Fired once this step's live session opens, so the Run view can follow it. */
  onSession?: (info: { sessionId: string; liveViewUrl: string }) => void;
  /**
   * Fired right before this step's session is torn down, so the Run view can
   * cover the (about-to-disconnect) live iframe with a transition state.
   */
  onSessionClosing?: () => void;
}

export interface BrowserEvidenceSessionInput extends BrowserEvidenceRunnerInput {
  sessionId: string;
}

export interface BrowserEvidenceRunResult {
  success: boolean;
  status: 'completed' | 'failed' | 'blocked';
  screenshotKey?: string;
  screenshotUrl?: string;
  /** A focused close-up (the agent's final viewport) shown beside the full page. */
  focusScreenshotKey?: string;
  focusScreenshotUrl?: string;
  finalUrl?: string;
  evaluationStatus?: 'pass' | 'fail';
  evaluationReason?: string;
  error?: string;
  needsReauth?: boolean;
  failureCode?: BrowserAutomationFailureCode;
  failureStage?: BrowserAutomationFailureStage;
  blockedReason?: string;
  logs: Prisma.InputJsonValue;
}

/** Host of a step's URL, for the per-host throttle. '' when it can't be parsed. */
function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

const toJsonLogs = (logs: BrowserEvidenceLog[]): Prisma.InputJsonArray =>
  logs.map((log): Prisma.InputJsonObject => ({
    timestamp: log.timestamp,
    stage: log.stage,
    message: log.message,
  }));

@Injectable()
export class BrowserEvidenceRunnerService {
  private readonly logger = new Logger(BrowserEvidenceRunnerService.name);

  constructor(
    private readonly sessions: BrowserbaseSessionService = new BrowserbaseSessionService(),
    private readonly screenshots: BrowserbaseScreenshotService = new BrowserbaseScreenshotService(),
    @Inject(BROWSER_CREDENTIAL_VAULT_ADAPTER)
    private readonly vault: BrowserCredentialVaultAdapter = resolveBrowserCredentialVaultAdapter(),
  ) {}

  async runEvidence(
    input: BrowserEvidenceRunnerInput,
  ): Promise<BrowserEvidenceRunResult> {
    return this.withRunTurn(input, async () => {
      const { sessionId, liveViewUrl } = await this.openSession(input.auth);

      try {
        // Surface this step's live view so a watched run can follow each
        // vendor. Inside the try so a throwing callback still closes the session.
        input.onSession?.({ sessionId, liveViewUrl });
        return await this.executeEvidenceOnSessionUnlocked({
          ...input,
          sessionId,
        });
      } finally {
        // Signal the imminent teardown before we actually close, so the UI can
        // cover the live view before Browserbase's iframe shows "disconnected".
        // Best-effort: a UI callback failure must never skip the session close.
        try {
          input.onSessionClosing?.();
        } catch {
          // The teardown signal is cosmetic — ignore and still close.
        }
        await this.closeSession(sessionId);
      }
    });
  }

  async executeEvidenceOnSession(
    input: BrowserEvidenceSessionInput,
  ): Promise<BrowserEvidenceRunResult> {
    return this.withRunTurn(input, () =>
      this.executeEvidenceOnSessionUnlocked(input),
    );
  }

  /**
   * Serialize the run: a saved-session run takes its connection's lock (two runs
   * must not share one cookie context), a public run only takes the per-host
   * turn — it has no profile to lock and no shared state to corrupt.
   */
  private withRunTurn<T>(
    input: BrowserEvidenceRunnerInput,
    run: () => Promise<T>,
  ): Promise<T> {
    if (input.auth.mode === 'public') {
      return browserRunCoordinator.withPublicRun({
        hostname: hostnameOf(input.targetUrl),
        run,
      });
    }
    return browserRunCoordinator.withProfileLock({
      profileId: input.auth.profile.id,
      hostname: input.auth.profile.hostname,
      run,
    });
  }

  /**
   * A saved-session run opens on the connection's context so it inherits the
   * saved login. A public run gets a fresh throwaway context with
   * `persist: false` — Browserbase has no context-less session API, and
   * persist:false is what guarantees nothing is written back. The context id is
   * deliberately never stored on any row, so the session leaves no trace.
   */
  private async openSession(
    auth: BrowserEvidenceAuth,
  ): Promise<{ sessionId: string; liveViewUrl: string }> {
    if (auth.mode === 'public') {
      const contextId = await this.sessions.createBrowserbaseContext();
      return this.sessions.createSessionWithContext(
        contextId,
        CAPTURE_VIEWPORT,
        false,
      );
    }
    return this.sessions.createSessionWithContext(auth.profile.contextId);
  }

  private async executeEvidenceOnSessionUnlocked(
    input: BrowserEvidenceSessionInput,
  ): Promise<BrowserEvidenceRunResult> {
    await input.beforeExecution?.();

    const execution = await executeBrowserEvidence({
      input,
      sessions: this.sessions,
      logger: this.logger,
      vault: this.vault,
      onLog: input.onLog,
      onLiveView: input.onLiveView,
    });
    let uploaded: {
      screenshotKey?: string;
      screenshotUrl?: string;
      focusScreenshotKey?: string;
      focusScreenshotUrl?: string;
    } | null = null;
    try {
      uploaded = await this.uploadCapturedScreenshot({ input, execution });
    } catch (err) {
      this.logger.warn(
        'Screenshot upload failed; continuing without screenshot',
        {
          runId: input.runId,
          error: err instanceof Error ? err.message : String(err),
        },
      );
      execution.logs.push({
        timestamp: new Date().toISOString(),
        stage: 'upload',
        message: 'Screenshot upload failed; run completed without screenshot.',
      });
    }

    if (!execution.success) {
      return {
        success: false,
        status: this.blockedStatusForCode(execution.failureCode),
        screenshotKey: uploaded?.screenshotKey,
        screenshotUrl: uploaded?.screenshotUrl,
        focusScreenshotKey: uploaded?.focusScreenshotKey,
        focusScreenshotUrl: uploaded?.focusScreenshotUrl,
        finalUrl: execution.finalUrl,
        evaluationStatus: execution.evaluationStatus,
        evaluationReason: execution.evaluationReason,
        error: execution.error,
        needsReauth: execution.needsReauth,
        failureCode: execution.failureCode,
        failureStage: execution.failureStage,
        blockedReason: execution.blockedReason,
        logs: toJsonLogs(execution.logs),
      };
    }

    return {
      success: true,
      status: 'completed',
      screenshotKey: uploaded?.screenshotKey,
      screenshotUrl: uploaded?.screenshotUrl,
      focusScreenshotKey: uploaded?.focusScreenshotKey,
      focusScreenshotUrl: uploaded?.focusScreenshotUrl,
      finalUrl: execution.finalUrl,
      evaluationStatus: execution.evaluationStatus,
      evaluationReason: execution.evaluationReason,
      logs: toJsonLogs(execution.logs),
    };
  }

  private async uploadOne(
    input: BrowserEvidenceRunnerInput,
    base64: string,
    variant?: string,
  ): Promise<{ key: string; url: string }> {
    // A variant keys to a distinct object (…/runId-focus.jpg) so it doesn't
    // overwrite the full-page shot.
    const key = await this.screenshots.uploadScreenshot({
      organizationId: input.organizationId,
      automationId: input.automationId,
      runId: variant ? `${input.runId}-${variant}` : input.runId,
      base64Screenshot: base64,
    });
    const url = await this.screenshots.getPresignedUrl({ key });
    return { key, url };
  }

  private async uploadCapturedScreenshot({
    input,
    execution,
  }: {
    input: BrowserEvidenceRunnerInput;
    execution: BrowserEvidenceExecutionResult;
  }): Promise<{
    screenshotKey?: string;
    screenshotUrl?: string;
    focusScreenshotKey?: string;
    focusScreenshotUrl?: string;
  } | null> {
    if (!execution.screenshot) return null;

    const [full, focus] = await Promise.all([
      this.uploadOne(input, execution.screenshot),
      // The close-up is a nice-to-have — a focus-upload failure must NOT sink the
      // full-page evidence, so it degrades to null instead of rejecting.
      execution.focusScreenshot
        ? this.uploadOne(input, execution.focusScreenshot, 'focus').catch(
            (err) => {
              this.logger.warn(
                'Focus screenshot upload failed; keeping the full-page only',
                {
                  runId: input.runId,
                  error: err instanceof Error ? err.message : String(err),
                },
              );
              return null;
            },
          )
        : Promise.resolve(null),
    ]);

    return {
      screenshotKey: full.key,
      screenshotUrl: full.url,
      focusScreenshotKey: focus?.key,
      focusScreenshotUrl: focus?.url,
    };
  }

  private async closeSession(sessionId: string): Promise<void> {
    try {
      await this.sessions.closeSession(sessionId);
    } catch (err) {
      this.logger.warn('Failed to close Browserbase session (ignored)', {
        sessionId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private blockedStatusForCode(
    code: BrowserAutomationFailureCode | undefined,
  ): 'failed' | 'blocked' {
    if (code === 'captcha_blocked' || code === 'needs_user_action') {
      return 'blocked';
    }
    return 'failed';
  }
}
