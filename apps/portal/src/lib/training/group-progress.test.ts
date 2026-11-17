import { describe, expect, it } from 'vitest';
import { getGroupProgress } from './group-progress';

const NOW = new Date('2026-11-10T12:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (days: number): Date => new Date(NOW.getTime() - days * DAY_MS);
const GENERAL = ['sat-1', 'sat-2', 'sat-3', 'sat-4', 'sat-5'];

const rows = ({
  videoIds,
  cycle = 1,
  days,
}: {
  videoIds: readonly string[];
  cycle?: number;
  days: number;
}) => videoIds.map((videoId) => ({ videoId, cycle, completedAt: daysAgo(days) }));

const progress = (
  completions: ReturnType<typeof rows>,
  groupId: 'general' | 'ccpa' | 'hipaa' = 'general',
) => getGroupProgress({ groupId, completions, now: NOW });

describe('getGroupProgress', () => {
  it('has nothing done and nothing satisfied for an untouched group', () => {
    const result = progress([]);

    expect(result.status.status).toBe('incomplete');
    expect([...result.completedModuleIds]).toEqual([]);
    expect(result.isSatisfied).toBe(false);
    expect(result.isFullyDone).toBe(false);
  });

  it('lists the videos finished so far in the first cycle', () => {
    const result = progress(rows({ videoIds: GENERAL.slice(0, 2), days: 3 }));

    expect([...result.completedModuleIds]).toEqual(['sat-1', 'sat-2']);
    expect(result.isFullyDone).toBe(false);
  });

  it('treats a valid group as fully done', () => {
    const result = progress(rows({ videoIds: GENERAL, days: 10 }));

    expect(result.status.status).toBe('valid');
    expect(result.isSatisfied).toBe(true);
    expect(result.isFullyDone).toBe(true);
    expect([...result.completedModuleIds]).toEqual(GENERAL);
  });

  it('keeps a group due for renewal satisfied, but offers every video again', () => {
    const result = progress(rows({ videoIds: GENERAL, days: 330 }));

    expect(result.status.status).toBe('renewal_due');
    expect(result.isSatisfied).toBe(true);
    expect(result.isFullyDone).toBe(false);
    expect([...result.completedModuleIds]).toEqual([]);
  });

  it('shows only renewal progress for an expired group', () => {
    const result = progress([
      ...rows({ videoIds: GENERAL, cycle: 1, days: 400 }),
      ...rows({ videoIds: ['sat-1', 'sat-2'], cycle: 2, days: 1 }),
    ]);

    expect(result.status.status).toBe('expired');
    expect(result.isSatisfied).toBe(false);
    expect([...result.completedModuleIds]).toEqual(['sat-1', 'sat-2']);
  });

  it('counts a renewal in progress while last year is still valid', () => {
    const result = progress([
      ...rows({ videoIds: GENERAL, cycle: 1, days: 330 }),
      ...rows({ videoIds: ['sat-1'], cycle: 2, days: 1 }),
    ]);

    expect(result.isSatisfied).toBe(true);
    expect([...result.completedModuleIds]).toEqual(['sat-1']);
  });

  it('is fully done once a renewal is finished, even with last year rows present', () => {
    const result = progress([
      ...rows({ videoIds: GENERAL, cycle: 1, days: 400 }),
      ...rows({ videoIds: GENERAL, cycle: 2, days: 2 }),
    ]);

    expect(result.status.status).toBe('valid');
    expect(result.isFullyDone).toBe(true);
  });

  it('works for the two CCPA videos', () => {
    const result = progress(rows({ videoIds: ['ccpa-1'], days: 2 }), 'ccpa');

    expect([...result.completedModuleIds]).toEqual(['ccpa-1']);
    expect(result.isFullyDone).toBe(false);
  });
});
