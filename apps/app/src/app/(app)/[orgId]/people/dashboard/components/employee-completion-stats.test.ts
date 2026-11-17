import { getTrainingGroup } from '@trycompai/company/training';
import { describe, expect, it } from 'vitest';
import { buildEmployeeStats, describeGroupProgress } from './employee-completion-stats';

const NOW = new Date('2026-11-10T12:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (days: number): Date => new Date(NOW.getTime() - days * DAY_MS);

const general = getTrainingGroup('general');
const hipaa = getTrainingGroup('hipaa');
const ccpa = getTrainingGroup('ccpa');

const employee = (id: string, name: string | null = null) => ({
  id,
  user: { name, email: `${id}@example.com` },
});

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

const stats = (overrides: Partial<Parameters<typeof buildEmployeeStats>[0]> = {}) =>
  buildEmployeeStats({
    employees: [employee('mem_1', 'Ada'), employee('mem_2')],
    policies: [],
    completions: [],
    groups: [],
    now: NOW,
    ...overrides,
  });

describe('buildEmployeeStats', () => {
  it('names an employee by their name, falling back to the start of their email', () => {
    const [ada, other] = stats();

    expect(ada?.name).toBe('Ada');
    expect(other?.name).toBe('mem_2');
    expect(other?.email).toBe('mem_2@example.com');
  });

  it('counts signed policies and gives each employee their own percentage', () => {
    const [first, second] = stats({
      policies: [{ signedBy: ['mem_1'] }, { signedBy: ['mem_1', 'mem_2'] }],
    });

    expect(first).toMatchObject({ policiesCompleted: 2, policiesTotal: 2, overallPercentage: 100 });
    expect(second).toMatchObject({ policiesCompleted: 1, policiesTotal: 2, overallPercentage: 50 });
  });

  it('counts every module of valid training, and of training only due for renewal', () => {
    const [valid, renewal] = stats({
      groups: [general],
      completions: [
        ...rows({ memberId: 'mem_1', videoIds: general.moduleIds, days: 10 }),
        ...rows({ memberId: 'mem_2', videoIds: general.moduleIds, days: 330 }),
      ],
    });

    expect(valid).toMatchObject({ trainingCompleted: 5, trainingTotal: 5, overallPercentage: 100 });
    expect(renewal).toMatchObject({ trainingCompleted: 5, trainingTotal: 5 });
  });

  it('does not count an employee with an old and a renewed cycle twice', () => {
    const [first] = stats({
      groups: [general],
      completions: [
        ...rows({ memberId: 'mem_1', videoIds: general.moduleIds, cycle: 1, days: 400 }),
        ...rows({ memberId: 'mem_1', videoIds: general.moduleIds, cycle: 2, days: 3 }),
      ],
    });

    expect(first).toMatchObject({ trainingCompleted: 5, trainingTotal: 5 });
  });

  it('shows only renewal progress once training has expired', () => {
    const [first] = stats({
      groups: [general],
      completions: [
        ...rows({ memberId: 'mem_1', videoIds: general.moduleIds, cycle: 1, days: 400 }),
        ...rows({ memberId: 'mem_1', videoIds: ['sat-1', 'sat-2'], cycle: 2, days: 1 }),
      ],
    });

    expect(first).toMatchObject({ trainingCompleted: 2, trainingTotal: 5 });
  });

  it('reports each required group separately, in catalog order', () => {
    const [first] = stats({
      groups: [general, hipaa, ccpa],
      completions: [
        ...rows({ memberId: 'mem_1', videoIds: general.moduleIds, days: 10 }),
        ...rows({ memberId: 'mem_1', videoIds: ['ccpa-1'], days: 10 }),
      ],
    });

    expect(first?.groups).toEqual([
      { id: 'general', completed: 5, total: 5 },
      { id: 'hipaa', completed: 0, total: 1 },
      { id: 'ccpa', completed: 1, total: 2 },
    ]);
    expect(first).toMatchObject({ trainingCompleted: 6, trainingTotal: 8, totalTasks: 8 });
  });

  it('reports no groups, and no percentage, when nothing is required', () => {
    const [first] = stats();

    expect(first).toMatchObject({ groups: [], totalTasks: 0, overallPercentage: 0 });
  });

  it('keeps one employee completions from counting for another', () => {
    const [, second] = stats({
      groups: [general],
      completions: rows({ memberId: 'mem_1', videoIds: general.moduleIds, days: 10 }),
    });

    expect(second).toMatchObject({ trainingCompleted: 0, trainingTotal: 5 });
  });
});

describe('describeGroupProgress', () => {
  it('describes general training as a count of videos', () => {
    expect(describeGroupProgress({ id: 'general', completed: 3, total: 5 })).toBe('3/5 training');
  });

  it('describes the single HIPAA acknowledgement as done or pending', () => {
    expect(describeGroupProgress({ id: 'hipaa', completed: 1, total: 1 })).toBe('HIPAA done');
    expect(describeGroupProgress({ id: 'hipaa', completed: 0, total: 1 })).toBe('HIPAA pending');
  });

  it('describes CCPA training as a count of videos', () => {
    expect(describeGroupProgress({ id: 'ccpa', completed: 1, total: 2 })).toBe('CCPA 1/2');
  });
});
