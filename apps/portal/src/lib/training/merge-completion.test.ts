import { describe, expect, it } from 'vitest';
import { mergeCompletion } from './merge-completion';

const row = ({
  id,
  videoId,
  cycle,
  completedAt = null,
}: {
  id: string;
  videoId: string;
  cycle: number;
  completedAt?: Date | null;
}) => ({ id, videoId, cycle, completedAt });

describe('mergeCompletion', () => {
  it('starts a list when there is none yet', () => {
    const updated = row({ id: 'a', videoId: 'sat-1', cycle: 1 });

    expect(mergeCompletion({ current: undefined, updated })).toEqual([updated]);
  });

  it('adds a completion for a module the list does not have', () => {
    const existing = row({ id: 'a', videoId: 'sat-1', cycle: 1 });
    const updated = row({ id: 'b', videoId: 'sat-2', cycle: 1 });

    expect(mergeCompletion({ current: [existing], updated })).toEqual([existing, updated]);
  });

  it('replaces the row for the same module and cycle', () => {
    const stale = row({ id: 'a', videoId: 'sat-1', cycle: 1 });
    const done = row({ id: 'a', videoId: 'sat-1', cycle: 1, completedAt: new Date() });

    expect(mergeCompletion({ current: [stale], updated: done })).toEqual([done]);
  });

  it('keeps last year when the same module is completed again in a new cycle', () => {
    const lastYear = row({
      id: 'a',
      videoId: 'sat-1',
      cycle: 1,
      completedAt: new Date(2025, 0, 1),
    });
    const renewal = row({ id: 'b', videoId: 'sat-1', cycle: 2, completedAt: new Date() });

    expect(mergeCompletion({ current: [lastYear], updated: renewal })).toEqual([lastYear, renewal]);
  });

  it('leaves the rows of other modules alone', () => {
    const other = row({ id: 'x', videoId: 'sat-3', cycle: 1 });
    const stale = row({ id: 'a', videoId: 'sat-1', cycle: 1 });
    const done = row({ id: 'a', videoId: 'sat-1', cycle: 1, completedAt: new Date() });

    expect(mergeCompletion({ current: [other, stale], updated: done })).toEqual([other, done]);
  });

  it('does not change the list it was given', () => {
    const current = [row({ id: 'a', videoId: 'sat-1', cycle: 1 })];
    const snapshot = [...current];

    mergeCompletion({ current, updated: row({ id: 'b', videoId: 'sat-2', cycle: 1 }) });

    expect(current).toEqual(snapshot);
  });
});
