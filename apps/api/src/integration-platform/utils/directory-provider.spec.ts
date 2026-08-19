import { createDirectoryProvider } from './directory-provider';

const findMany = jest.fn();
const orgParticipantMemberWhere = jest.fn();

jest.mock('@db', () => ({
  db: { member: { findMany: (...args: unknown[]) => findMany(...args) } },
}));

jest.mock('../../utils/org-participation', () => ({
  orgParticipantMemberWhere: (...args: unknown[]) =>
    orgParticipantMemberWhere(...args),
}));

interface MemberRow {
  id: string;
  isActive: boolean;
  deactivated: boolean;
  department: string | null;
  jobTitle: string | null;
  offboardDate: Date | null;
  user: { email: string | null; name: string | null } | null;
}

const makeMember = (overrides: Partial<MemberRow> = {}): MemberRow => ({
  id: 'mem_1',
  isActive: true,
  deactivated: false,
  department: 'engineering',
  jobTitle: 'Engineer',
  offboardDate: null,
  user: { email: 'Alice@Acme.com', name: 'Alice A' },
  ...overrides,
});

describe('createDirectoryProvider', () => {
  beforeEach(() => {
    findMany.mockReset();
    orgParticipantMemberWhere.mockReset();
    orgParticipantMemberWhere.mockResolvedValue({});
  });

  it('normalizes emails to lowercase so provider lookups match', async () => {
    findMany.mockResolvedValue([makeMember()]);

    const people = await createDirectoryProvider({
      organizationId: 'org_1',
    }).listPeople();

    expect(people).toHaveLength(1);
    expect(people[0]).toMatchObject({
      id: 'mem_1',
      email: 'alice@acme.com',
      name: 'Alice A',
      isActive: true,
    });
  });

  it('scopes the query to the organization and excludes platform admins', async () => {
    orgParticipantMemberWhere.mockResolvedValue({
      AND: [{ user: { role: { not: 'admin' } } }],
    });
    findMany.mockResolvedValue([]);

    await createDirectoryProvider({ organizationId: 'org_9' }).listPeople();

    expect(orgParticipantMemberWhere).toHaveBeenCalledWith('org_9');
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: 'org_9',
          AND: [{ user: { role: { not: 'admin' } } }],
        }),
      }),
    );
  });

  it('marks deactivated members inactive', async () => {
    findMany.mockResolvedValue([makeMember({ deactivated: true })]);

    const [person] = await createDirectoryProvider({
      organizationId: 'org_1',
    }).listPeople();

    expect(person?.isActive).toBe(false);
  });

  it('marks members with isActive false inactive', async () => {
    findMany.mockResolvedValue([makeMember({ isActive: false })]);

    const [person] = await createDirectoryProvider({
      organizationId: 'org_1',
    }).listPeople();

    expect(person?.isActive).toBe(false);
  });

  it('treats a past offboard date as inactive even when the record looks active', async () => {
    const offboardDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
    findMany.mockResolvedValue([makeMember({ offboardDate })]);

    const [person] = await createDirectoryProvider({
      organizationId: 'org_1',
    }).listPeople();

    expect(person?.isActive).toBe(false);
    expect(person?.offboardDate).toBe(offboardDate.toISOString());
  });

  it('keeps a member with a future offboard date active', async () => {
    const offboardDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    findMany.mockResolvedValue([makeMember({ offboardDate })]);

    const [person] = await createDirectoryProvider({
      organizationId: 'org_1',
    }).listPeople();

    expect(person?.isActive).toBe(true);
  });

  it('drops members with no email, since email is the join key', async () => {
    findMany.mockResolvedValue([
      makeMember({ user: { email: null, name: 'No Email' } }),
      makeMember({ id: 'mem_2', user: null }),
      makeMember({ id: 'mem_3' }),
    ]);

    const people = await createDirectoryProvider({
      organizationId: 'org_1',
    }).listPeople();

    expect(people.map((p) => p.id)).toEqual(['mem_3']);
  });

  it('does not query until listPeople is called', async () => {
    createDirectoryProvider({ organizationId: 'org_1' });

    expect(findMany).not.toHaveBeenCalled();
  });
});
