import { describe, expect, it } from 'bun:test';
import type { TrainingModuleCompletion, TrainingParticipant } from '../../../training-types';
import { STRICT_SPAN_SINCE, assessTraining } from '../training-status';

// Hosts that renew training yearly tag each completion with its renewal cycle.
// A cycle only counts once every required module was finished in it, so a
// renewal cannot be assembled from one old part and one fresh part.

const REQUIRED = ['sat-1', 'sat-2', 'sat-3'];
// After the strict span cutover, so finished rounds here follow the current rules.
const NOW = new Date('2027-06-01T12:00:00.000Z');
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

describe('assessTraining with lapsed progress', () => {
  it('lists a video watched over a year ago in an unfinished round as missing', () => {
    const result = assess(
      participant({
        completions: [
          completion({ moduleId: 'sat-1', cycle: 1, days: 400 }),
          completion({ moduleId: 'sat-2', cycle: 1, days: 5 }),
        ],
      }),
    );

    expect(result).toEqual({ status: 'incomplete', missingModuleIds: ['sat-1', 'sat-3'] });
  });

  it('does not count a round finished with an already lapsed video as finished', () => {
    const result = assess(
      participant({
        completions: [
          completion({ moduleId: 'sat-1', cycle: 1, days: 400 }),
          ...cycleOf({ cycle: 1, days: 5, moduleIds: ['sat-2', 'sat-3'] }),
        ],
      }),
    );

    expect(result).toEqual({ status: 'incomplete', missingModuleIds: ['sat-1'] });
  });

  it('still reports a round finished within a year as expired once it ages out', () => {
    const result = assess(
      participant({
        completions: [
          completion({ moduleId: 'sat-1', cycle: 1, days: 370 }),
          ...cycleOf({ cycle: 1, days: 300, moduleIds: ['sat-2', 'sat-3'] }),
        ],
      }),
    );

    expect(result.status).toBe('expired');
  });
});

describe('assessTraining around the strict span cutover', () => {
  // A week after the cutover, judging a round whose first module was watched
  // 330 days before the others.
  const now = new Date(STRICT_SPAN_SINCE.getTime() + 7 * DAY_MS);
  const statusFor = (finish: Date) =>
    assessTraining({
      participant: participant({
        joinedAt: new Date(now.getTime() - 500 * DAY_MS).toISOString(),
        completions: [
          {
            moduleId: 'sat-1',
            cycle: 1,
            completedAt: new Date(finish.getTime() - 330 * DAY_MS).toISOString(),
          },
          ...['sat-2', 'sat-3'].map((moduleId) => ({
            moduleId,
            cycle: 1,
            completedAt: finish.toISOString(),
          })),
        ],
      }),
      requiredModuleIds: REQUIRED,
      now,
    }).status;

  it('judges a round finished exactly at the cutover strictly', () => {
    expect(statusFor(STRICT_SPAN_SINCE)).toBe('incomplete');
  });

  it('counts a round finished a millisecond before the cutover from its oldest module', () => {
    expect(statusFor(new Date(STRICT_SPAN_SINCE.getTime() - 1))).toBe('complete');
  });
});
