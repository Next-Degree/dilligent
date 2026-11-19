import { describe, expect, it } from 'vitest';
import { getTrainingTaskCompliance } from './task-compliance';

// After the strict span cutover, so any finished cycle here follows the current rules.
const NOW = new Date('2027-06-01T12:00:00.000Z');
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

describe('getTrainingTaskCompliance', () => {
  it('reports every group as not required when none applies', () => {
    expect(getTrainingTaskCompliance({ requiredGroupIds: [], completions: [], now: NOW })).toEqual({
      general: null,
      hipaa: null,
      ccpa: null,
    });
  });

  it('reports a required group as not done until it is finished', () => {
    const result = getTrainingTaskCompliance({
      requiredGroupIds: ['general', 'ccpa'],
      completions: rows({ videoIds: GENERAL.slice(0, 3), days: 2 }),
      now: NOW,
    });

    expect(result).toEqual({ general: false, hipaa: null, ccpa: false });
  });

  it('reports finished training as done', () => {
    const result = getTrainingTaskCompliance({
      requiredGroupIds: ['general', 'hipaa'],
      completions: [
        ...rows({ videoIds: GENERAL, days: 10 }),
        ...rows({ videoIds: ['hipaa-sat-1'], days: 10 }),
      ],
      now: NOW,
    });

    expect(result).toEqual({ general: true, hipaa: true, ccpa: null });
  });

  it('keeps training that is only due for renewal as done', () => {
    const result = getTrainingTaskCompliance({
      requiredGroupIds: ['general'],
      completions: rows({ videoIds: GENERAL, days: 330 }),
      now: NOW,
    });

    expect(result.general).toBe(true);
  });

  it('reports expired training as not done', () => {
    const result = getTrainingTaskCompliance({
      requiredGroupIds: ['general'],
      completions: rows({ videoIds: GENERAL, days: 400 }),
      now: NOW,
    });

    expect(result.general).toBe(false);
  });

  it('counts a renewed member as done, although they now have two rows per video', () => {
    const result = getTrainingTaskCompliance({
      requiredGroupIds: ['general'],
      completions: [
        ...rows({ videoIds: GENERAL, cycle: 1, days: 400 }),
        ...rows({ videoIds: GENERAL, cycle: 2, days: 3 }),
      ],
      now: NOW,
    });

    expect(result.general).toBe(true);
  });
});
