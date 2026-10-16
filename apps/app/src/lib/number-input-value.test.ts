import { describe, expect, it } from 'vitest';
import { numberInputValue } from './number-input-value';

describe('numberInputValue', () => {
  it('keeps a cleared field empty instead of coercing it to 0', () => {
    expect(numberInputValue('')).toBe('');
  });

  it('converts typed numbers, including an explicit 0', () => {
    expect(numberInputValue('0')).toBe(0);
    expect(numberInputValue('14')).toBe(14);
  });
});
