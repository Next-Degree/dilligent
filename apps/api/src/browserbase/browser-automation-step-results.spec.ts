import {
  isPublicStep,
  rollUpStepResults,
  stepsForRun,
} from './browser-automation-step-results';
import type { BrowserEvidenceRunResult } from './browser-evidence-runner.service';

const step = (
  over: Partial<BrowserEvidenceRunResult>,
): BrowserEvidenceRunResult => ({
  success: true,
  status: 'completed',
  logs: [],
  ...over,
});

describe('rollUpStepResults', () => {
  it('passes a single result through verbatim', () => {
    const only = step({ evaluationStatus: 'pass', screenshotKey: 'k' });
    expect(rollUpStepResults([only])).toBe(only);
  });

  it('reports pass only when every step succeeded', () => {
    const rolled = rollUpStepResults([
      step({ evaluationStatus: 'pass' }),
      step({ evaluationStatus: 'pass' }),
    ]);
    expect(rolled.success).toBe(true);
    expect(rolled.evaluationStatus).toBe('pass');
  });

  it('does NOT report pass when a later step failed technically', () => {
    const rolled = rollUpStepResults([
      step({ evaluationStatus: 'pass' }),
      // Technical failure (e.g. timeout) — no verdict, success=false.
      step({ success: false, status: 'failed', failureCode: 'timeout' }),
    ]);
    expect(rolled.success).toBe(false);
    // Must be "couldn't verify" (undefined), never a misleading 'pass'.
    expect(rolled.evaluationStatus).toBeUndefined();
  });

  it('reports fail when any step check failed, regardless of others', () => {
    const rolled = rollUpStepResults([
      step({ evaluationStatus: 'pass' }),
      step({ success: false, status: 'failed', evaluationStatus: 'fail' }),
    ]);
    expect(rolled.evaluationStatus).toBe('fail');
    expect(rolled.success).toBe(false);
  });
});

describe('stepsForRun auth modes', () => {
  const automation = {
    targetUrl: 'https://vendor.example.com',
    instruction: 'capture evidence',
    evaluationCriteria: null,
  };

  const stepRow = (over: Record<string, unknown> = {}) => ({
    id: 'bas_1',
    order: 0,
    profileId: 'bap_1',
    targetUrl: 'https://vendor.example.com',
    instruction: 'capture evidence',
    evaluationCriteria: null,
    ...over,
  });

  // The column is NOT NULL with a default, so a client built from the current
  // schema always supplies it. Absence means the deployed Prisma client was
  // generated from an older schema and omitted the column from its SELECT.
  // Guessing there silently demotes a public step to saved_session, which then
  // creates a spurious connection for a public site — so it must not be
  // survivable.
  it.each([
    ['missing entirely', {}],
    ['explicitly null', { authMode: null }],
  ])('throws when a step row loads with authMode %s', (_label, authMode) => {
    const run = () =>
      stepsForRun({
        ...automation,
        steps: [stepRow(authMode)],
      });

    expect(run).toThrow(/bas_1 loaded without an authMode/);
    // The message has to name the cause, since a stale client is the only way
    // to get here and the operator needs to know to rebuild and redeploy.
    expect(run).toThrow(/generated from an older schema/);
  });

  it('carries an explicit saved_session authMode through', () => {
    const [step] = stepsForRun({
      ...automation,
      steps: [stepRow({ authMode: 'saved_session' })],
    });

    expect(step.authMode).toBe('saved_session');
    expect(isPublicStep(step)).toBe(false);
  });

  it('carries an explicit public authMode through', () => {
    const [step] = stepsForRun({
      ...automation,
      steps: [stepRow({ authMode: 'public', profileId: null })],
    });

    expect(step.authMode).toBe('public');
    expect(isPublicStep(step)).toBe(true);
  });

  it('treats the legacy inline instruction as saved_session', () => {
    // The inline branch predates public mode and has always resolved a
    // connection by host — it must not become public by omission.
    const [step] = stepsForRun(automation);

    expect(step.id).toBeNull();
    expect(step.authMode).toBe('saved_session');
    expect(isPublicStep(step)).toBe(false);
  });
});
