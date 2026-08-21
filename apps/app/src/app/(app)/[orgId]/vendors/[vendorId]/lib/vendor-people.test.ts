import { describe, expect, it } from 'vitest';
import { splitVendorPeople, type VendorPerson } from './vendor-people';

function person(overrides: Partial<VendorPerson> & Pick<VendorPerson, 'id' | 'role'>): VendorPerson {
  return {
    deactivated: false,
    user: { id: `user_${overrides.id}`, name: `User ${overrides.id}`, email: `${overrides.id}@x.com`, image: null },
    ...overrides,
  };
}

describe('splitVendorPeople', () => {
  const people: VendorPerson[] = [
    person({ id: 'owner', role: 'owner' }),
    person({ id: 'admin', role: 'admin' }),
    person({ id: 'auditor', role: 'auditor' }),
    person({ id: 'employee', role: 'employee' }),
    person({ id: 'contractor', role: 'contractor' }),
    person({ id: 'deactivated', role: 'admin', deactivated: true }),
  ];

  it('restricts assignees to members who can edit vendors (owner/admin)', () => {
    const { assignees } = splitVendorPeople(people, { orgId: 'org_1' });

    expect(assignees.map((a) => a.id).sort()).toEqual(['admin', 'owner']);
  });

  it('excludes read-only, portal-only, and deactivated members from assignees', () => {
    const { assignees } = splitVendorPeople(people, { orgId: 'org_1' });

    expect(assignees.some((a) => a.id === 'auditor')).toBe(false);
    expect(assignees.some((a) => a.id === 'employee')).toBe(false);
    expect(assignees.some((a) => a.id === 'contractor')).toBe(false);
    expect(assignees.some((a) => a.id === 'deactivated')).toBe(false);
  });

  it('allows any active org member as the system owner', () => {
    const { owners } = splitVendorPeople(people, { orgId: 'org_1' });

    expect(owners.map((o) => o.id).sort()).toEqual(
      ['admin', 'auditor', 'contractor', 'employee', 'owner'].sort(),
    );
  });

  it('excludes deactivated members from the system owner list', () => {
    const { owners } = splitVendorPeople(people, { orgId: 'org_1' });

    expect(owners.some((o) => o.id === 'deactivated')).toBe(false);
  });

  it('stamps the given organizationId on every returned option', () => {
    const { assignees, owners } = splitVendorPeople(people, { orgId: 'org_42' });

    expect([...assignees, ...owners].every((p) => p.organizationId === 'org_42')).toBe(true);
  });
});
