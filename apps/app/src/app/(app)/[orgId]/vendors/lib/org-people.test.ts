import { beforeEach, describe, expect, it, vi } from 'vitest';

interface RoleRow {
  organizationId: string;
  name: string;
  /** Serialized JSON, as the `organization_role.permissions` column stores it. */
  permissions: string;
}

// Custom role definitions the mocked `organization_role` table holds.
const roleRows: RoleRow[] = [];

const findMany = vi.fn(
  async ({ where }: { where: { organizationId: string; name: { in: string[] } } }) =>
    roleRows.filter(
      (row) => row.organizationId === where.organizationId && where.name.in.includes(row.name),
    ),
);

vi.mock('@db/server', () => ({
  db: { organizationRole: { findMany: (args: never) => findMany(args) } },
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

const systemOwners: OrgPerson[] = [
  person({ id: 'sys', role: 'System Owner' }),
  person({ id: 'emp-owner', role: 'employee,System Owner' }),
];

function seedSystemOwnerRole({
  orgId = 'org_1',
  permissions = { app: ['read'], vendor: ['read', 'update'] },
}: { orgId?: string; permissions?: Record<string, string[]> } = {}) {
  roleRows.push({
    organizationId: orgId,
    name: 'System Owner',
    permissions: JSON.stringify(permissions),
  });
}

beforeEach(() => {
  roleRows.length = 0;
  findMany.mockClear();
});

describe('selectInternalPeople (Assignee)', () => {
  it('includes active members whose built-in role grants App Access', () => {
    const selected = selectInternalPeople(builtInPeople, { orgId: 'org_1' });

    expect(selected.map((p) => p.id).sort()).toEqual(['admin', 'auditor', 'owner']);
  });

  it('excludes portal-only and deactivated members', () => {
    const ids = selectInternalPeople(builtInPeople, { orgId: 'org_1' }).map((p) => p.id);

    expect(ids).not.toContain('employee');
    expect(ids).not.toContain('contractor');
    expect(ids).not.toContain('deactivated');
  });

  it('includes a member holding App Access through any of several comma-separated roles', () => {
    const selected = selectInternalPeople([person({ id: 'multi', role: 'employee,admin' })], {
      orgId: 'org_1',
    });

    expect(selected.map((p) => p.id)).toEqual(['multi']);
  });

  it('excludes custom-role members even when the custom role has App Access', () => {
    seedSystemOwnerRole();

    const selected = selectInternalPeople(systemOwners, { orgId: 'org_1' });

    expect(selected).toEqual([]);
  });

  it('stamps the given organizationId and preserves the platform role', () => {
    const platformAdmin = person({ id: 'staff', role: 'admin' });
    platformAdmin.user.role = 'admin';

    const [selected] = selectInternalPeople([platformAdmin], { orgId: 'org_42' });

    expect(selected.organizationId).toBe('org_42');
    expect(selected.user.role).toBe('admin');
  });
});

describe('selectSystemOwnerCandidates (System Owner)', () => {
  it('includes the internal people', async () => {
    const selected = await selectSystemOwnerCandidates(builtInPeople, { orgId: 'org_1' });

    expect(selected.map((p) => p.id).sort()).toEqual(['admin', 'auditor', 'owner']);
  });

  it('includes a member whose only role is a custom role with App Access', async () => {
    seedSystemOwnerRole();

    const selected = await selectSystemOwnerCandidates([systemOwners[0]], { orgId: 'org_1' });

    expect(selected.map((p) => p.id)).toEqual(['sys']);
  });

  it('includes an employee who also holds a custom role with App Access', async () => {
    seedSystemOwnerRole();

    const selected = await selectSystemOwnerCandidates([systemOwners[1]], { orgId: 'org_1' });

    expect(selected.map((p) => p.id)).toEqual(['emp-owner']);
  });

  it('offers internal people and custom-role members together', async () => {
    seedSystemOwnerRole();

    const selected = await selectSystemOwnerCandidates([...builtInPeople, ...systemOwners], {
      orgId: 'org_1',
    });

    expect(selected.map((p) => p.id).sort()).toEqual([
      'admin',
      'auditor',
      'emp-owner',
      'owner',
      'sys',
    ]);
  });

  it('excludes a member whose custom role lacks App Access', async () => {
    seedSystemOwnerRole({ permissions: { vendor: ['read'] } });

    const selected = await selectSystemOwnerCandidates(systemOwners, { orgId: 'org_1' });

    expect(selected).toEqual([]);
  });

  it('excludes a custom role whose stored permissions are malformed, without throwing', async () => {
    roleRows.push({ organizationId: 'org_1', name: 'System Owner', permissions: '{not json' });

    const selected = await selectSystemOwnerCandidates([...builtInPeople, ...systemOwners], {
      orgId: 'org_1',
    });

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

  it('resolves custom roles only from the given organization', async () => {
    seedSystemOwnerRole({ orgId: 'org_other' });

    const selected = await selectSystemOwnerCandidates(systemOwners, { orgId: 'org_1' });

    expect(selected).toEqual([]);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ organizationId: 'org_1' }),
      }),
    );
  });
});
