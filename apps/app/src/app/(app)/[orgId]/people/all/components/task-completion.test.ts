import { getTrainingGroup } from '@trycompai/company';
import { describe, expect, it } from 'vitest';
import { buildTaskCompletionMap } from './task-completion';

const NOW = new Date('2026-11-10T12:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (days: number): Date => new Date(NOW.getTime() - days * DAY_MS);

const general = getTrainingGroup('general');
const hipaa = getTrainingGroup('hipaa');
const ccpa = getTrainingGroup('ccpa');

const rows = ({
  memberId,
  videoIds,
  cycle = 1,
  days,
}: {
  memberId: string;
  videoIds: readonly string[];
  cycle?: number;
  days: number;
}) => videoIds.map((videoId) => ({ memberId, videoId, cycle, completedAt: daysAgo(days) }));

const build = ({
  groups = [],
  completions = [],
  policies = [],
}: {
  groups?: Parameters<typeof buildTaskCompletionMap>[0]['groups'];
  completions?: Parameters<typeof buildTaskCompletionMap>[0]['completions'];
  policies?: Parameters<typeof buildTaskCompletionMap>[0]['policies'];
}) =>
  buildTaskCompletionMap({
    employees: [{ id: 'mem_1' }, { id: 'mem_2' }],
    policies,
    groups,
    completions,
    now: NOW,
  });

describe('buildTaskCompletionMap', () => {
  it('counts policies alone when no training is required, with no training entries', () => {
    const map = build({
      policies: [{ signedBy: ['mem_1'] }, { signedBy: ['mem_1', 'mem_2'] }],
    });

    expect(map.mem_1).toEqual({
      completed: 2,
      total: 2,
      policies: { completed: 2, total: 2 },
      training: { completed: 0, total: 0 },
    });
    expect(map.mem_2?.policies).toEqual({ completed: 1, total: 2 });
    expect(map.mem_1).not.toHaveProperty('hipaa');
    expect(map.mem_1).not.toHaveProperty('ccpa');
  });

  it('counts every module of a valid general group', () => {
    const map = build({
      groups: [general],
      completions: rows({ memberId: 'mem_1', videoIds: general.moduleIds, days: 10 }),
    });

    expect(map.mem_1?.training).toEqual({ completed: 5, total: 5 });
    expect(map.mem_2?.training).toEqual({ completed: 0, total: 5 });
  });

  it('still counts a group that is only due for renewal as fully done', () => {
    const map = build({
      groups: [general],
      completions: rows({ memberId: 'mem_1', videoIds: general.moduleIds, days: 330 }),
    });

    expect(map.mem_1?.training).toEqual({ completed: 5, total: 5 });
  });

  it('shows only renewal progress once the training has expired', () => {
    const map = build({
      groups: [general],
      completions: [
        ...rows({ memberId: 'mem_1', videoIds: general.moduleIds, cycle: 1, days: 400 }),
        ...rows({ memberId: 'mem_1', videoIds: general.moduleIds.slice(0, 2), cycle: 2, days: 1 }),
      ],
    });

    expect(map.mem_1?.training).toEqual({ completed: 2, total: 5 });
  });

  it('adds HIPAA only for orgs that require it', () => {
    const map = build({
      groups: [general, hipaa],
      completions: rows({ memberId: 'mem_1', videoIds: hipaa.moduleIds, days: 5 }),
    });

    expect(map.mem_1?.hipaa).toEqual({ completed: 1, total: 1 });
    expect(map.mem_2?.hipaa).toEqual({ completed: 0, total: 1 });
  });

  it('adds CCPA progress only for orgs that require it', () => {
    const map = build({
      groups: [ccpa],
      completions: rows({ memberId: 'mem_1', videoIds: ['ccpa-1'], days: 2 }),
    });

    expect(map.mem_1?.ccpa).toEqual({ completed: 1, total: 2 });
    expect(map.mem_2?.ccpa).toEqual({ completed: 0, total: 2 });
    expect(map.mem_1?.training).toEqual({ completed: 0, total: 0 });
  });

  it('totals policies and every required training module', () => {
    const map = build({
      policies: [{ signedBy: ['mem_1'] }],
      groups: [general, hipaa, ccpa],
      completions: [
        ...rows({ memberId: 'mem_1', videoIds: general.moduleIds, days: 10 }),
        ...rows({ memberId: 'mem_1', videoIds: ['ccpa-1'], days: 10 }),
      ],
    });

    // 1 policy + 5 general + 1 HIPAA + 2 CCPA
    expect(map.mem_1?.total).toBe(9);
    // 1 policy + 5 general + 1 of 2 CCPA
    expect(map.mem_1?.completed).toBe(7);
  });

  it('keeps one member completions from counting for another', () => {
    const map = build({
      groups: [general],
      completions: rows({ memberId: 'mem_1', videoIds: general.moduleIds, days: 10 }),
    });

    expect(map.mem_2?.completed).toBe(0);
  });
});
