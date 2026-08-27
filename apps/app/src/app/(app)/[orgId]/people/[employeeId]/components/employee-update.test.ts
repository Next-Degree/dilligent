import type { Member, User } from '@db';
import { describe, expect, it } from 'vitest';
import { buildEmployeeUpdate, type EmployeeFormValues } from './employee-update';

const employee = {
  id: 'mem_1',
  userId: 'usr_1',
  organizationId: 'org_1',
  role: 'employee',
  department: 'engineering',
  jobTitle: 'Engineer',
  isActive: true,
  employmentType: 'permanent',
  contractExpiryDate: null,
  primaryLocation: null,
  onboardDate: null,
  offboardDate: null,
  user: { id: 'usr_1', name: 'Ada Lovelace', email: 'ada@example.com' },
} as unknown as Member & { user: User };

const values: EmployeeFormValues = {
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  jobTitle: 'Engineer',
  department: 'engineering',
  status: 'active',
  employmentType: 'permanent',
  contractExpiryDate: undefined,
  primaryLocation: null,
  onboardDate: undefined,
  offboardDate: undefined,
};

const expiry = new Date('2027-06-30T00:00:00.000Z');

describe('buildEmployeeUpdate', () => {
  it('sends nothing when the form matches the stored member', () => {
    expect(buildEmployeeUpdate({ employee, values })).toEqual({});
  });

  it('sends the type and expiry when a permanent member becomes a contractor', () => {
    expect(
      buildEmployeeUpdate({
        employee,
        values: { ...values, employmentType: 'contract', contractExpiryDate: expiry },
      }),
    ).toEqual({
      employmentType: 'contract',
      contractExpiryDate: expiry.toISOString(),
    });
  });

  it('omits the expiry for a permanent member, even with a date left in the form', () => {
    expect(
      buildEmployeeUpdate({
        employee,
        values: { ...values, contractExpiryDate: expiry },
      }),
    ).toEqual({});
  });

  it('sends only the type when a contractor becomes permanent', () => {
    const contractor = {
      ...employee,
      employmentType: 'contract',
      contractExpiryDate: new Date('2026-12-31T00:00:00.000Z'),
    } as unknown as Member & { user: User };

    expect(
      buildEmployeeUpdate({
        employee: contractor,
        values: { ...values, employmentType: 'permanent', contractExpiryDate: undefined },
      }),
    ).toEqual({ employmentType: 'permanent' });
  });

  it('sends only the expiry when a contractor renews', () => {
    const contractor = {
      ...employee,
      employmentType: 'contract',
      contractExpiryDate: new Date('2026-12-31T00:00:00.000Z'),
    } as unknown as Member & { user: User };

    expect(
      buildEmployeeUpdate({
        employee: contractor,
        values: { ...values, employmentType: 'contract', contractExpiryDate: expiry },
      }),
    ).toEqual({ contractExpiryDate: expiry.toISOString() });
  });

  it('treats a member with no stored employment type as permanent', () => {
    const legacy = { ...employee, employmentType: null } as unknown as Member & {
      user: User;
    };

    expect(buildEmployeeUpdate({ employee: legacy, values })).toEqual({});
  });
});

describe('buildEmployeeUpdate — primary location', () => {
  const located = {
    ...employee,
    primaryLocation: 'US',
  } as unknown as Member & { user: User };

  it('sends the country code when a location is set for the first time', () => {
    expect(
      buildEmployeeUpdate({ employee, values: { ...values, primaryLocation: 'BR' } }),
    ).toEqual({ primaryLocation: 'BR' });
  });

  it('sends nothing when the location is unchanged', () => {
    expect(
      buildEmployeeUpdate({
        employee: located,
        values: { ...values, primaryLocation: 'US' },
      }),
    ).toEqual({});
  });

  it('sends null when the location is cleared', () => {
    expect(
      buildEmployeeUpdate({
        employee: located,
        values: { ...values, primaryLocation: null },
      }),
    ).toEqual({ primaryLocation: null });
  });
});
