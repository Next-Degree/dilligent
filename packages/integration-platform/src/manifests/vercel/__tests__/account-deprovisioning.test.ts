import { describe, expect, it } from 'bun:test';
import type { CheckVariableValues, OrganizationMemberSummary } from '../../../types';
import { accountDeprovisioningCheck } from '../checks/account-deprovisioning';
import type {
  VercelEmailInviteCode,
  VercelTeamDetails,
  VercelTeamMember,
  VercelTeamMembersResponse,
} from '../types';
import { findByResourceId, makeCheckContext, makeEmployee } from './context';

const TEAM_ID = 'team_1';
const DAY_MS = 24 * 60 * 60 * 1000;

const makeMember = (overrides: Partial<VercelTeamMember> = {}): VercelTeamMember => ({
  uid: 'usr_1',
  email: 'jane@acme.com',
  name: 'Jane Doe',
  role: 'MEMBER',
  confirmed: true,
  createdAt: 1_700_000_000_000,
  ...overrides,
});

function run(options: {
  members: VercelTeamMember[];
  employees?: OrganizationMemberSummary[];
  invites?: VercelEmailInviteCode[];
  variables?: CheckVariableValues;
  rosterError?: Error;
  omitRoster?: boolean;
}) {
  const recorded = makeCheckContext({
    variables: options.variables,
    teamId: TEAM_ID,
    members: options.omitRoster ? undefined : (options.employees ?? []),
    rosterError: options.rosterError,
    handle: (path) => {
      if (path.startsWith('/v2/teams/')) {
        return { id: TEAM_ID, name: 'Acme' } satisfies VercelTeamDetails;
      }
      if (path.includes('/members')) {
        return {
          members: options.members,
          emailInviteCodes: options.invites ?? [],
        } satisfies VercelTeamMembersResponse;
      }
      throw new Error(`Unexpected fetch: ${path}`);
    },
  });
  return accountDeprovisioningCheck.run(recorded.ctx).then(() => recorded);
}

describe('accountDeprovisioningCheck roster reconciliation', () => {
  it('passes accounts belonging to active employees', async () => {
    const recorded = await run({
      members: [makeMember(), makeMember({ uid: 'usr_2', email: 'john@acme.com' })],
      employees: [
        makeEmployee({ email: 'jane@acme.com' }),
        makeEmployee({ email: 'john@acme.com' }),
      ],
    });

    expect(recorded.fails).toHaveLength(0);
    expect(findByResourceId(recorded.passes, 'jane@acme.com')?.title).toBe(
      'Account belongs to an active employee',
    );
  });

  it('flags a leaver who still holds Vercel access', async () => {
    const recorded = await run({
      members: [makeMember({ email: 'gone@acme.com', name: 'Gone Person' })],
      employees: [
        makeEmployee({
          email: 'gone@acme.com',
          isActive: false,
          offboardDate: '2026-07-01T00:00:00.000Z',
        }),
      ],
    });

    const finding = findByResourceId(recorded.fails, 'gone@acme.com');
    expect(finding?.severity).toBe('high');
    expect(finding?.title).toContain('Access not removed for leaver');
    expect(finding?.description).toContain('2026-07-01');
  });

  it('flags an account that matches nobody on the roster', async () => {
    const recorded = await run({
      members: [
        makeMember({ uid: 'usr_x', email: 'stranger@acme.com', role: 'MEMBER' }),
        makeMember({ uid: 'usr_y', email: 'ghost@acme.com', role: 'OWNER' }),
      ],
      employees: [makeEmployee({ email: 'jane@acme.com' })],
    });

    expect(recorded.fails.map((f) => f.resourceId).sort()).toEqual([
      'ghost@acme.com',
      'stranger@acme.com',
    ]);
    expect(findByResourceId(recorded.fails, 'ghost@acme.com')?.severity).toBe('high');
    expect(findByResourceId(recorded.fails, 'stranger@acme.com')?.severity).toBe('medium');
  });

  it('matches an account held under a linked provider email', async () => {
    const recorded = await run({
      members: [makeMember({ email: 'jane@personal.dev' })],
      employees: [
        makeEmployee({
          email: 'jane@acme.com',
          emails: ['jane@acme.com', 'jane@personal.dev'],
          linkedEmailSource: 'github',
        }),
      ],
    });

    expect(recorded.fails).toHaveLength(0);
    expect(findByResourceId(recorded.passes, 'jane@personal.dev')?.evidence).toMatchObject({
      matchedEmployee: { matchedOnLinkedEmail: true, linkedEmailSource: 'github' },
    });
  });

  it('prefers the active member when an email appears on two records', async () => {
    const recorded = await run({
      members: [makeMember({ email: 'shared@acme.com' })],
      employees: [
        makeEmployee({ email: 'shared@acme.com', isActive: false, name: 'Archived' }),
        makeEmployee({ email: 'shared@acme.com', isActive: true, name: 'Current' }),
      ],
    });

    expect(recorded.fails).toHaveLength(0);
    expect(findByResourceId(recorded.passes, 'shared@acme.com')?.evidence).toMatchObject({
      matchedEmployee: { name: 'Current' },
    });
  });

  it('reports unverified rather than flagging everyone when the roster is unavailable', async () => {
    const recorded = await run({ members: [makeMember()], omitRoster: true });

    expect(recorded.fails).toHaveLength(1);
    expect(recorded.fails[0]?.resourceId).toBe('employee-roster');
    expect(recorded.fails[0]?.title).toContain('Could not compare');
  });

  it('reports unverified when the roster lookup throws', async () => {
    const recorded = await run({
      members: [makeMember()],
      rosterError: new Error('database unavailable'),
    });

    expect(findByResourceId(recorded.fails, 'employee-roster')?.description).toContain(
      'database unavailable',
    );
  });
});

describe('accountDeprovisioningCheck pending invitations', () => {
  const employees = [makeEmployee({ email: 'jane@acme.com' })];

  it('passes fresh invitations and fails stale or expired ones', async () => {
    const recorded = await run({
      members: [],
      employees,
      invites: [
        { id: 'inv_fresh', email: 'New@acme.com', createdAt: Date.now() - 2 * DAY_MS },
        { id: 'inv_old', email: 'old@acme.com', createdAt: Date.now() - 45 * DAY_MS },
        { id: 'inv_expired', email: 'gone@acme.com', createdAt: Date.now(), expired: true },
      ],
    });

    expect(findByResourceId(recorded.passes, 'new@acme.com')?.resourceType).toBe('invite');
    expect(recorded.fails.map((f) => f.resourceId).sort()).toEqual([
      'gone@acme.com',
      'old@acme.com',
    ]);
  });

  it('honours a configured age limit', async () => {
    const recorded = await run({
      members: [],
      employees,
      invites: [{ id: 'inv_1', email: 'new@acme.com', createdAt: Date.now() - 5 * DAY_MS }],
      variables: { pending_invite_max_age_days: 3 },
    });

    expect(findByResourceId(recorded.fails, 'new@acme.com')?.evidence).toMatchObject({
      maxInviteAgeDays: 3,
      ageDays: 5,
    });
  });
});
