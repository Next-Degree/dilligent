import { describe, expect, it } from 'bun:test';
import { getTrainingGroup } from '../catalog';
import { latestCompletionFor, resolveCompletionTarget } from '../completion-target';
import type { TrainingCompletionRecord } from '../status';

const NOW = new Date('2026-11-10T12:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;

const daysAgo = (days: number): Date => new Date(NOW.getTime() - days * DAY_MS);

const general = getTrainingGroup('general');

const completeAll = ({
  moduleIds,
  cycle = 1,
  days,
}: {
  moduleIds: readonly string[];
  cycle?: number;
  days: number;
}): TrainingCompletionRecord[] =>
  moduleIds.map((videoId) => ({ videoId, cycle, completedAt: daysAgo(days) }));

describe('resolveCompletionTarget', () => {
  it('ignores a module the catalog does not know', () => {
    expect(resolveCompletionTarget({ moduleId: 'nope', completions: [], now: NOW })).toEqual({
      action: 'ignore',
      reason: 'unknown_module',
    });
  });

  it('records a first completion on cycle 1', () => {
    expect(resolveCompletionTarget({ moduleId: 'sat-1', completions: [], now: NOW })).toEqual({
      action: 'record',
      cycle: 1,
    });
  });

  it('records the remaining modules of a first cycle on cycle 1', () => {
    const completions = completeAll({ moduleIds: ['sat-1', 'sat-2'], days: 3 });

    expect(resolveCompletionTarget({ moduleId: 'sat-3', completions, now: NOW })).toEqual({
      action: 'record',
      cycle: 1,
    });
  });

  it('ignores a module already completed in the active cycle', () => {
    const completions = completeAll({ moduleIds: ['sat-1'], days: 3 });

    expect(resolveCompletionTarget({ moduleId: 'sat-1', completions, now: NOW })).toEqual({
      action: 'ignore',
      reason: 'already_completed',
    });
  });

  it('does not start a new cycle while the training is still comfortably valid', () => {
    const completions = completeAll({ moduleIds: general.moduleIds, days: 30 });

    expect(resolveCompletionTarget({ moduleId: 'sat-1', completions, now: NOW })).toEqual({
      action: 'ignore',
      reason: 'not_due',
    });
  });

  it('starts the next cycle once the renewal window has opened', () => {
    const completions = completeAll({ moduleIds: general.moduleIds, days: 330 });

    expect(resolveCompletionTarget({ moduleId: 'sat-1', completions, now: NOW })).toEqual({
      action: 'record',
      cycle: 2,
    });
  });

  it('starts the next cycle for an expired member', () => {
    const completions = completeAll({ moduleIds: general.moduleIds, days: 400 });

    expect(resolveCompletionTarget({ moduleId: 'sat-4', completions, now: NOW })).toEqual({
      action: 'record',
      cycle: 2,
    });
  });

  it('records the other modules of a renewal that is in progress on the same cycle', () => {
    const completions = [
      ...completeAll({ moduleIds: general.moduleIds, cycle: 1, days: 330 }),
      ...completeAll({ moduleIds: ['sat-1'], cycle: 2, days: 1 }),
    ];

    expect(resolveCompletionTarget({ moduleId: 'sat-2', completions, now: NOW })).toEqual({
      action: 'record',
      cycle: 2,
    });
    expect(resolveCompletionTarget({ moduleId: 'sat-1', completions, now: NOW })).toEqual({
      action: 'ignore',
      reason: 'already_completed',
    });
  });

  it('resolves CCPA and HIPAA modules against their own group, not the general one', () => {
    const generalDone = completeAll({ moduleIds: general.moduleIds, days: 5 });

    expect(
      resolveCompletionTarget({ moduleId: 'ccpa-1', completions: generalDone, now: NOW }),
    ).toEqual({ action: 'record', cycle: 1 });
    expect(
      resolveCompletionTarget({ moduleId: 'hipaa-sat-1', completions: generalDone, now: NOW }),
    ).toEqual({ action: 'record', cycle: 1 });
  });
});

describe('latestCompletionFor', () => {
  const rows = [
    { id: 'a', videoId: 'sat-1', cycle: 1, completedAt: daysAgo(400) },
    { id: 'b', videoId: 'sat-1', cycle: 2, completedAt: daysAgo(10) },
    { id: 'c', videoId: 'sat-2', cycle: 3, completedAt: daysAgo(5) },
  ];

  it('returns the row of the highest cycle for the module', () => {
    expect(latestCompletionFor({ completions: rows, videoId: 'sat-1' })?.id).toBe('b');
  });

  it('ignores rows of other modules', () => {
    expect(latestCompletionFor({ completions: rows, videoId: 'sat-2' })?.id).toBe('c');
  });

  it('returns undefined when the member has no row for the module', () => {
    expect(latestCompletionFor({ completions: rows, videoId: 'sat-9' })).toBeUndefined();
  });

  it('does not reorder the rows it is given', () => {
    const before = rows.map((row) => row.id);

    latestCompletionFor({ completions: rows, videoId: 'sat-1' });

    expect(rows.map((row) => row.id)).toEqual(before);
  });
});
