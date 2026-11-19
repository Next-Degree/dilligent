import { describe, expect, it } from 'bun:test';
import { getTrainingGroup } from '../catalog';
import { resolveCompletionTarget } from '../completion-target';
import { TRAINING_PROGRESS_LAPSE_DAYS, TRAINING_VALIDITY_DAYS } from '../constants';
import { assessTrainingGroup, type TrainingCompletionRecord } from '../status';

// Option A: in a training that is not finished, a video watched more than ten
// months ago (a year minus the 60 day renewal window) no longer counts.
// write paths refresh its date. A cycle that was finished while every video was
// within a year of the others was genuinely valid, and still simply expires.

// After the strict span cutover, so finished cycles here follow the current rules.
const NOW = new Date('2027-06-01T12:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (days: number): Date => new Date(NOW.getTime() - days * DAY_MS);

const general = getTrainingGroup('general');

const row = ({
  videoId,
  cycle = 1,
  days,
}: {
  videoId: string;
  cycle?: number;
  days: number;
}): TrainingCompletionRecord => ({ videoId, cycle, completedAt: daysAgo(days) });

const recent = (videoIds: string[], cycle = 1): TrainingCompletionRecord[] =>
  videoIds.map((videoId) => row({ videoId, cycle, days: 5 }));

describe('stale progress in an unfinished training', () => {
  it('does not count a video watched more than a year ago as done', () => {
    const status = assessTrainingGroup({
      group: general,
      completions: [row({ videoId: 'sat-1', days: 400 }), ...recent(['sat-2', 'sat-3'])],
      now: NOW,
    });

    expect(status).toEqual({
      status: 'incomplete',
      activeCycle: 1,
      remainingModuleIds: ['sat-1', 'sat-4', 'sat-5'],
    });
  });

  it('stops counting progress after a year minus the renewal window', () => {
    expect(TRAINING_PROGRESS_LAPSE_DAYS).toBe(TRAINING_VALIDITY_DAYS - 60);
  });

  it('treats a video watched exactly at the cutoff as stale', () => {
    const status = assessTrainingGroup({
      group: general,
      completions: [
        row({ videoId: 'sat-1', days: TRAINING_PROGRESS_LAPSE_DAYS }),
        ...recent(['sat-2']),
      ],
      now: NOW,
    });

    expect(status.status === 'incomplete' && status.remainingModuleIds).toContain('sat-1');
  });

  it('keeps a video watched a day before the cutoff', () => {
    const status = assessTrainingGroup({
      group: general,
      completions: [
        row({ videoId: 'sat-1', days: TRAINING_PROGRESS_LAPSE_DAYS - 1 }),
        ...recent(['sat-2']),
      ],
      now: NOW,
    });

    expect(status.status === 'incomplete' && status.remainingModuleIds).not.toContain('sat-1');
  });

  it('never leaves a training due for renewal the moment it is finished', () => {
    const status = assessTrainingGroup({
      group: general,
      completions: [
        row({ videoId: 'sat-1', days: TRAINING_PROGRESS_LAPSE_DAYS - 1 }),
        ...general.moduleIds.slice(1).map((videoId) => row({ videoId, days: 0 })),
      ],
      now: NOW,
    });

    expect(status.status).toBe('valid');
  });

  it('does not count a training finished with a video watched ten and a half months before', () => {
    const status = assessTrainingGroup({
      group: general,
      completions: [
        row({ videoId: 'sat-1', days: 320 }),
        ...general.moduleIds.slice(1).map((videoId) => row({ videoId, days: 0 })),
      ],
      now: NOW,
    });

    expect(status).toEqual({ status: 'incomplete', activeCycle: 1, remainingModuleIds: ['sat-1'] });
  });

  it('does not let a stale video complete the training and expire it straight away', () => {
    const status = assessTrainingGroup({
      group: general,
      completions: [
        row({ videoId: 'sat-1', days: 400 }),
        ...recent(['sat-2', 'sat-3', 'sat-4', 'sat-5']),
      ],
      now: NOW,
    });

    expect(status).toEqual({ status: 'incomplete', activeCycle: 1, remainingModuleIds: ['sat-1'] });
  });

  it('is valid once the stale video is watched again', () => {
    const status = assessTrainingGroup({
      group: general,
      completions: recent(['sat-1', 'sat-2', 'sat-3', 'sat-4', 'sat-5']),
      now: NOW,
    });

    expect(status.status).toBe('valid');
  });

  it('still expires a training that was genuinely finished within one year', () => {
    const status = assessTrainingGroup({
      group: general,
      completions: general.moduleIds.map((videoId) => row({ videoId, days: 400 })),
      now: NOW,
    });

    expect(status).toMatchObject({ status: 'expired', cycle: 1, activeCycle: 2 });
  });

  it('treats a renewal abandoned for over a year the same way', () => {
    const status = assessTrainingGroup({
      group: general,
      completions: [
        ...general.moduleIds.map((videoId) => row({ videoId, cycle: 1, days: 800 })),
        row({ videoId: 'sat-1', cycle: 2, days: 400 }),
        ...recent(['sat-2'], 2),
      ],
      now: NOW,
    });

    expect(status).toMatchObject({
      status: 'expired',
      cycle: 1,
      activeCycle: 2,
      remainingModuleIds: ['sat-1', 'sat-3', 'sat-4', 'sat-5'],
    });
  });
});

describe('resolveCompletionTarget with stale progress', () => {
  it('records a stale video again on the same cycle and says it replaces a stale completion', () => {
    const completions = [row({ videoId: 'sat-1', days: 400 }), ...recent(['sat-2'])];

    expect(resolveCompletionTarget({ moduleId: 'sat-1', completions, now: NOW })).toEqual({
      action: 'record',
      cycle: 1,
      refreshesStale: true,
    });
  });

  it('records a never watched video without replacing anything', () => {
    const completions = [row({ videoId: 'sat-1', days: 400 }), ...recent(['sat-2'])];

    expect(resolveCompletionTarget({ moduleId: 'sat-3', completions, now: NOW })).toEqual({
      action: 'record',
      cycle: 1,
      refreshesStale: false,
    });
  });

  it('still ignores a video watched recently in the active cycle', () => {
    const completions = [row({ videoId: 'sat-1', days: 400 }), ...recent(['sat-2'])];

    expect(resolveCompletionTarget({ moduleId: 'sat-2', completions, now: NOW })).toEqual({
      action: 'ignore',
      reason: 'already_completed',
    });
  });
});
