import { VendorContractTerm, VendorCostModel } from '@db';
import { describe, expect, it } from 'vitest';
import {
  centsToDollars,
  costUnitLabel,
  dateToUtcDateOnly,
  dollarsToCents,
  parseNumberInput,
  toInputValue,
  utcDateOnlyToDate,
} from './contract-format';

describe('centsToDollars', () => {
  it('converts cents to dollars', () => {
    expect(centsToDollars(1_200_000)).toBe(12_000);
    expect(centsToDollars(1_250)).toBe(12.5);
    expect(centsToDollars(0)).toBe(0);
  });

  it('passes through "not recorded"', () => {
    expect(centsToDollars(null)).toBeNull();
    expect(centsToDollars(undefined)).toBeNull();
  });
});

describe('dollarsToCents', () => {
  it('converts dollars to cents', () => {
    expect(dollarsToCents(12_000)).toBe(1_200_000);
    expect(dollarsToCents(12.5)).toBe(1_250);
    expect(dollarsToCents(0)).toBe(0);
  });

  it('rounds instead of truncating', () => {
    expect(dollarsToCents(12.34)).toBe(1234);
    expect(dollarsToCents(0.07)).toBe(7);
    expect(dollarsToCents(19.99)).toBe(1999);
  });

  it('passes through "not recorded"', () => {
    expect(dollarsToCents(null)).toBeNull();
    expect(dollarsToCents(undefined)).toBeNull();
  });

  it('round-trips through cents', () => {
    for (const dollars of [0, 1, 12.5, 19.99, 12_000]) {
      expect(centsToDollars(dollarsToCents(dollars))).toBe(dollars);
    }
  });
});

describe('parseNumberInput', () => {
  it('parses numbers', () => {
    expect(parseNumberInput('50')).toBe(50);
    expect(parseNumberInput('0')).toBe(0);
    expect(parseNumberInput('12.5')).toBe(12.5);
  });

  it('maps an empty input to null, not zero', () => {
    expect(parseNumberInput('')).toBeNull();
    expect(parseNumberInput('   ')).toBeNull();
  });

  it('maps a half-typed value to null rather than NaN', () => {
    expect(parseNumberInput('-')).toBeNull();
    expect(parseNumberInput('1e')).toBeNull();
    expect(parseNumberInput('abc')).toBeNull();
  });
});

describe('toInputValue', () => {
  it('renders numbers, including zero', () => {
    expect(toInputValue(50)).toBe('50');
    expect(toInputValue(0)).toBe('0');
  });

  it('renders "not recorded" as an empty input', () => {
    expect(toInputValue(null)).toBe('');
    expect(toInputValue(undefined)).toBe('');
  });
});

describe('renewal date, which is a calendar date in a DateTime column', () => {
  it('pins the picked day to UTC midnight', () => {
    expect(dateToUtcDateOnly(new Date(2027, 0, 31))).toBe('2027-01-31T00:00:00.000Z');
    expect(dateToUtcDateOnly(new Date(2027, 0, 31, 23, 45))).toBe('2027-01-31T00:00:00.000Z');
  });

  it('reads a stored date back as the same calendar day', () => {
    const parsed = utcDateOnlyToDate('2027-01-31T00:00:00.000Z');
    expect(parsed?.getFullYear()).toBe(2027);
    expect(parsed?.getMonth()).toBe(0);
    expect(parsed?.getDate()).toBe(31);
  });

  it('round-trips without drifting a day', () => {
    for (const day of [new Date(2027, 0, 1), new Date(2027, 6, 15), new Date(2027, 11, 31)]) {
      expect(utcDateOnlyToDate(dateToUtcDateOnly(day))).toEqual(day);
    }
  });

  it('treats missing and unparseable values as "not recorded"', () => {
    expect(dateToUtcDateOnly(null)).toBeNull();
    expect(dateToUtcDateOnly(undefined)).toBeNull();
    expect(utcDateOnlyToDate(null)).toBeNull();
    expect(utcDateOnlyToDate('')).toBeNull();
    expect(utcDateOnlyToDate('not a date')).toBeNull();
  });
});

describe('costUnitLabel', () => {
  it('shows the billing period', () => {
    expect(costUnitLabel({ contractTerm: VendorContractTerm.monthly })).toBe('/mo');
    expect(costUnitLabel({ contractTerm: VendorContractTerm.yearly })).toBe('/yr');
  });

  it('marks a per-seat price', () => {
    expect(
      costUnitLabel({
        costModel: VendorCostModel.per_seat,
        contractTerm: VendorContractTerm.monthly,
      }),
    ).toBe('/seat/mo');
  });

  it('leaves flat-fee models to the period alone', () => {
    for (const costModel of [
      VendorCostModel.fixed,
      VendorCostModel.usage_based,
      VendorCostModel.mixed,
    ]) {
      expect(costUnitLabel({ costModel, contractTerm: VendorContractTerm.yearly })).toBe('/yr');
    }
  });

  it('renders nothing when there is no period to show', () => {
    expect(costUnitLabel({})).toBe('');
    expect(costUnitLabel({ costModel: null, contractTerm: null })).toBe('');
  });
});
