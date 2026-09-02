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

  it('defaults a step row with no authMode to saved_session', () => {
    // Rows written before the column existed read back without it through a
    // stale client — they must keep behaving exactly as they always have.
    const [step] = stepsForRun({
      ...automation,
      steps: [
        {
          id: 'bas_1',
          order: 0,
          profileId: 'bap_1',
          targetUrl: 'https://vendor.example.com',
          instruction: 'capture evidence',
          evaluationCriteria: null,
        },
      ],
    });

    expect(step.authMode).toBe('saved_session');
    expect(isPublicStep(step)).toBe(false);
  });

  it('carries an explicit public authMode through', () => {
    const [step] = stepsForRun({
      ...automation,
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
