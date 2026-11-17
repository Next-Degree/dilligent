import { describe, expect, it } from 'bun:test';
import type { TrainingModuleCompletion } from '../../../training-types';
import { ONBOARDING_GRACE_DAYS, TRAINING_VALIDITY_DAYS, assessTraining } from '../training-status';
// This package has no dependency on `@trycompai/company`, which owns the
// platform's own training status logic. The check keeps a separate copy so it
// stays free of the database, and this test is what stops the two copies
// drifting apart. It reaches across by relative path on purpose: a test only
// needs the source, and that avoids adding a runtime dependency.
import {
  TRAINING_VALIDITY_DAYS as CATALOG_VALIDITY_DAYS,
  assessTrainingGroup,
  getTrainingGroup,
  isTrainingCompliant,
} from '../../../../../company/src/training/index';

const NOW = new Date('2026-10-23T12:00:00.000Z');
const DAY_MS = 86_400_000;
const GROUP = getTrainingGroup('general');
const REQUIRED = [...GROUP.moduleIds];

interface Scenario {
  name: string;
  /** [cycle, days ago, module ids] for each batch of completions. */
  batches: Array<[number, number, string[]]>;
  verdict: 'compliant' | 'expired' | 'incomplete';
}

const all = REQUIRED;
const scenarios: Scenario[] = [
  { name: 'nothing done', batches: [], verdict: 'incomplete' },
  { name: 'first cycle partly done', batches: [[1, 5, all.slice(0, 3)]], verdict: 'incomplete' },
  { name: 'first cycle done recently', batches: [[1, 10, all]], verdict: 'compliant' },
  { name: 'first cycle due for renewal', batches: [[1, 330, all]], verdict: 'compliant' },
  { name: 'first cycle expired', batches: [[1, 400, all]], verdict: 'expired' },
  { name: 'exactly one year old', batches: [[1, 365, all]], verdict: 'expired' },
  { name: 'one day short of a year', batches: [[1, 364, all]], verdict: 'compliant' },
  {
    name: 'first cycle spread over time, oldest module nearly a year old',
    batches: [
      [1, 360, all.slice(0, 1)],
      [1, 100, all.slice(1)],
    ],
    verdict: 'compliant',
  },
  {
    name: 'only the stale oldest module renewed',
    batches: [
      [1, 400, all.slice(0, 1)],
      [1, 100, all.slice(1)],
      [2, 1, all.slice(0, 1)],
    ],
    verdict: 'expired',
  },
  {
    name: 'expired with a partial renewal',
    batches: [
      [1, 400, all],
      [2, 1, all.slice(0, 2)],
    ],
    verdict: 'expired',
  },
  {
    name: 'expired and fully renewed',
    batches: [
      [1, 400, all],
      [2, 3, all],
    ],
    verdict: 'compliant',
  },
  {
    name: 'valid with a partial renewal under way',
    batches: [
      [1, 330, all],
      [2, 1, all.slice(0, 1)],
    ],
    verdict: 'compliant',
  },
];

const checkVerdict = (batches: Scenario['batches']): Scenario['verdict'] => {
  const completions: TrainingModuleCompletion[] = batches.flatMap(([cycle, days, moduleIds]) =>
    moduleIds.map((moduleId) => ({
      moduleId,
      cycle,
      completedAt: new Date(NOW.getTime() - days * DAY_MS).toISOString(),
    })),
  );
  const { status } = assessTraining({
    participant: {
      id: 'mem_1',
      email: 'ada@acme.com',
      name: 'Ada',
      // Long past the onboarding window, so only the training itself decides.
      joinedAt: new Date(NOW.getTime() - 500 * DAY_MS).toISOString(),
      completions,
    },
    requiredModuleIds: REQUIRED,
    now: NOW,
  });

  if (status === 'complete') return 'compliant';
  return status === 'expired' ? 'expired' : 'incomplete';
};

const platformVerdict = (batches: Scenario['batches']): Scenario['verdict'] => {
  const status = assessTrainingGroup({
    group: GROUP,
    completions: batches.flatMap(([cycle, days, moduleIds]) =>
      moduleIds.map((videoId) => ({
        videoId,
        cycle,
        completedAt: new Date(NOW.getTime() - days * DAY_MS),
      })),
    ),
    now: NOW,
  });

  if (isTrainingCompliant(status)) return 'compliant';
  return status.status === 'expired' ? 'expired' : 'incomplete';
};

describe('integration check and platform agree on training status', () => {
  it('use the same validity window', () => {
    expect(TRAINING_VALIDITY_DAYS).toBe(CATALOG_VALIDITY_DAYS);
  });

  it('gives new joiners a grace period shorter than a renewal window, never longer than a year', () => {
    expect(ONBOARDING_GRACE_DAYS).toBeLessThan(TRAINING_VALIDITY_DAYS);
  });

  for (const scenario of scenarios) {
    it(`agree when ${scenario.name}`, () => {
      expect(platformVerdict(scenario.batches)).toBe(scenario.verdict);
      expect(checkVerdict(scenario.batches)).toBe(scenario.verdict);
    });
  }
});
