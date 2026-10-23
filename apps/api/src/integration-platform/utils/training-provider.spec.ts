import { createTrainingProvider } from './training-provider';

const findOrganization = jest.fn();
const findMembers = jest.fn();
const findCompletions = jest.fn();
const filterComplianceMembers = jest.fn();

jest.mock('@db', () => ({
  db: {
    organization: {
      findUnique: (...args: unknown[]) => findOrganization(...args),
    },
    member: { findMany: (...args: unknown[]) => findMembers(...args) },
    employeeTrainingVideoCompletion: {
      findMany: (...args: unknown[]) => findCompletions(...args),
    },
  },
}));

jest.mock('../../utils/compliance-filters', () => ({
  filterComplianceMembers: (...args: unknown[]) =>
    filterComplianceMembers(...args),
}));

interface MemberRow {
  id: string;
  role: string;
  createdAt: Date;
  onboardDate: Date | null;
  offboardDate: Date | null;
  user: { email: string; name: string | null; role: string | null };
}

const makeMember = (overrides: Partial<MemberRow> = {}): MemberRow => ({
  id: 'mem_1',
  role: 'employee',
  createdAt: new Date('2026-01-10T00:00:00.000Z'),
  onboardDate: null,
  offboardDate: null,
  user: { email: ' Ada@Acme.com ', name: ' Ada Lovelace ', role: 'user' },
  ...overrides,
});

const load = () =>
  createTrainingProvider({
    organizationId: 'org_1',
  }).getSecurityAwarenessTraining();

describe('createTrainingProvider', () => {
  beforeEach(() => {
    findOrganization.mockReset();
    findMembers.mockReset();
    findCompletions.mockReset();
    filterComplianceMembers.mockReset();
    findOrganization.mockResolvedValue({ securityTrainingStepEnabled: true });
    findCompletions.mockResolvedValue([]);
    filterComplianceMembers.mockImplementation(async (members: unknown[]) =>
      Promise.resolve(members),
    );
  });

  it('requires the five general security awareness modules', async () => {
    findMembers.mockResolvedValue([]);

    const records = await load();

    expect(records.requiredModuleIds).toEqual([
      'sat-1',
      'sat-2',
      'sat-3',
      'sat-4',
      'sat-5',
    ]);
  });

  it('scopes every query to the organization and to active members', async () => {
    findMembers.mockResolvedValue([makeMember()]);

    await load();

    expect(findOrganization).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'org_1' } }),
    );
    expect(findMembers).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: 'org_1', deactivated: false, isActive: true },
      }),
    );
    expect(filterComplianceMembers).toHaveBeenCalledWith(
      [expect.objectContaining({ id: 'mem_1' })],
      'org_1',
    );
    expect(findCompletions).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          memberId: { in: ['mem_1'] },
          completedAt: { not: null },
        }),
      }),
    );
  });

  it('maps members to participants with their finished modules', async () => {
    findMembers.mockResolvedValue([makeMember()]);
    findCompletions.mockResolvedValue([
      {
        memberId: 'mem_1',
        videoId: 'sat-1',
        completedAt: new Date('2026-02-01T09:00:00.000Z'),
      },
    ]);

    const records = await load();

    expect(records.participants).toEqual([
      {
        id: 'mem_1',
        email: 'ada@acme.com',
        name: 'Ada Lovelace',
        joinedAt: '2026-01-10T00:00:00.000Z',
        completions: [
          { moduleId: 'sat-1', completedAt: '2026-02-01T09:00:00.000Z' },
        ],
      },
    ]);
  });

  it('anchors joinedAt on the onboard date when one is set', async () => {
    findMembers.mockResolvedValue([
      makeMember({ onboardDate: new Date('2025-06-01T00:00:00.000Z') }),
    ]);

    const [participant] = (await load()).participants;

    expect(participant.joinedAt).toBe('2025-06-01T00:00:00.000Z');
  });

  it('leaves out people whose offboard date has passed', async () => {
    findMembers.mockResolvedValue([
      makeMember({ id: 'left', offboardDate: new Date('2020-01-01') }),
      makeMember({ id: 'leaving', offboardDate: new Date('2999-01-01') }),
    ]);

    const records = await load();

    expect(records.participants.map((p) => p.id)).toEqual(['leaving']);
  });

  it('leaves out members without a compliance obligation', async () => {
    findMembers.mockResolvedValue([
      makeMember({ id: 'employee' }),
      makeMember({ id: 'auditor', role: 'auditor' }),
    ]);
    filterComplianceMembers.mockImplementation(async (members: MemberRow[]) =>
      Promise.resolve(members.filter((m) => m.role !== 'auditor')),
    );

    const records = await load();

    expect(records.participants.map((p) => p.id)).toEqual(['employee']);
  });

  it('skips the completions query when nobody is in scope', async () => {
    findMembers.mockResolvedValue([]);

    const records = await load();

    expect(records.participants).toEqual([]);
    expect(findCompletions).not.toHaveBeenCalled();
  });

  it('reports whether the portal training step is enabled', async () => {
    findMembers.mockResolvedValue([]);
    findOrganization.mockResolvedValue({ securityTrainingStepEnabled: false });

    expect((await load()).portalTrainingEnabled).toBe(false);
  });
});
