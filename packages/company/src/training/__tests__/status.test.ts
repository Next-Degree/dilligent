import { describe, expect, it } from 'bun:test';
import { getTrainingGroup } from '../catalog';
import { TRAINING_RENEWAL_WINDOW_DAYS, TRAINING_VALIDITY_DAYS } from '../constants';
import { assessTrainingGroup, isTrainingCompliant, type TrainingCompletionRecord } from '../status';

const NOW = new Date('2026-11-10T12:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;

const daysAgo = (days: number): Date => new Date(NOW.getTime() - days * DAY_MS);

const general = getTrainingGroup('general');
const hipaa = getTrainingGroup('hipaa');

const record = ({
  videoId,
  cycle = 1,
  days,
}: {
  videoId: string;
  cycle?: number;
  days: number | null;
}): TrainingCompletionRecord => ({
  videoId,
  cycle,
  completedAt: days === null ? null : daysAgo(days),
});

const completeAll = ({
  moduleIds,
  cycle = 1,
  days,
}: {
  moduleIds: readonly string[];
  cycle?: number;
  days: number;
}): TrainingCompletionRecord[] => moduleIds.map((videoId) => record({ videoId, cycle, days }));

describe('assessTrainingGroup', () => {
  it('is incomplete with every module remaining when nothing was done', () => {
    const result = assessTrainingGroup({ group: general, completions: [], now: NOW });

    expect(result).toEqual({
      status: 'incomplete',
      activeCycle: 1,
      remainingModuleIds: [...general.moduleIds],
    });
  });

  it('is incomplete when only some modules are done, ignoring pending rows', () => {
    const result = assessTrainingGroup({
      group: general,
      completions: [
        record({ videoId: 'sat-1', days: 5 }),
        record({ videoId: 'sat-2', days: 5 }),
        record({ videoId: 'sat-3', days: null }),
      ],
      now: NOW,
    });

    expect(result).toEqual({
      status: 'incomplete',
      activeCycle: 1,
      remainingModuleIds: ['sat-3', 'sat-4', 'sat-5'],
    });
  });

  it('is valid when every module was finished recently', () => {
    const result = assessTrainingGroup({
      group: general,
      completions: completeAll({ moduleIds: general.moduleIds, days: 10 }),
      now: NOW,
    });

    expect(result).toEqual({
      status: 'valid',
      cycle: 1,
      completedAt: daysAgo(10),
      validUntil: new Date(daysAgo(10).getTime() + TRAINING_VALIDITY_DAYS * DAY_MS),
    });
  });

  it('runs the validity window from the oldest module and reports the newest as the completion date', () => {
    const result = assessTrainingGroup({
      group: general,
      completions: [
        ...completeAll({ moduleIds: ['sat-1', 'sat-2', 'sat-3', 'sat-4'], days: 200 }),
        record({ videoId: 'sat-5', days: 10 }),
      ],
      now: NOW,
    });

    expect(result).toMatchObject({
      status: 'valid',
      completedAt: daysAgo(10),
      validUntil: new Date(daysAgo(200).getTime() + TRAINING_VALIDITY_DAYS * DAY_MS),
    });
  });

  it('turns renewal_due exactly when the renewal window opens', () => {
    const windowOpensAfter = TRAINING_VALIDITY_DAYS - TRAINING_RENEWAL_WINDOW_DAYS;

    const justBefore = assessTrainingGroup({
      group: general,
      completions: completeAll({ moduleIds: general.moduleIds, days: windowOpensAfter - 1 }),
      now: NOW,
    });
    const atBoundary = assessTrainingGroup({
      group: general,
      completions: completeAll({ moduleIds: general.moduleIds, days: windowOpensAfter }),
      now: NOW,
    });

    expect(justBefore.status).toBe('valid');
    expect(atBoundary.status).toBe('renewal_due');
  });

  it('is renewal_due with the next cycle active and every module remaining', () => {
    const result = assessTrainingGroup({
      group: general,
      completions: completeAll({ moduleIds: general.moduleIds, days: 330 }),
      now: NOW,
    });

    expect(result).toMatchObject({
      status: 'renewal_due',
      cycle: 1,
      activeCycle: 2,
      remainingModuleIds: [...general.moduleIds],
    });
  });

  it('is expired once the validity window has passed, including the exact boundary', () => {
    const pastWindow = assessTrainingGroup({
      group: general,
      completions: completeAll({ moduleIds: general.moduleIds, days: 400 }),
      now: NOW,
    });
    const atBoundary = assessTrainingGroup({
      group: general,
      completions: completeAll({ moduleIds: general.moduleIds, days: TRAINING_VALIDITY_DAYS }),
      now: NOW,
    });

    expect(pastWindow).toMatchObject({ status: 'expired', cycle: 1, activeCycle: 2 });
    expect(atBoundary.status).toBe('expired');
  });

  it('only lists modules still missing from a renewal that is in progress', () => {
    const result = assessTrainingGroup({
      group: general,
      completions: [
        ...completeAll({ moduleIds: general.moduleIds, cycle: 1, days: 330 }),
        record({ videoId: 'sat-1', cycle: 2, days: 2 }),
        record({ videoId: 'sat-2', cycle: 2, days: 2 }),
      ],
      now: NOW,
    });

    expect(result).toMatchObject({
      status: 'renewal_due',
      cycle: 1,
      activeCycle: 2,
      remainingModuleIds: ['sat-3', 'sat-4', 'sat-5'],
    });
  });

  it('keeps an expired member expired while their renewal is only partly done', () => {
    const result = assessTrainingGroup({
      group: general,
      completions: [
        ...completeAll({ moduleIds: general.moduleIds, cycle: 1, days: 400 }),
        record({ videoId: 'sat-1', cycle: 2, days: 1 }),
      ],
      now: NOW,
    });

    expect(result).toMatchObject({
      status: 'expired',
      activeCycle: 2,
      remainingModuleIds: ['sat-2', 'sat-3', 'sat-4', 'sat-5'],
    });
  });

  it('is valid on the new cycle once a renewal is fully completed', () => {
    const result = assessTrainingGroup({
      group: general,
      completions: [
        ...completeAll({ moduleIds: general.moduleIds, cycle: 1, days: 340 }),
        ...completeAll({ moduleIds: general.moduleIds, cycle: 2, days: 3 }),
      ],
      now: NOW,
    });

    expect(result).toMatchObject({ status: 'valid', cycle: 2, completedAt: daysAgo(3) });
  });

  it('is not affected by a pending next-cycle row that has no completion yet', () => {
    const result = assessTrainingGroup({
      group: general,
      completions: [
        ...completeAll({ moduleIds: general.moduleIds, cycle: 1, days: 20 }),
        ...general.moduleIds.map((videoId) => record({ videoId, cycle: 2, days: null })),
      ],
      now: NOW,
    });

    expect(result).toMatchObject({ status: 'valid', cycle: 1 });
  });

  it('judges the latest fully completed cycle even if an earlier cycle was partial', () => {
    const result = assessTrainingGroup({
      group: general,
      completions: [
        record({ videoId: 'sat-1', cycle: 1, days: 500 }),
        ...completeAll({ moduleIds: general.moduleIds, cycle: 2, days: 5 }),
      ],
      now: NOW,
    });

    expect(result).toMatchObject({ status: 'valid', cycle: 2 });
  });

  it('ignores completions for modules outside the group', () => {
    const result = assessTrainingGroup({
      group: hipaa,
      completions: completeAll({ moduleIds: general.moduleIds, days: 5 }),
      now: NOW,
    });

    expect(result).toEqual({
      status: 'incomplete',
      activeCycle: 1,
      remainingModuleIds: [...hipaa.moduleIds],
    });
  });
});

describe('isTrainingCompliant', () => {
  it('counts valid and renewal_due members as compliant', () => {
    const valid = assessTrainingGroup({
      group: general,
      completions: completeAll({ moduleIds: general.moduleIds, days: 10 }),
      now: NOW,
    });
    const renewalDue = assessTrainingGroup({
      group: general,
      completions: completeAll({ moduleIds: general.moduleIds, days: 330 }),
      now: NOW,
    });

    expect(isTrainingCompliant(valid)).toBe(true);
    expect(isTrainingCompliant(renewalDue)).toBe(true);
  });

  it('does not count expired or incomplete members as compliant', () => {
    const expired = assessTrainingGroup({
      group: general,
      completions: completeAll({ moduleIds: general.moduleIds, days: 400 }),
      now: NOW,
    });
    const incomplete = assessTrainingGroup({ group: general, completions: [], now: NOW });

    expect(isTrainingCompliant(expired)).toBe(false);
    expect(isTrainingCompliant(incomplete)).toBe(false);
  });
});
