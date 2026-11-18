import { describe, expect, it } from 'vitest';
import { parseCompletion, parseCompletions } from './parse-completions';

const asJson = <T>(value: T): unknown => JSON.parse(JSON.stringify(value));

const row = {
  id: 'evc_1',
  memberId: 'mem_1',
  videoId: 'sat-1',
  cycle: 1,
  dueAt: null,
  completedAt: new Date('2026-02-01T09:00:00.000Z'),
};

describe('parseCompletions', () => {
  it('turns the date strings of an API response back into dates', () => {
    const [parsed] = parseCompletions(asJson([row]));

    expect(parsed?.completedAt).toBeInstanceOf(Date);
    expect(parsed?.completedAt?.toISOString()).toBe('2026-02-01T09:00:00.000Z');
  });

  it('keeps a missing completion as null, not the start of 1970', () => {
    const [parsed] = parseCompletions(asJson([{ ...row, completedAt: null }]));

    expect(parsed?.completedAt).toBeNull();
    expect(parsed?.dueAt).toBeNull();
  });

  it('parses a due date when there is one', () => {
    const [parsed] = parseCompletions(
      asJson([{ ...row, dueAt: new Date('2026-12-01T00:00:00.000Z') }]),
    );

    expect(parsed?.dueAt?.toISOString()).toBe('2026-12-01T00:00:00.000Z');
  });

  it('accepts rows that already hold dates, as server rendered data does', () => {
    const [parsed] = parseCompletions([row]);

    expect(parsed?.completedAt).toEqual(row.completedAt);
  });

  it('treats a row without a cycle as the first cycle, as an API not yet redeployed sends', () => {
    const { cycle, ...withoutCycle } = row;
    const [parsed] = parseCompletions(asJson([withoutCycle]));

    expect(cycle).toBe(1);
    expect(parsed?.cycle).toBe(1);
  });

  it('rejects a response that is not a list of completions', () => {
    expect(() => parseCompletions({ error: 'nope' })).toThrow();
    expect(() => parseCompletions([{ ...row, completedAt: 'not a date' }])).toThrow();
  });
});

describe('parseCompletion', () => {
  it('parses the single row the completion route returns', () => {
    const parsed = parseCompletion(asJson(row));

    expect(parsed.completedAt).toBeInstanceOf(Date);
    expect(parsed.cycle).toBe(1);
  });
});
