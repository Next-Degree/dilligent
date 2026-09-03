import type { BrowserStepAuthMode } from '@db';
import {
  isPublicAuthMode,
  SAVED_SESSION_AUTH_MODE,
} from './browser-step-auth-mode';
import type { BrowserEvidenceRunResult } from './browser-evidence-runner.service';

/** A normalized step to execute (real step row, or a legacy inline instruction). */
export type StepForRun = {
  id: string | null;
  order: number;
  authMode: BrowserStepAuthMode;
  profileId: string | null;
  targetUrl: string;
  instruction: string;
  evaluationCriteria: string | null;
};

/** True when this step runs without a login, on a throwaway session. */
export function isPublicStep(step: { authMode: BrowserStepAuthMode }): boolean {
  return isPublicAuthMode(step.authMode);
}

/**
 * A step row must state its auth mode. The column is NOT NULL with a default, so
 * a client generated from the current schema can never hand back null or
 * undefined here — the only way to reach this is a Prisma client generated from
 * an older schema, which omits the column from its SELECT entirely.
 *
 * That deserves to fail loudly. Defaulting it instead (as this did) silently
 * demotes a `public` step to `saved_session`, which then resolves a connection
 * by host, CREATES an unverified BrowserAuthProfile for a public site, and
 * reports "reconnect this connection" — a deployment mismatch wearing a
 * plausible product error as a disguise.
 */
function assertAuthMode(step: {
  id: string;
  authMode?: BrowserStepAuthMode | null;
}): BrowserStepAuthMode {
  if (step.authMode == null) {
    throw new Error(
      `Browser automation step ${step.id} loaded without an authMode. ` +
        'That column is NOT NULL, so the running Prisma client was generated ' +
        'from an older schema. Rebuild @trycompai/db and redeploy — do not run ' +
        'the step, since guessing its auth mode creates spurious connections.',
    );
  }
  return step.authMode;
}

/** Steps to run: the ordered step rows, or the inline instruction as one step. */
export function stepsForRun(automation: {
  targetUrl: string;
  instruction: string;
  evaluationCriteria: string | null;
  steps?: Array<{
    id: string;
    order: number;
    authMode?: BrowserStepAuthMode | null;
    profileId: string | null;
    targetUrl: string;
    instruction: string;
    evaluationCriteria: string | null;
  }>;
}): StepForRun[] {
  if (automation.steps && automation.steps.length > 0) {
    return [...automation.steps]
      .sort((a, b) => a.order - b.order)
      .map((step) => ({
        id: step.id,
        order: step.order,
        authMode: assertAuthMode(step),
        profileId: step.profileId,
        targetUrl: step.targetUrl,
        instruction: step.instruction,
        evaluationCriteria: step.evaluationCriteria,
      }));
  }
  return [
    {
      id: null,
      order: 0,
      // The legacy inline instruction predates public mode and has always
      // resolved a connection by host, so it stays saved_session.
      authMode: SAVED_SESSION_AUTH_MODE,
      profileId: null,
      targetUrl: automation.targetUrl,
      instruction: automation.instruction,
      evaluationCriteria: automation.evaluationCriteria,
    },
  ];
}

export function profileMissingResult(): BrowserEvidenceRunResult {
  return {
    success: false,
    status: 'blocked',
    error:
      'This step has no connected vendor login. Connect one, then run again.',
    needsReauth: true,
    failureCode: 'needs_reauth',
    failureStage: 'auth',
    blockedReason: 'No connection is bound to this step.',
    logs: [],
  };
}

export function profileBlockedResult(status: string): BrowserEvidenceRunResult {
  const needsUserAction = status === 'blocked';
  return {
    success: false,
    status: 'blocked',
    error: needsUserAction
      ? 'This browser profile is blocked. Resolve the blocked state before running automations.'
      : 'This browser profile is not verified. Reconnect it before running automations.',
    needsReauth: !needsUserAction,
    failureCode: needsUserAction ? 'needs_user_action' : 'needs_reauth',
    failureStage: 'auth',
    blockedReason: needsUserAction
      ? 'Browser profile is blocked.'
      : 'Browser profile is not verified.',
    logs: [],
  };
}

/**
 * Combine per-step results into one run verdict: overall success only if every
 * step ran; the check fails if any step's check fails; error metadata comes from
 * the first step that failed technically. A single step passes through verbatim.
 */
export function rollUpStepResults(
  results: BrowserEvidenceRunResult[],
): BrowserEvidenceRunResult {
  if (results.length === 1) return results[0];

  const firstProblem = results.find((result) => !result.success);
  const failedCheck = results.find(
    (result) => result.evaluationStatus === 'fail',
  );
  const lastWithShot = [...results]
    .reverse()
    .find((result) => result.screenshotKey);
  const allSucceeded = results.every((result) => result.success);

  const status: BrowserEvidenceRunResult['status'] = allSucceeded
    ? 'completed'
    : results.some((result) => result.status === 'failed')
      ? 'failed'
      : 'blocked';

  return {
    success: allSucceeded,
    status,
    screenshotKey: lastWithShot?.screenshotKey,
    screenshotUrl: lastWithShot?.screenshotUrl,
    finalUrl: results[results.length - 1]?.finalUrl,
    // Only report a genuine 'pass' when EVERY step ran and at least one had a
    // passing verdict — a step that failed technically (timeout, session lost)
    // must not let the run be recorded as 'pass'.
    evaluationStatus: failedCheck
      ? 'fail'
      : allSucceeded &&
          results.some((result) => result.evaluationStatus === 'pass')
        ? 'pass'
        : undefined,
    evaluationReason: failedCheck?.evaluationReason,
    error: firstProblem?.error,
    needsReauth: results.some((result) => result.needsReauth),
    failureCode: firstProblem?.failureCode,
    failureStage: firstProblem?.failureStage,
    blockedReason: firstProblem?.blockedReason,
    logs: results.flatMap((result) =>
      Array.isArray(result.logs) ? result.logs : [],
    ),
  };
}
