import { getTrainingGroup } from '@trycompai/company';
import { describe, expect, it } from 'vitest';
import { buildTrainingGroupView } from './training-view';

const NOW = new Date('2026-11-10T12:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (days: number): Date => new Date(NOW.getTime() - days * DAY_MS);

const general = getTrainingGroup('general');
const ccpa = getTrainingGroup('ccpa');

const row = ({ videoId, cycle = 1, days }: { videoId: string; cycle?: number; days: number }) => ({
  videoId,
  cycle,
  completedAt: daysAgo(days),
});

const all = (ids: readonly string[], opts: { cycle?: number; days: number }) =>
  ids.map((videoId) => row({ videoId, ...opts }));

describe('buildTrainingGroupView', () => {
  it('shows an untouched group as incomplete with every module pending', () => {
    const view = buildTrainingGroupView({ group: ccpa, completions: [], now: NOW });

    expect(view.status.status).toBe('incomplete');
    expect(view.displayCycle).toBe(1);
    expect(view.modules).toEqual([
      { videoId: 'ccpa-1', completedAt: null },
      { videoId: 'ccpa-2', completedAt: null },
    ]);
  });

  it('shows partial first cycle progress', () => {
    const view = buildTrainingGroupView({
      group: ccpa,
      completions: [row({ videoId: 'ccpa-1', days: 3 })],
      now: NOW,
    });

    expect(view.modules).toEqual([
      { videoId: 'ccpa-1', completedAt: daysAgo(3) },
      { videoId: 'ccpa-2', completedAt: null },
    ]);
  });

  it('shows the completed cycle for a valid group', () => {
    const view = buildTrainingGroupView({
      group: general,
      completions: all(general.moduleIds, { days: 10 }),
      now: NOW,
    });

    expect(view.status.status).toBe('valid');
    expect(view.displayCycle).toBe(1);
    expect(view.modules.every((module) => module.completedAt !== null)).toBe(true);
  });

  it('keeps showing last year as done while a renewal is only coming up', () => {
    const view = buildTrainingGroupView({
      group: general,
      completions: all(general.moduleIds, { days: 330 }),
      now: NOW,
    });

    expect(view.status.status).toBe('renewal_due');
    expect(view.displayCycle).toBe(1);
    expect(view.modules.every((module) => module.completedAt !== null)).toBe(true);
  });

  it('shows renewal progress, not last year, once the training has expired', () => {
    const view = buildTrainingGroupView({
      group: general,
      completions: [
        ...all(general.moduleIds, { cycle: 1, days: 400 }),
        row({ videoId: 'sat-1', cycle: 2, days: 1 }),
      ],
      now: NOW,
    });

    expect(view.status.status).toBe('expired');
    expect(view.displayCycle).toBe(2);
    expect(view.modules.map((module) => module.completedAt !== null)).toEqual([
      true,
      false,
      false,
      false,
      false,
    ]);
  });

  it('keeps the modules in the catalog order', () => {
    const view = buildTrainingGroupView({
      group: general,
      completions: [],
      now: NOW,
    });

    expect(view.modules.map((module) => module.videoId)).toEqual([...general.moduleIds]);
  });

  it('shows a video watched over a year ago in an unfinished training as still to do', () => {
    const view = buildTrainingGroupView({
      group: general,
      completions: [row({ videoId: 'sat-1', days: 400 }), row({ videoId: 'sat-2', days: 5 })],
      now: NOW,
    });

    expect(view.status.status).toBe('incomplete');
    expect(view.modules.slice(0, 2)).toEqual([
      { videoId: 'sat-1', completedAt: null },
      { videoId: 'sat-2', completedAt: daysAgo(5) },
    ]);
  });
});
