import { describe, expect, it } from 'bun:test';
import type { TrainingModuleCompletion, TrainingParticipant } from '../../../training-types';
import { assessTraining } from '../training-status';

// Hosts that renew training yearly tag each completion with its renewal cycle.
// A cycle only counts once every required module was finished in it, so a
// renewal cannot be assembled from one old part and one fresh part.

const REQUIRED = ['sat-1', 'sat-2', 'sat-3'];
const NOW = new Date('2026-10-23T12:00:00.000Z');
const DAY_MS = 86_400_000;

const daysAgo = (days: number): string => new Date(NOW.getTime() - days * DAY_MS).toISOString();

const completion = ({
  moduleId,
  cycle,
  days,
}: {
  moduleId: string;
  cycle: number;
  days: number;
}): TrainingModuleCompletion => ({ moduleId, cycle, completedAt: daysAgo(days) });

const cycleOf = ({
  cycle,
  days,
  moduleIds = REQUIRED,
}: {
  cycle: number;
  days: number;
  moduleIds?: string[];
}): TrainingModuleCompletion[] =>
  moduleIds.map((moduleId) => completion({ moduleId, cycle, days }));

const participant = (overrides: Partial<TrainingParticipant> = {}): TrainingParticipant => ({
  id: 'mem_1',
  email: 'ada@acme.com',
  name: 'Ada',
  joinedAt: daysAgo(500),
  completions: [],
  ...overrides,
});

const assess = (p: TrainingParticipant) =>
  assessTraining({ participant: p, requiredModuleIds: REQUIRED, now: NOW });

describe('assessTraining with renewal cycles', () => {
  it('is complete once a renewal cycle is fully finished, however old the first cycle is', () => {
    const result = assess(
      participant({
        completions: [...cycleOf({ cycle: 1, days: 400 }), ...cycleOf({ cycle: 2, days: 3 })],
      }),
    );

    expect(result).toEqual({
      status: 'complete',
      completedAt: daysAgo(3),
      validUntil: new Date(new Date(daysAgo(3)).getTime() + 365 * DAY_MS).toISOString(),
    });
  });

  it('does not let renewing only the oldest module extend the validity window', () => {
    const result = assess(
      participant({
        completions: [
          completion({ moduleId: 'sat-1', cycle: 1, days: 400 }),
          ...cycleOf({ cycle: 1, days: 100, moduleIds: ['sat-2', 'sat-3'] }),
          completion({ moduleId: 'sat-1', cycle: 2, days: 1 }),
        ],
      }),
    );

    expect(result.status).toBe('expired');
  });

  it('stays valid on the first cycle while a renewal is only partly done', () => {
    const result = assess(
      participant({
        completions: [
          ...cycleOf({ cycle: 1, days: 330 }),
          completion({ moduleId: 'sat-1', cycle: 2, days: 1 }),
        ],
      }),
    );

    expect(result).toEqual({
      status: 'complete',
      completedAt: daysAgo(330),
      validUntil: new Date(new Date(daysAgo(330)).getTime() + 365 * DAY_MS).toISOString(),
    });
  });

  it('is expired when an expired first cycle has only a partial renewal', () => {
    const result = assess(
      participant({
        completions: [
          ...cycleOf({ cycle: 1, days: 400 }),
          ...cycleOf({ cycle: 2, days: 1, moduleIds: ['sat-1', 'sat-2'] }),
        ],
      }),
    );

    expect(result.status).toBe('expired');
  });

  it('judges the highest fully finished cycle even if a later one is partial', () => {
    const result = assess(
      participant({
        completions: [
          ...cycleOf({ cycle: 1, days: 20 }),
          ...cycleOf({ cycle: 2, days: 5, moduleIds: ['sat-1'] }),
        ],
      }),
    );

    expect(result).toMatchObject({ status: 'complete', completedAt: daysAgo(20) });
  });

  it('lists the modules missing from the cycle being worked on', () => {
    const result = assess(
      participant({
        completions: cycleOf({ cycle: 1, days: 5, moduleIds: ['sat-1'] }),
      }),
    );

    expect(result).toEqual({ status: 'incomplete', missingModuleIds: ['sat-2', 'sat-3'] });
  });

  it('still gives a recent joiner the onboarding window', () => {
    const result = assess(
      participant({
        joinedAt: daysAgo(5),
        completions: cycleOf({ cycle: 1, days: 2, moduleIds: ['sat-1'] }),
      }),
    );

    expect(result).toMatchObject({ status: 'onboarding', missingModuleIds: ['sat-2', 'sat-3'] });
  });

  it('keeps judging completions without a cycle on their latest date per module', () => {
    const untagged = REQUIRED.map((moduleId) => ({ moduleId, completedAt: daysAgo(10) }));

    expect(assess(participant({ completions: untagged })).status).toBe('complete');
  });
});
