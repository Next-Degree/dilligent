/**
 * Builds automation.txt for a browser automation in the evidence export: what
 * the automation checks (every step, for multi-step automations) and which run
 * the exported screenshots come from.
 */

export interface BrowserStepSettings {
  order: number;
  targetUrl: string;
  instruction: string;
  evaluationCriteria: string | null;
}

type Settings = Omit<BrowserStepSettings, 'order'>;

export interface AutomationInfoInput extends Settings {
  name: string;
  runCount: number;
  /** Ordered by `order`; empty for automations created before steps existed. */
  steps: BrowserStepSettings[];
}

/** Steps are stored 0-based; the export shows them 1-based everywhere. */
export function stepNumber(order: number): number {
  return order + 1;
}

function describeSettings(settings: Settings): string[] {
  return [
    `Target URL: ${settings.targetUrl}`,
    '',
    'Instruction:',
    settings.instruction,
    '',
    'Evaluation criteria:',
    settings.evaluationCriteria || '(none: captures a screenshot only)',
    '',
  ];
}

/**
 * Multi-step automations get one block per step. The automation-level
 * targetUrl/instruction/evaluationCriteria only mirror the first step, so they
 * are used only when there is at most one step.
 */
function describeSteps(automation: AutomationInfoInput): string[] {
  if (automation.steps.length <= 1) {
    return describeSettings(automation.steps[0] ?? automation);
  }
  return [
    `Steps: ${automation.steps.length}`,
    '',
    ...automation.steps.flatMap((step) => [
      `== Step ${stepNumber(step.order)} ==`,
      ...describeSettings(step),
    ]),
  ];
}

export function buildAutomationInfo({
  automation,
  latest,
}: {
  automation: AutomationInfoInput;
  latest: { runId: string; createdAt: Date } | null;
}): string {
  const screenshotLine = latest
    ? `Screenshots: from the most recent run that has them (run ${latest.runId}, ${latest.createdAt.toISOString()}). Every run's screenshot is available in the app.`
    : 'Screenshots: none of the exported runs captured one.';
  return [
    `Browser automation: ${automation.name}`,
    `Runs exported: ${automation.runCount}`,
    screenshotLine,
    '',
    "Settings below are the automation's current ones. Runs from before its last edit may have used different settings.",
    '',
    ...describeSteps(automation),
    'See runs.csv for every run; step numbers match its "step" column. Times are UTC.',
    '',
  ].join('\n');
}
