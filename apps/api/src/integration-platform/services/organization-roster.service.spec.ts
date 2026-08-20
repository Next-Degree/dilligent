const mockFindMany = jest.fn();

jest.mock('@db', () => ({
  db: { member: { findMany: (...args: unknown[]) => mockFindMany(...args) } },
}));

import { OrganizationRosterService } from './organization-roster.service';

interface MemberRow {
  role: string;
  isActive: boolean;
  deactivated: boolean;
  department: string | null;
  offboardDate: Date | null;
  externalUserId: string | null;
  externalUserSource: string | null;
  user: { name: string | null; email: string | null };
}

const row = (overrides: Partial<MemberRow> = {}): MemberRow => ({
  role: 'employee',
  isActive: true,
  deactivated: false,
  department: 'eng',
  offboardDate: null,
  externalUserId: null,
  externalUserSource: null,
  user: { name: 'Jane Doe', email: 'Jane@Acme.com' },
  ...overrides,
});

describe('OrganizationRosterService', () => {
  let service: OrganizationRosterService;

  beforeEach(() => {
    mockFindMany.mockReset();
    service = new OrganizationRosterService();
  });

  it('lowercases the primary email and reports active membership', async () => {
    mockFindMany.mockResolvedValue([row()]);

    const [member] = await service.listMembers('org_1');

    expect(member.email).toBe('jane@acme.com');
    expect(member.emails).toEqual(['jane@acme.com']);
    expect(member.isActive).toBe(true);
    expect(member.linkedEmailSource).toBeNull();
  });

  it('includes the linked provider email alongside the primary one', async () => {
    mockFindMany.mockResolvedValue([
      row({
        externalUserId: 'Jane@Personal.dev',
        externalUserSource: 'github',
      }),
    ]);

    const [member] = await service.listMembers('org_1');

    expect(member.emails).toEqual(['jane@acme.com', 'jane@personal.dev']);
    expect(member.linkedEmailSource).toBe('github');
  });

  it('does not duplicate an email linked to itself', async () => {
    mockFindMany.mockResolvedValue([
      row({ externalUserId: 'jane@acme.com', externalUserSource: 'github' }),
    ]);

    const [member] = await service.listMembers('org_1');

    expect(member.emails).toEqual(['jane@acme.com']);
  });

  it.each([
    ['deactivated', { deactivated: true }],
    ['inactive', { isActive: false }],
  ])('treats a %s member as not active', async (_label, overrides) => {
    mockFindMany.mockResolvedValue([row(overrides)]);

    const [member] = await service.listMembers('org_1');

    expect(member.isActive).toBe(false);
  });

  it('returns leavers too, with their offboard date', async () => {
    mockFindMany.mockResolvedValue([
      row({
        deactivated: true,
        offboardDate: new Date('2026-07-01T00:00:00.000Z'),
      }),
    ]);

    const [member] = await service.listMembers('org_1');

    expect(member.offboardDate).toBe('2026-07-01T00:00:00.000Z');
    // Leavers must be included: they are exactly who an offboarding check looks for.
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: 'org_1' } }),
    );
  });

  it('rethrows read failures rather than yielding an empty roster', async () => {
    mockFindMany.mockRejectedValue(new Error('database unavailable'));

    await expect(service.provider('org_1')()).rejects.toThrow(
      'database unavailable',
    );
  });
});
