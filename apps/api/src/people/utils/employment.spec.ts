import { BadRequestException } from '@nestjs/common';
import { resolveEmploymentUpdate, type EmploymentState } from './employment';

const permanent: EmploymentState = {
  employmentType: 'permanent',
  contractExpiryDate: null,
};

const contractor: EmploymentState = {
  employmentType: 'contract',
  contractExpiryDate: new Date('2026-12-31T00:00:00.000Z'),
};

describe('resolveEmploymentUpdate', () => {
  it('returns nothing when neither employment field is in the update', () => {
    expect(
      resolveEmploymentUpdate({ current: contractor, update: { jobTitle: 'Eng' } as never }),
    ).toEqual({});
  });

  it('sets the expiry when a permanent member moves to contract', () => {
    expect(
      resolveEmploymentUpdate({
        current: permanent,
        update: {
          employmentType: 'contract',
          contractExpiryDate: '2027-06-30T00:00:00.000Z',
        },
      }),
    ).toEqual({
      employmentType: 'contract',
      contractExpiryDate: new Date('2027-06-30T00:00:00.000Z'),
    });
  });

  it('rejects a move to contract with no expiry on file', () => {
    expect(() =>
      resolveEmploymentUpdate({
        current: permanent,
        update: { employmentType: 'contract' },
      }),
    ).toThrow(BadRequestException);
  });

  it('keeps the stored expiry when a contract member is re-sent as contract', () => {
    expect(
      resolveEmploymentUpdate({
        current: contractor,
        update: { employmentType: 'contract' },
      }),
    ).toEqual({
      employmentType: 'contract',
      contractExpiryDate: contractor.contractExpiryDate,
    });
  });

  it('keeps the stored type when only the expiry changes', () => {
    expect(
      resolveEmploymentUpdate({
        current: contractor,
        update: { contractExpiryDate: '2028-01-31T00:00:00.000Z' },
      }),
    ).toEqual({
      employmentType: 'contract',
      contractExpiryDate: new Date('2028-01-31T00:00:00.000Z'),
    });
  });

  it('rejects clearing the expiry of a contract member', () => {
    expect(() =>
      resolveEmploymentUpdate({
        current: contractor,
        update: { contractExpiryDate: null },
      }),
    ).toThrow(BadRequestException);
  });

  it('clears a stale expiry when a contractor goes permanent', () => {
    expect(
      resolveEmploymentUpdate({
        current: contractor,
        update: { employmentType: 'permanent' },
      }),
    ).toEqual({
      employmentType: 'permanent',
      contractExpiryDate: null,
    });
  });

  it('rejects an expiry date on a permanent member', () => {
    expect(() =>
      resolveEmploymentUpdate({
        current: permanent,
        update: { contractExpiryDate: '2027-06-30T00:00:00.000Z' },
      }),
    ).toThrow(BadRequestException);
  });

  it('rejects an unparseable expiry date', () => {
    expect(() =>
      resolveEmploymentUpdate({
        current: contractor,
        update: { contractExpiryDate: 'not-a-date' },
      }),
    ).toThrow(BadRequestException);
  });
});
