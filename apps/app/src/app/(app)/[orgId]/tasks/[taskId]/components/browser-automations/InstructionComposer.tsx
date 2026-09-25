'use client';

import { useRealtimeRun } from '@trigger.dev/react-hooks';
import { Button } from '@trycompai/design-system';
import { Add, Close, Play } from '@trycompai/design-system/icons';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import type {
  BrowserAuthProfileStatus,
  BrowserAutomation,
  BrowserAutomationStepInput,
  BrowserStepAuthMode,
  DraftStep,
  InstructionTestResult,
} from '../../hooks/types';
import { useInstructionTest } from '../../hooks/useInstructionTest';
import { FAILED_RUN_STATUSES, hostnameOf } from './connect-flow-constants';
import { InstructionTestPanel, type TestPhase } from './InstructionTestPanel';
import { isUsableTargetUrl, PUBLIC_MODE, SAVED_SESSION_MODE } from './step-auth-mode';
import { StepCard } from './StepCard';
import type { SignInStep } from './StepList';

/** The connection a composed step runs under. */
export interface ConnectionRef {
  profileId: string;
  hostname: string;
  displayName: string;
  url: string;
  status: BrowserAuthProfileStatus;
}

/** A step being edited locally (before save). */
export interface EditableStep {
  key: string;
  authMode: BrowserStepAuthMode;
  /** '' for a public step, which binds no connection. */
  profileId: string;
  /**
   * Only meaningful in public mode, where the user types it. A saved-session
   * step still derives its URL from its connection at save time, as it always
   * has — but the value round-trips through drafts either way.
   */
  targetUrl: string;
  instruction: string;
  criteria: string;
}

type InstructionInput = {
  name: string;
  targetUrl: string;
  instruction: string;
  evaluationCriteria?: string;
  steps: BrowserAutomationStepInput[];
};

interface InstructionComposerProps {
  taskId: string;
  /**
   * The connection the composer opens on. Optional: an org with no connections
   * at all can still author public-page evidence, and lands here with none.
   */
  connection?: ConnectionRef;
  connections: ConnectionRef[];
  mode: 'create' | 'edit';
  initialValues?: Pick<
    BrowserAutomation,
    'id' | 'instruction' | 'evaluationCriteria' | 'targetUrl' | 'steps'
  >;
  isSaving: boolean;
  onCancel: () => void;
  onCreate: (data: InstructionInput) => Promise<boolean>;
  onUpdate: (args: { automationId: string; input: InstructionInput }) => Promise<boolean>;
  onSaved: () => void;
  onReconnect?: (connection: ConnectionRef) => void;
  /** Resume: seed the composer from a saved draft's steps. */
  draftSteps?: DraftStep[];
  /** Autosave the in-progress draft (create mode only); parent owns the draft id. */
  onAutosave?: (payload: { name: string; steps: DraftStep[] }) => void;
}

/** An instruction has no separate name field; derive one from its first line. */
function deriveName(instruction: string): string {
  const firstLine = instruction.trim().split('\n')[0].trim();
  if (!firstLine) return 'Browser evidence';
  return firstLine.length > 60 ? `${firstLine.slice(0, 57)}…` : firstLine;
}

let stepKeySeq = 0;

/**
 * A blank step. With no connection to bind to, it starts public — that's the
 * only mode an org with zero connections can actually run.
 */
const newStep = (fallbackProfileId: string): EditableStep => ({
  key: `step-${(stepKeySeq += 1)}`,
  authMode: fallbackProfileId ? SAVED_SESSION_MODE : PUBLIC_MODE,
  profileId: fallbackProfileId,
  targetUrl: '',
  instruction: '',
  criteria: '',
});

/** Rows written before public mode existed carry no authMode — default them. */
function restoreAuthMode(authMode: BrowserStepAuthMode | null | undefined): BrowserStepAuthMode {
  return authMode === PUBLIC_MODE ? PUBLIC_MODE : SAVED_SESSION_MODE;
}

