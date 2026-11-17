import { getTrainingGroup } from '@trycompai/company';
import { describe, expect, it } from 'vitest';
import { buildTrainingGroupView } from '@/lib/training/training-view';
import { describeTrainingStatus } from './training-status-text';

const NOW = new Date('2026-11-10T12:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (days: number): Date => new Date(NOW.getTime() - days * DAY_MS);
const formatDate = (date: Date): string => date.toISOString().slice(0, 10);

const general = getTrainingGroup('general');

const rows = ({
  videoIds,
  cycle = 1,
  days,
}: {
  videoIds: readonly string[];
  cycle?: number;
  days: number;
}) => videoIds.map((videoId) => ({ videoId, cycle, completedAt: daysAgo(days) }));

const describe_ = (completions: ReturnType<typeof rows>) =>
  describeTrainingStatus({
    view: buildTrainingGroupView({ group: general, completions, now: NOW }),
    formatDate,
  });

describe('describeTrainingStatus', () => {
  it('counts videos for a group that is not finished', () => {
    const text = describe_(rows({ videoIds: general.moduleIds.slice(0, 2), days: 3 }));

    expect(text).toEqual({ tone: 'muted', title: '2/5 Videos Completed', detail: null });
  });

  it('says a valid group is complete, with when it was done and when it runs out', () => {
    const text = describe_(rows({ videoIds: general.moduleIds, days: 10 }));

    expect(text.tone).toBe('success');
    expect(text.title).toBe('All Training Complete');
    expect(text.detail).toBe('Completed on 2026-10-31. Valid until 2027-10-31.');
  });

  it('flags a group that is complete but due for renewal', () => {
    const text = describe_(rows({ videoIds: general.moduleIds, days: 330 }));

    expect(text.tone).toBe('warning');
    expect(text.title).toBe('Renewal Due');
    expect(text.detail).toBe('Completed on 2025-12-15. Valid until 2026-12-15.');
  });

  it('says an expired group has expired and shows renewal progress', () => {
    const text = describe_([
      ...rows({ videoIds: general.moduleIds, cycle: 1, days: 400 }),
      ...rows({ videoIds: general.moduleIds.slice(0, 2), cycle: 2, days: 1 }),
    ]);

    expect(text.tone).toBe('danger');
    expect(text.title).toBe('Training Expired');
    expect(text.detail).toBe('Expired on 2026-10-06. Renewal: 2/5 videos completed.');
  });

  it('shows no renewal progress for an expired group with nothing renewed yet', () => {
    const text = describe_(rows({ videoIds: general.moduleIds, days: 400 }));

    expect(text.detail).toBe('Expired on 2026-10-06. Renewal: 0/5 videos completed.');
  });
});
