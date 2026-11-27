import {
  buildAutomationInfo,
  stepNumber,
  type AutomationInfoInput,
} from './evidence-browser-info';

const legacy = {
  targetUrl: 'https://github.com/org',
  instruction: 'Open the org security settings',
  evaluationCriteria: '2FA is required for all members',
};

function automation(
  overrides: Partial<AutomationInfoInput> = {},
): AutomationInfoInput {
  return {
    name: 'GitHub then AWS',
    runCount: 3,
    steps: [],
    ...legacy,
    ...overrides,
  };
}

const latest = {
  runId: 'bar_1',
  createdAt: new Date('2026-02-03T04:05:06.000Z'),
};

describe('stepNumber', () => {
  it('shows stored 0-based orders as 1-based', () => {
    expect(stepNumber(0)).toBe(1);
    expect(stepNumber(4)).toBe(5);
  });
});

describe('buildAutomationInfo', () => {
  it('describes every step of a multi-step automation, numbered like runs.csv', () => {
    const text = buildAutomationInfo({
      automation: automation({
        steps: [
          { order: 0, ...legacy },
          {
            order: 1,
            targetUrl: 'https://console.aws.amazon.com/iam',
            instruction: 'Open IAM account settings',
            evaluationCriteria: null,
          },
        ],
      }),
      latest,
    });

    expect(text).toContain('Steps: 2');
    expect(text).toContain('== Step 1 ==\nTarget URL: https://github.com/org');
    expect(text).toContain('2FA is required for all members');
    expect(text).toContain(
      '== Step 2 ==\nTarget URL: https://console.aws.amazon.com/iam',
    );
    expect(text).toContain('Open IAM account settings');
    // Step 2 has no criteria of its own; it must not borrow step 1's.
    expect(text.split('== Step 2 ==')[1]).toContain(
      '(none: captures a screenshot only)',
    );
    expect(text).toContain('step numbers match its "step" column');
  });

  it('uses the single step without step headings', () => {
    const text = buildAutomationInfo({
      automation: automation({
        steps: [{ order: 0, ...legacy, instruction: 'From the step row' }],
      }),
      latest,
    });

    expect(text).not.toContain('== Step');
    expect(text).toContain('From the step row');
  });

  it('falls back to the automation fields when it has no steps', () => {
    const text = buildAutomationInfo({
      automation: automation(),
      latest: null,
    });

    expect(text).not.toContain('== Step');
    expect(text).toContain('Target URL: https://github.com/org');
    expect(text).toContain('Open the org security settings');
    expect(text).toContain(
      'Screenshots: none of the exported runs captured one.',
    );
  });

  it('says the settings are current ones and names the screenshot run', () => {
    const text = buildAutomationInfo({ automation: automation(), latest });

    expect(text).toContain("Settings below are the automation's current ones.");
    expect(text).toContain('run bar_1, 2026-02-03T04:05:06.000Z');
    expect(text).toContain('Runs exported: 3');
  });
});
