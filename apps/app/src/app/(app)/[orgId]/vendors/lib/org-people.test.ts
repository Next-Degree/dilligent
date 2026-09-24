import { beforeEach, describe, expect, it, vi } from 'vitest';

// Custom role rows the mocked `organization_role` query returns. Permissions
// are serialized JSON, as the column stores them.
const roleRows: { name: string; permissions: string }[] = [];

const findMany = vi.fn<(args: unknown) => Promise<typeof roleRows>>(async () => roleRows);

vi.mock('@db/server', () => ({
  db: { organizationRole: { findMany: (args: unknown) => findMany(args) } },
}));

import { selectInternalPeople, selectSystemOwnerCandidates, type OrgPerson } from './org-people';

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

const builtInPeople: OrgPerson[] = [
  person({ id: 'owner', role: 'owner' }),
  person({ id: 'admin', role: 'admin' }),
  person({ id: 'auditor', role: 'auditor' }),
  person({ id: 'employee', role: 'employee' }),
  person({ id: 'contractor', role: 'contractor' }),
  person({ id: 'deactivated', role: 'admin', deactivated: true }),
];

const sysOwner = person({ id: 'sys', role: 'System Owner' });
const employeeOwner = person({ id: 'emp-owner', role: 'employee,System Owner' });

function seedSystemOwnerRole(
  permissions: Record<string, string[]> = { app: ['read'], vendor: ['read', 'update'] },
) {
  roleRows.push({ name: 'System Owner', permissions: JSON.stringify(permissions) });
}

beforeEach(() => {
  roleRows.length = 0;
  findMany.mockClear();
});

describe('selectInternalPeople (Assignee)', () => {
  it('includes active members whose built-in role grants App Access', () => {
    const selected = selectInternalPeople(builtInPeople);

    expect(selected.map((p) => p.id).sort()).toEqual(['admin', 'auditor', 'owner']);
  });

  it('excludes portal-only and deactivated members', () => {
    const ids = selectInternalPeople(builtInPeople).map((p) => p.id);

    expect(ids).not.toContain('employee');
    expect(ids).not.toContain('contractor');
    expect(ids).not.toContain('deactivated');
  });

  it('includes a member holding App Access through any of several comma-separated roles', () => {
    const selected = selectInternalPeople([person({ id: 'multi', role: 'employee,admin' })]);

    expect(selected.map((p) => p.id)).toEqual(['multi']);
  });

  it('excludes custom-role members even when the custom role has App Access', () => {
    // Seeded so this fails if Assignee ever starts resolving custom roles.
    seedSystemOwnerRole();

    const selected = selectInternalPeople([sysOwner, employeeOwner]);

    expect(selected).toEqual([]);
  });

  it('preserves the platform role so SelectAssignee can exclude platform admins', () => {
    const platformAdmin = person({ id: 'staff', role: 'admin' });
    platformAdmin.user.role = 'admin';

    const [selected] = selectInternalPeople([platformAdmin]);

    expect(selected.user.role).toBe('admin');
  });
});

describe('selectSystemOwnerCandidates (System Owner)', () => {
  it('includes a member whose only role is a custom role with App Access', async () => {
    seedSystemOwnerRole();

    const selected = await selectSystemOwnerCandidates([sysOwner], { orgId: 'org_1' });

    expect(selected.map((p) => p.id)).toEqual(['sys']);
  });

  it('includes an employee who also holds a custom role with App Access', async () => {
    seedSystemOwnerRole();

    const selected = await selectSystemOwnerCandidates([employeeOwner], { orgId: 'org_1' });

    expect(selected.map((p) => p.id)).toEqual(['emp-owner']);
  });

  it('offers internal people and custom-role members together', async () => {
    seedSystemOwnerRole();

    const selected = await selectSystemOwnerCandidates(
      [...builtInPeople, sysOwner, employeeOwner],
      { orgId: 'org_1' },
    );

    expect(selected.map((p) => p.id).sort()).toEqual([
      'admin',
      'auditor',
      'emp-owner',
      'owner',
      'sys',
    ]);
  });

  it('excludes a member whose custom role lacks App Access', async () => {
    seedSystemOwnerRole({ vendor: ['read'] });

    const selected = await selectSystemOwnerCandidates([sysOwner, employeeOwner], {
      orgId: 'org_1',
    });

    expect(selected).toEqual([]);
  });

  it('excludes a custom role whose stored permissions are malformed, without throwing', async () => {
    roleRows.push({ name: 'System Owner', permissions: '{not json' });

    const selected = await selectSystemOwnerCandidates(
      [...builtInPeople, sysOwner, employeeOwner],
      { orgId: 'org_1' },
    );

    expect(selected.map((p) => p.id).sort()).toEqual(['admin', 'auditor', 'owner']);
  });

  it('excludes deactivated custom-role members', async () => {
    seedSystemOwnerRole();

    const selected = await selectSystemOwnerCandidates(
      [person({ id: 'gone', role: 'System Owner', deactivated: true })],
      { orgId: 'org_1' },
    );

    expect(selected).toEqual([]);
  });

  it('preserves the platform role so SelectAssignee can exclude platform admins', async () => {
    seedSystemOwnerRole();
    const platformAdmin = person({ id: 'staff', role: 'System Owner' });
    platformAdmin.user.role = 'admin';

    const [selected] = await selectSystemOwnerCandidates([platformAdmin], { orgId: 'org_1' });

    expect(selected.user.role).toBe('admin');
  });

  it('looks custom roles up in the given organization only', async () => {
    await selectSystemOwnerCandidates([sysOwner], { orgId: 'org_1' });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ organizationId: 'org_1' }),
      }),
    );
  });
});