function initialSteps(
  initialValues: InstructionComposerProps['initialValues'],
  fallbackProfileId: string,
  draftSteps?: DraftStep[],
): EditableStep[] {
  if (draftSteps && draftSteps.length > 0) {
    return draftSteps.map((step) => {
      const authMode = restoreAuthMode(step.authMode);
      return {
        key: `step-${(stepKeySeq += 1)}`,
        authMode,
        profileId: authMode === PUBLIC_MODE ? '' : (step.profileId ?? fallbackProfileId),
        targetUrl: step.targetUrl ?? '',
        instruction: step.instruction ?? '',
        criteria: step.evaluationCriteria ?? '',
      };
    });
  }
  if (initialValues?.steps && initialValues.steps.length > 0) {
    return initialValues.steps.map((step) => {
      const authMode = restoreAuthMode(step.authMode);
      return {
        key: `step-${(stepKeySeq += 1)}`,
        authMode,
        profileId: authMode === PUBLIC_MODE ? '' : (step.profileId ?? fallbackProfileId),
        targetUrl: step.targetUrl ?? '',
        instruction: step.instruction,
        criteria: step.evaluationCriteria ?? '',
      };
    });
  }
  if (initialValues?.instruction) {
    return [
      {
        key: `step-${(stepKeySeq += 1)}`,
        authMode: SAVED_SESSION_MODE,
        profileId: fallbackProfileId,
        targetUrl: initialValues.targetUrl ?? '',
        instruction: initialValues.instruction,
        criteria: initialValues.evaluationCriteria ?? '',
      },
    ];
  }
  return [newStep(fallbackProfileId)];
}

/**
 * Multi-step composer (design: Stacked step-cards). Build an ordered list of
 * steps — each on its own connection — then test the active step and save.
 * Steps run in sequence, reusing each connection's saved session (no re-login).
 */
