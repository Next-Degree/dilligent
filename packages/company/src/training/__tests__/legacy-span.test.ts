import { describe, expect, it } from 'bun:test';
import { getTrainingGroup } from '../catalog';
import { resolveCompletionTarget } from '../completion-target';
import { DAY_MS, TRAINING_STRICT_SPAN_SINCE } from '../constants';
import { assessTrainingGroup, type TrainingCompletionRecord } from '../status';

// Data recorded before the strict span rule existed (every existing row became
// cycle 1 in the migration) could finish a cycle with videos more than the
// lapse period apart. Such a cycle still counts, dated from its oldest video,
// so those members keep the status and certificate they had before.

// A week after the cutover: anything finished more than a week ago predates it.
const NOW = new Date(TRAINING_STRICT_SPAN_SINCE.getTime() + 7 * DAY_MS);
const daysAgo = (days: number): Date => new Date(NOW.getTime() - days * DAY_MS);

const general = getTrainingGroup('general');

/** sat-1 watched `oldestDays` ago, the other four `restDays` ago, all in cycle 1. */
const spreadCycle = ({
  oldestDays,
  restDays,
}: {
  oldestDays: number;
  restDays: number;
}): TrainingCompletionRecord[] => [
  { videoId: 'sat-1', cycle: 1, completedAt: daysAgo(oldestDays) },
  ...['sat-2', 'sat-3', 'sat-4', 'sat-5'].map((videoId) => ({
    videoId,
    cycle: 1,
    completedAt: daysAgo(restDays),
  })),
];

describe('cycles finished before the strict span cutover', () => {
  it('stay compliant, due for renewal a year after the oldest video', () => {
    const status = assessTrainingGroup({
      group: general,
      completions: spreadCycle({ oldestDays: 330, restDays: 10 }),
      now: NOW,
    });

    expect(status).toEqual({
      status: 'renewal_due',
      cycle: 1,
      // The certificate date: the video finished last.
      completedAt: daysAgo(10),
      validUntil: new Date(daysAgo(330).getTime() + 365 * DAY_MS),
      activeCycle: 2,
      remainingModuleIds: ['sat-1', 'sat-2', 'sat-3', 'sat-4', 'sat-5'],
    });
  });

  it('show as expired, not incomplete, when spread over more than a year', () => {
    const status = assessTrainingGroup({
      group: general,
      completions: spreadCycle({ oldestDays: 400, restDays: 10 }),
      now: NOW,
    });

    expect(status.status).toBe('expired');
    expect(status.status === 'expired' && status.completedAt).toEqual(daysAgo(10));
  });

  it('record the next video watched in the renewal cycle', () => {
    const target = resolveCompletionTarget({
      moduleId: 'sat-1',
      completions: spreadCycle({ oldestDays: 330, restDays: 10 }),
      now: NOW,
    });

    expect(target).toEqual({ action: 'record', cycle: 2, refreshesStale: false });
  });

  it('do not extend to cycles finished on or after the cutover', () => {
    const status = assessTrainingGroup({
      group: general,
      completions: spreadCycle({ oldestDays: 330, restDays: 2 }),
      now: NOW,
    });

    expect(status).toEqual({
      status: 'incomplete',
      activeCycle: 1,
      remainingModuleIds: ['sat-1'],
    });
  });
});
