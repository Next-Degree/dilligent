import { describe, expect, it } from 'vitest';
import { selectAppAccessPeople, type OrgPerson } from './org-people';

function person(overrides: Partial<OrgPerson> & Pick<OrgPerson, 'id' | 'role'>): OrgPerson {
  return {
    deactivated: false,
    user: {
      id: `user_${overrides.id}`,
      name: `User ${overrides.id}`,
      email: `${overrides.id}@x.com`,
      image: null,
    },
    ...overrides,
  };
}

describe('selectAppAccessPeople', () => {
  const people: OrgPerson[] = [
    person({ id: 'owner', role: 'owner' }),
    person({ id: 'admin', role: 'admin' }),
    person({ id: 'auditor', role: 'auditor' }),
    person({ id: 'employee', role: 'employee' }),
    person({ id: 'contractor', role: 'contractor' }),
    person({ id: 'deactivated', role: 'admin', deactivated: true }),
  ];

  it('includes members whose role grants App Access', () => {
    const selected = selectAppAccessPeople(people, { orgId: 'org_1' });

    expect(selected.map((p) => p.id).sort()).toEqual(['admin', 'auditor', 'owner']);
  });

  it('excludes portal-only members (employee, contractor)', () => {
    const selected = selectAppAccessPeople(people, { orgId: 'org_1' });

    expect(selected.some((p) => p.id === 'employee')).toBe(false);
    expect(selected.some((p) => p.id === 'contractor')).toBe(false);
  });

  it('excludes deactivated members even when their role grants App Access', () => {
    const selected = selectAppAccessPeople(people, { orgId: 'org_1' });

    expect(selected.some((p) => p.id === 'deactivated')).toBe(false);
  });

  it('includes a member holding App Access through any of several comma-separated roles', () => {
    const selected = selectAppAccessPeople([person({ id: 'multi', role: 'employee,admin' })], {
      orgId: 'org_1',
    });

    expect(selected.map((p) => p.id)).toEqual(['multi']);
  });

  it('stamps the given organizationId on every returned option', () => {
    const selected = selectAppAccessPeople(people, { orgId: 'org_42' });

    expect(selected.every((p) => p.organizationId === 'org_42')).toBe(true);
  });

  it('preserves the user object so downstream filters can read the platform role', () => {
    const platformAdmin = person({ id: 'staff', role: 'admin' });
    platformAdmin.user.role = 'admin';

    const [selected] = selectAppAccessPeople([platformAdmin], { orgId: 'org_1' });

    expect(selected.user.role).toBe('admin');
  });
});
