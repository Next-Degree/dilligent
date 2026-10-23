import { describe, expect, it } from 'bun:test';
import type { TrainingParticipant } from '../../../training-types';
import { assessTraining } from '../training-status';

const REQUIRED = ['sat-1', 'sat-2', 'sat-3'];
const NOW = new Date('2026-10-23T12:00:00.000Z');

const daysAgo = (days: number): string =>
  new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString();

const participant = (overrides: Partial<TrainingParticipant> = {}): TrainingParticipant => ({
  id: 'mem_1',
  email: 'ada@acme.com',
  name: 'Ada',
  joinedAt: daysAgo(400),
  completions: [],
  ...overrides,
});

const finishedAll = (days: number) =>
  REQUIRED.map((moduleId) => ({ moduleId, completedAt: daysAgo(days) }));

const assess = (p: TrainingParticipant) =>
  assessTraining({ participant: p, requiredModuleIds: REQUIRED, now: NOW });

describe('assessTraining', () => {
  it('is complete when every module was finished within the last year', () => {
    const result = assess(participant({ completions: finishedAll(10) }));

    expect(result).toEqual({
      status: 'complete',
      completedAt: daysAgo(10),
      validUntil: new Date(new Date(daysAgo(10)).getTime() + 365 * 86_400_000).toISOString(),
    });
  });

  it('reports the date the last module was finished and runs the window from the oldest', () => {
    const result = assess(
      participant({
        completions: [
          { moduleId: 'sat-1', completedAt: daysAgo(20) },
          { moduleId: 'sat-2', completedAt: daysAgo(10) },
          { moduleId: 'sat-3', completedAt: daysAgo(15) },
        ],
      }),
    );

    expect(result).toEqual({
      status: 'complete',
      completedAt: daysAgo(10),
      validUntil: new Date(new Date(daysAgo(20)).getTime() + 365 * 86_400_000).toISOString(),
    });
  });

  it('is expired when every module was finished more than a year ago', () => {
    const result = assess(participant({ completions: finishedAll(366) }));

    expect(result.status).toBe('expired');
    if (result.status !== 'expired') throw new Error('unreachable');
    expect(result.completedAt).toBe(daysAgo(366));
  });

  it('is expired as soon as any one module is more than a year old', () => {
    const result = assess(
      participant({
        completions: [
          { moduleId: 'sat-1', completedAt: daysAgo(370) },
          { moduleId: 'sat-2', completedAt: daysAgo(300) },
          { moduleId: 'sat-3', completedAt: daysAgo(300) },
        ],
      }),
    );

    expect(result).toEqual({
      status: 'expired',
      completedAt: daysAgo(300),
      expiredAt: new Date(new Date(daysAgo(370)).getTime() + 365 * 86_400_000).toISOString(),
    });
  });

  it('is incomplete and lists the unfinished modules', () => {
    const result = assess(
      participant({ completions: [{ moduleId: 'sat-2', completedAt: daysAgo(5) }] }),
    );

    expect(result).toEqual({ status: 'incomplete', missingModuleIds: ['sat-1', 'sat-3'] });
  });

  it('is incomplete for someone who never started', () => {
    expect(assess(participant())).toEqual({
      status: 'incomplete',
      missingModuleIds: REQUIRED,
    });
  });

  it('ignores modules that are not required', () => {
    const result = assess(
      participant({
        completions: [
          ...finishedAll(10).slice(0, 2),
          { moduleId: 'hipaa-1', completedAt: daysAgo(1) },
        ],
      }),
    );

    expect(result).toEqual({ status: 'incomplete', missingModuleIds: ['sat-3'] });
  });

  it('gives a recent joiner the onboarding window instead of failing them', () => {
    const result = assess(participant({ joinedAt: daysAgo(29) }));

    expect(result.status).toBe('onboarding');
    if (result.status !== 'onboarding') throw new Error('unreachable');
    expect(result.missingModuleIds).toEqual(REQUIRED);
    expect(result.graceEndsAt).toBe(
      new Date(new Date(daysAgo(29)).getTime() + 30 * 86_400_000).toISOString(),
    );
  });

  it('fails a joiner once the onboarding window has passed', () => {
    expect(assess(participant({ joinedAt: daysAgo(31) })).status).toBe('incomplete');
  });

  it('reports a recent joiner who already finished as complete', () => {
    const result = assess(participant({ joinedAt: daysAgo(3), completions: finishedAll(1) }));

    expect(result.status).toBe('complete');
  });

  it('judges a retaken module on its latest completion', () => {
    const result = assess(
      participant({
        completions: [
          ...finishedAll(400),
          ...REQUIRED.map((moduleId) => ({ moduleId, completedAt: daysAgo(2) })),
        ],
      }),
    );

    expect(result.status).toBe('complete');
  });

  it('does not renew the whole training when only one module is retaken', () => {
    const result = assess(
      participant({
        completions: [...finishedAll(400), { moduleId: 'sat-1', completedAt: daysAgo(2) }],
      }),
    );

    expect(result.status).toBe('expired');
  });

  it('skips completions with an unreadable date', () => {
    const result = assess(
      participant({
        completions: [
          ...finishedAll(10).slice(1),
          { moduleId: 'sat-1', completedAt: 'not-a-date' },
        ],
      }),
    );

    expect(result).toEqual({ status: 'incomplete', missingModuleIds: ['sat-1'] });
  });
});
