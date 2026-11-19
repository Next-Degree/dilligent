import { describe, expect, it } from 'bun:test';
import { getTrainingGroup, requiredTrainingGroups } from '../catalog';
import {
  assessRequiredTraining,
  groupCompletionsByMember,
  hasCompletedRequiredTraining,
} from '../required-training';
import type { TrainingCompletionRecord } from '../status';

// After the strict span cutover, so any finished cycle here follows the current rules.
const NOW = new Date('2027-06-01T12:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;

const daysAgo = (days: number): Date => new Date(NOW.getTime() - days * DAY_MS);

const general = getTrainingGroup('general');
const ccpa = getTrainingGroup('ccpa');
const hipaa = getTrainingGroup('hipaa');

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

describe('assessRequiredTraining', () => {
  it('returns nothing, and counts as complete, when no training is required', () => {
    const progress = assessRequiredTraining({ groups: [], completions: [], now: NOW });

    expect(progress).toEqual([]);
    expect(hasCompletedRequiredTraining(progress)).toBe(true);
  });

  it('counts every module of a valid group as completed', () => {
    const [entry] = assessRequiredTraining({
      groups: [general],
      completions: completeAll({ moduleIds: general.moduleIds, days: 10 }),
      now: NOW,
    });

    expect(entry).toMatchObject({ compliant: true, completedModules: 5, totalModules: 5 });
    expect(entry?.group.id).toBe('general');
    expect(entry?.status.status).toBe('valid');
  });

  it('still counts a group due for renewal as compliant, with every module completed', () => {
    const [entry] = assessRequiredTraining({
      groups: [general],
      completions: completeAll({ moduleIds: general.moduleIds, days: 330 }),
      now: NOW,
    });

    expect(entry).toMatchObject({ compliant: true, completedModules: 5, totalModules: 5 });
    expect(entry?.status.status).toBe('renewal_due');
  });

  it('does not count an expired group as compliant, and shows only renewal progress', () => {
    const [entry] = assessRequiredTraining({
      groups: [general],
      completions: [
        ...completeAll({ moduleIds: general.moduleIds, cycle: 1, days: 400 }),
        ...completeAll({ moduleIds: ['sat-1', 'sat-2'], cycle: 2, days: 1 }),
      ],
      now: NOW,
    });

    expect(entry).toMatchObject({ compliant: false, completedModules: 2, totalModules: 5 });
    expect(entry?.status.status).toBe('expired');
  });

  it('counts partial first cycle progress for a group never completed', () => {
    const [entry] = assessRequiredTraining({
      groups: [ccpa],
      completions: completeAll({ moduleIds: ['ccpa-1'], days: 3 }),
      now: NOW,
    });

    expect(entry).toMatchObject({ compliant: false, completedModules: 1, totalModules: 2 });
  });

  it('assesses each required group independently', () => {
    const progress = assessRequiredTraining({
      groups: [general, hipaa, ccpa],
      completions: completeAll({ moduleIds: general.moduleIds, days: 10 }),
      now: NOW,
    });

    expect(progress.map((entry) => [entry.group.id, entry.compliant])).toEqual([
      ['general', true],
      ['hipaa', false],
      ['ccpa', false],
    ]);
    expect(hasCompletedRequiredTraining(progress)).toBe(false);
  });

  it('is complete only once every required group is compliant', () => {
    const completions = [
      ...completeAll({ moduleIds: general.moduleIds, days: 10 }),
      ...completeAll({ moduleIds: ccpa.moduleIds, days: 10 }),
    ];

    expect(
      hasCompletedRequiredTraining(
        assessRequiredTraining({ groups: [general, ccpa], completions, now: NOW }),
      ),
    ).toBe(true);
  });

  it('works from the groups an org requires', () => {
    const groups = requiredTrainingGroups({
      securityTrainingStepEnabled: true,
      frameworkNames: ['CCPA'],
    });

    expect(assessRequiredTraining({ groups, completions: [], now: NOW }).length).toBe(2);
  });
});

describe('groupCompletionsByMember', () => {
  it('groups rows by member and keeps each member row together', () => {
    const rows = [
      { memberId: 'a', videoId: 'sat-1' },
      { memberId: 'b', videoId: 'sat-1' },
      { memberId: 'a', videoId: 'sat-2' },
    ];

    const grouped = groupCompletionsByMember(rows);

    expect(grouped.get('a')).toEqual([rows[0], rows[2]]);
    expect(grouped.get('b')).toEqual([rows[1]]);
    expect(grouped.get('c')).toBeUndefined();
  });
});