export function InstructionComposer({
  taskId,
  connection,
  connections = [],
  mode,
  initialValues,
  isSaving,
  onCancel,
  onCreate,
  onUpdate,
  onSaved,
  onReconnect,
  draftSteps,
  onAutosave,
}: InstructionComposerProps) {
  const fallbackProfileId = connection?.profileId ?? '';
  const [steps, setSteps] = useState<EditableStep[]>(() =>
    initialSteps(initialValues, fallbackProfileId, draftSteps),
  );
  const [activeIndex, setActiveIndex] = useState(0);

  const [phase, setPhase] = useState<TestPhase>('idle');
  const [testRun, setTestRun] = useState<{ runId: string; accessToken: string } | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [liveViewUrl, setLiveViewUrl] = useState<string | null>(null);
  const [timeline, setTimeline] = useState<SignInStep[]>([]);
  const [result, setResult] = useState<InstructionTestResult | null>(null);

  const { startTest, closeTestSession, isStarting } = useInstructionTest();

  // Always include the primary connection (deduped) so every step's connection
  // has a matching option — otherwise the picker shows the raw profile id.
  const availableConnections = useMemo(() => {
    const byId = new Map<string, ConnectionRef>();
    for (const item of connections) byId.set(item.profileId, item);
    if (connection && !byId.has(connection.profileId)) {
      byId.set(connection.profileId, connection);
    }
    return [...byId.values()];
  }, [connections, connection]);

  /**
   * The connection a step runs under, or undefined when it has none. A public
   * step must resolve to undefined rather than falling back to the primary
   * connection — otherwise it would inherit that connection's reconnect prompt
   * and its verified-status gate, neither of which applies to it.
   */
  const connectionOf = useCallback(
    (step: EditableStep): ConnectionRef | undefined => {
      if (step.authMode === PUBLIC_MODE) return undefined;
      return availableConnections.find((item) => item.profileId === step.profileId) ?? connection;
    },
    [availableConnections, connection],
  );

  /** Where a step starts: typed by the user when public, from its connection otherwise. */
  const urlForStep = useCallback(
    (step: EditableStep): string =>
      step.authMode === PUBLIC_MODE ? step.targetUrl.trim() : (connectionOf(step)?.url ?? ''),
    [connectionOf],
  );

  const activeStep = steps[activeIndex] ?? steps[0];
  const activeStepUrl = urlForStep(activeStep);
  const host = useMemo(() => hostnameOf(activeStepUrl), [activeStepUrl]);

  const blockedStepIndex = steps.findIndex((step) => {
    // A public step has no connection to verify; what it needs is a usable URL.
    if (step.authMode === PUBLIC_MODE) return !isUsableTargetUrl(step.targetUrl);
    return connectionOf(step)?.status !== 'verified';
  });
  const canSave = steps.every((step) => step.instruction.trim());

  const { run: runState, error: runError } = useRealtimeRun(testRun?.runId ?? '', {
    accessToken: testRun?.accessToken,
    enabled: !!testRun,
  });

  useEffect(() => {
    const streamed = runState?.metadata?.testSteps as SignInStep[] | undefined;
    if (streamed) setTimeline(streamed);
  }, [runState]);

  // Follow the agent across tabs: when the run reports a new active-tab live
  // view, point the iframe at it (AWS etc. open sign-in/console in new tabs).
  useEffect(() => {
    const streamed = runState?.metadata?.testLiveViewUrl as string | undefined;
    if (streamed) setLiveViewUrl(streamed);
  }, [runState]);

  useEffect(() => {
    if (!testRun) return;
    if (runState && runState.id !== testRun.runId) return;

    const finalize = (r: InstructionTestResult) => {
      setResult(r);
      setPhase('result');
      setTestRun(null);
      setSessionId((current) => {
        if (current) void closeTestSession(current);
        return null;
      });
    };

    if (runError) {
      finalize({ success: false, error: 'The test run could not complete.' });
      return;
    }
    if (!runState) return;

    if (runState.status === 'COMPLETED') {
      finalize(
        (runState.output as InstructionTestResult) ?? {
          success: false,
          error: 'No result returned.',
        },
      );
    } else if (FAILED_RUN_STATUSES.has(runState.status)) {
      finalize({
        success: false,
        error:
          runState.status === 'TIMED_OUT'
            ? 'The AI ran out of time before finishing. Try a more specific instruction.'
            : 'The test run could not complete.',
      });
    }
  }, [testRun, runState, runError, closeTestSession]);

  // Never leak the live session if the user leaves mid-test.
  useEffect(() => {
    return () => {
      if (sessionId) void closeTestSession(sessionId);
    };
  }, [sessionId, closeTestSession]);

  // Autosave the draft as the user edits (create mode only). Debounced; only
  // once there's real content, so merely opening the composer doesn't persist.
  useEffect(() => {
    if (mode !== 'create' || !onAutosave) return;
    if (!steps.some((step) => step.instruction.trim())) return;
    const timer = setTimeout(() => {
      onAutosave({
        name: deriveName(steps[0].instruction),
        steps: steps.map((step) => ({
          authMode: step.authMode,
          profileId: step.profileId || undefined,
          targetUrl: urlForStep(step) || undefined,
          instruction: step.instruction,
          evaluationCriteria: step.criteria.trim() ? step.criteria.trim() : undefined,
        })),
      });
    }, 900);
    return () => clearTimeout(timer);
  }, [steps, mode, onAutosave, urlForStep]);

  const resetTest = useCallback(() => {
    setPhase('idle');
    setResult(null);
    setTimeline([]);
    setSessionId((current) => {
      if (current) void closeTestSession(current);
      return null;
    });
    setLiveViewUrl(null);
    setTestRun(null);
  }, [closeTestSession]);

  const patchStep = useCallback((index: number, patch: Partial<EditableStep>) => {
    setSteps((current) => current.map((step, i) => (i === index ? { ...step, ...patch } : step)));
  }, []);

  const handleActivate = useCallback(
    (index: number) => {
      if (index === activeIndex) return;
      resetTest();
      setActiveIndex(index);
    },
    [activeIndex, resetTest],
  );

  const handleAddStep = useCallback(() => {
    resetTest();
    setSteps((current) => [...current, newStep(fallbackProfileId)]);
    setActiveIndex(steps.length);
  }, [fallbackProfileId, steps.length, resetTest]);

  const handleRemoveStep = useCallback(
    (index: number) => {
      resetTest();
      setSteps((current) => current.filter((_, i) => i !== index));
      setActiveIndex((current) =>
        Math.max(
          0,
          current > index
            ? current - 1
            : current === index
              ? Math.min(current, steps.length - 2)
              : current,
        ),
      );
    },
    [resetTest, steps.length],
  );

  const handleMove = useCallback(
    (index: number, direction: -1 | 1) => {
      const target = index + direction;
      if (target < 0 || target >= steps.length) return;
      setSteps((current) => {
        const next = [...current];
        [next[index], next[target]] = [next[target], next[index]];
        return next;
      });
      setActiveIndex(target);
    },
    [steps.length],
  );

  const handleTest = useCallback(async () => {
    if (!activeStep.instruction.trim()) {
      toast.error('Add an instruction for this step first.');
      return;
    }
    if (!activeStepUrl) {
      toast.error(
        activeStep.authMode === PUBLIC_MODE
          ? 'Add the page URL for this step first.'
          : 'Pick a connection for this step first.',
      );
      return;
    }
    if (sessionId) void closeTestSession(sessionId);
    setTimeline([]);
    setResult(null);
    setSessionId(null);
    setLiveViewUrl(null);
    setPhase('testing');

    const handle = await startTest({
      authMode: activeStep.authMode,
      // Omitted for a public test — sending one would make the API resolve (and
      // therefore create) a connection for the public host.
      profileId: activeStep.authMode === PUBLIC_MODE ? undefined : activeStep.profileId,
      targetUrl: activeStepUrl,
      instruction: activeStep.instruction.trim(),
      evaluationCriteria: activeStep.criteria.trim() ? activeStep.criteria.trim() : undefined,
      taskId,
    });
    if (!handle) {
      setPhase('idle');
      return;
    }
    setSessionId(handle.sessionId);
    setLiveViewUrl(handle.liveViewUrl);
    setTestRun({ runId: handle.runId, accessToken: handle.publicAccessToken });
  }, [activeStep, activeStepUrl, sessionId, closeTestSession, startTest, taskId]);

  const handleSave = useCallback(async () => {
    if (!canSave) {
      toast.error('Every step needs an instruction.');
      return;
    }
    const stepInputs: BrowserAutomationStepInput[] = steps.map((step) => ({
      authMode: step.authMode,
      profileId: step.authMode === PUBLIC_MODE ? null : step.profileId,
      targetUrl: urlForStep(step),
      instruction: step.instruction.trim(),
      evaluationCriteria: step.criteria.trim() ? step.criteria.trim() : undefined,
    }));
    const input: InstructionInput = {
      name: deriveName(steps[0].instruction),
      targetUrl: stepInputs[0].targetUrl,
      instruction: stepInputs[0].instruction,
      evaluationCriteria: stepInputs[0].evaluationCriteria ?? undefined,
      steps: stepInputs,
    };
    const ok = initialValues?.id
      ? await onUpdate({ automationId: initialValues.id, input })
      : await onCreate(input);
    if (ok) onSaved();
  }, [canSave, steps, urlForStep, initialValues?.id, onCreate, onUpdate, onSaved]);

  const handleCancel = useCallback(() => {
    if (sessionId) void closeTestSession(sessionId);
    onCancel();
  }, [sessionId, closeTestSession, onCancel]);

  const testing = phase === 'testing';
  const checkCount = steps.filter((step) => step.criteria.trim()).length;

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="border-b border-border px-6 py-4">
        <div className="flex items-center justify-between gap-3">
          <div className="text-base text-foreground">
            {mode === 'edit' ? 'Edit automation' : 'New automation'}
            <span className="ml-2 text-xs text-muted-foreground">
              {steps.length} {steps.length === 1 ? 'step' : 'steps'}
              {checkCount > 0 && ` · ${checkCount} ${checkCount === 1 ? 'check' : 'checks'}`}
            </span>
          </div>
          {/* Sits on the title's line (not the top of the two-line block) and is
              sized to match it, so it reads as part of the header. */}
          <button
            onClick={handleCancel}
            aria-label="Close"
            className="-mr-1.5 grid h-7 w-7 flex-none cursor-pointer place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <Close size={16} />
          </button>
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Steps run in order, unattended. Saved sessions are reused — no re-login between vendors. A
          public-page step needs no connection at all.
        </p>
      </div>

      <div className="flex min-h-[430px] flex-col md:flex-row">
        {/* Left — the step list */}
        <div className="flex flex-col gap-2 border-b border-border p-6 md:w-[420px] md:flex-none md:border-b-0 md:border-r">
          {steps.map((step, index) => (
            <div key={step.key} className="flex flex-col gap-2">
              {index > 0 && (
                <div className="flex items-center gap-2 pl-2 text-[10.5px] text-muted-foreground">
                  <span className="h-3 w-px bg-border" />
                  {step.authMode === PUBLIC_MODE
                    ? 'public page — no sign-in needed'
                    : 'session reused — no sign-in'}
                </div>
              )}
              <StepCard
                step={step}
                index={index}
                total={steps.length}
                isActive={index === activeIndex}
                connections={availableConnections}
                connection={connectionOf(step)}
                fallbackProfileId={fallbackProfileId}
                onActivate={() => handleActivate(index)}
                onChange={(patch) => patchStep(index, patch)}
                onRemove={() => handleRemoveStep(index)}
                onMove={(direction) => handleMove(index, direction)}
                onReconnect={(conn) => onReconnect?.(conn)}
              />
            </div>
          ))}

          <div className="pt-1">
            <Button variant="outline" onClick={handleAddStep} iconLeft={<Add size={13} />}>
              Add step — another vendor, same run
            </Button>
          </div>

          <div className="mt-2 flex flex-col gap-2">
            <Button
              width="full"
              variant="outline"
              onClick={handleTest}
              disabled={isStarting || testing}
              loading={testing}
              iconLeft={!testing ? <Play size={11} /> : undefined}
            >
              {testing ? 'Testing…' : 'Test this step'}
            </Button>
            <Button
              width="full"
              onClick={handleSave}
              loading={isSaving}
              disabled={isSaving || !canSave || blockedStepIndex !== -1}
            >
              {blockedStepIndex !== -1
                ? `Fix step ${blockedStepIndex + 1} to save`
                : 'Save automation'}
            </Button>
          </div>
        </div>

        {/* Right — test the active step */}
        <div className="flex flex-1 flex-col p-6" style={{ background: 'var(--muted)' }}>
          <InstructionTestPanel
            phase={phase}
            host={host}
            liveViewUrl={liveViewUrl}
            steps={timeline}
            result={result}
          />
        </div>
      </div>
    </div>
  );
}
